#!/usr/bin/env node
// apps/build-archive.js
//
// Turns a finished resolver run into `playable.json`: what of a past week is
// still there to listen to.
//
// The file is NOT called archive.json, although the tab that reads it is
// called Archive. `data/archive/` already exists on the guide and holds the
// dated COLLECTIONS -- schedule-2026-08-31.json and its kind. Two directories
// apart in name and nothing to do with each other is how, in half a year,
// somebody spends an afternoon working out which archive is which. The file
// says what is in it; the tab says what a person is looking for.
//
//   node build-archive.js ../apps/autoplay-pi/data/resolved/resolved-2026-09-06.json
//   node build-archive.js <resolved.json> --schedule <schedule.json|URL> --out <dir>
//
// No network of its own beyond fetching the schedule the run recorded as its
// source. This is data work: a join, a filter and a merge.
//
// WHY A JOIN AND NOT A COPY. The resolver's rows carry id, station, title,
// times, the addresses and the verdict -- and no subtitle and no genre. At SWR
// Kultur the subtitle is the entire list of works of a night; an archive built
// from resolver rows alone would be a list of the word "ARD-Nachtkonzert",
// eight times. So the collected week is read again and joined on `id`, which
// both sides carry.
//
// WHAT GETS IN. Only what was reachable at least once, and no livestream -- a
// live address is always up and says nothing about an archive. An entry that
// is later found gone STAYS, marked `playable: false`. Roger, 07.09.2026:
// unbounded growth is fine. It has to be: "how long does a station keep a
// recording" can only be answered by rows that were watched from the day they
// appeared until the day they went, and throwing them out on the day they go
// destroys the only measurement that answers it.

const fs = require("fs");
const path = require("path");
const { isoDate, isPlayable, isPageOnly, isBlocked, optionOf } = require("./lib/rows");

const args = process.argv.slice(2);

// See optionOf in lib/rows.js: the shared version takes `args` rather than
// closing over it, which is what let three identical copies become one.
function option(name, fallback) {
  return optionOf(args, name, fallback);
}

const resolvedPath = args[0];
if (!resolvedPath || resolvedPath.startsWith("--")) {
  console.error(
    "Usage: node build-archive.js <resolved-*.json> [--schedule <schedule.json|URL>]\n" +
      "                            [--out <dir>] [--dry]"
  );
  process.exit(1);
}

const outDir = option("out", path.dirname(resolvedPath));
const playablePath = path.join(outDir, "playable.json");
const dry = args.includes("--dry");

async function readJson(where) {
  if (/^https?:\/\//i.test(where)) {
    const answer = await fetch(where, { headers: { Accept: "application/json" } });
    if (!answer.ok) throw new Error(where + " answered " + answer.status);
    return answer.json();
  }
  return JSON.parse(fs.readFileSync(where, "utf8"));
}




function write(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(payload, null, 2));
  fs.renameSync(file + ".tmp", file);
}

async function main() {
  const run = await readJson(resolvedPath);
  if (run.finished !== true) {
    console.error("This run did not finish -- folding it in would archive a half-walked week.");
    process.exit(1);
  }

  const scheduleWhere = option("schedule", run.source);
  if (!scheduleWhere) {
    console.error("The run records no source. Give the collected week with --schedule.");
    process.exit(1);
  }
  const schedule = await readJson(scheduleWhere);
  const collected = new Map(
    (Array.isArray(schedule.concerts) ? schedule.concerts : []).map((c) => [c.id, c])
  );

  let playable = { generatedAt: null, weeks: [], concerts: [] };
  try {
    playable = JSON.parse(fs.readFileSync(playablePath, "utf8"));
  } catch (e) {
    // Nothing yet. The first week makes it.
  }
  const known = new Map(playable.concerts.map((c) => [c.id, c]));

  const now = new Date().toISOString();
  const checkedAt = run.resolvedUntil || run.resolvedAt || now;
  let added = 0;
  let refreshed = 0;
  let lost = 0;
  let missingRow = 0;

  for (const row of run.entries || []) {
    const seen = known.get(row.id);
    const playable = isPlayable(row);
    const pageOnly = !playable && isPageOnly(row);
    // Refused rather than absent -- see isBlocked in lib/rows.js. Added
    // 13.09.2026, and it changes what this file admits: such a row used to be
    // dropped by the test below, so the RNE "Fila cero" recordings were
    // invisible in the app even though the resolver knew exactly what had
    // happened to them.
    const blocked = !playable && !pageOnly && isBlocked(row);
    /* The fifth state, 17.09.2026: it aired, and the station keeps no archive.
     *
     * Roger: "nimm ruhig no-archive mit ins archive mit auf." In the ARCHIVE
     * that is worth more than it is in the programme -- there a person is
     * looking for something to hear, and "there is none, and its archive
     * stopped in July" is an answer while silence is not. Five strands measured
     * in two days; see OPEN-TASKS.md, and declineOf() for how it is told from a
     * publisher who is merely late.
     */
    const noArchive = !playable && !pageOnly && !blocked && row.declined === "no-archive";

    // Never reachable, no page of its own, not refused, no archive either, and
    // not known here: not archive material. An error or a timeout is recorded
    // in the resolver's own file, which is where that belongs.
    if (!playable && !pageOnly && !blocked && !noArchive && !seen) continue;

    // No line in the collected week. That used to end the matter, because the
    // resolver's rows carried no subtitle, no genre and no week. Since the
    // daily run they do -- and they have to, because a run in the seven-day
    // window reaches back into last week, whose collection is not the one this
    // build was given. A row with an address describes itself well enough; one
    // without is nothing to archive under any week.
    const source = collected.get(row.id);
    if (!source && !seen && !row.broadcastUrl) {
      missingRow += 1;
      continue;
    }

    const check = { at: checkedAt, verdict: (row.probe || {}).verdict || "unknown" };
    const answer = row.answer || {};

    if (seen) {
      if (seen.playable && !playable) lost += 1;
      else refreshed += 1;
      seen.playable = playable;
      seen.pageOnly = pageOnly;
      seen.blocked = blocked;
      seen.noArchive = noArchive;
      // The address that was refused, not the page. Roger, 13.09.2026: the app
      // should be able to say WHICH file it cannot play, and `probe.url` is
      // the one the one-byte request actually went to.
      //
      // Null where the station DECLARED the block instead: SRF names no file
      // at all, so there is no address to show and the screen says so in
      // words. See isBlocked in lib/rows.js.
      seen.blockedUrl = blocked ? (row.probe || {}).url || null : null;
      seen.blockReason = blocked ? row.blockReason || null : null;
      if (row.geoRestricted || (answer.geoRestricted)) seen.geoRestricted = true;
      // A row that was refused carries its own expiry now; a row that was
      // answered carries it inside the answer. Either is better than none.
      if (row.expiresAt) seen.expiresAt = isoDate(row.expiresAt);
      seen.lastCheck = checkedAt;
      if (playable) seen.lastPlayable = checkedAt;
      seen.checks = (seen.checks || []).concat([check]);
      seen.retention = row.retention || seen.retention || null;
      if (answer.expiresAt) seen.expiresAt = isoDate(answer.expiresAt);
      if (row.sharedUrl) seen.sharedUrl = row.sharedUrl;
      continue;
    }

    added += 1;
    known.set(row.id, {
      id: row.id,
      stationId: row.stationId,
      station: row.station,
      // From the collected week, because the resolver does not carry them --
      // and they are what a person reads.
      title: (source && source.title) || row.title,
      subtitle: (source && source.subtitle) || row.subtitle || null,
      genre: (source && source.genre) || row.genre || null,
      startTime: row.startTime,
      dateKey: row.dateKey,
      durationMin: row.durationMin || (source && source.duration) || null,
      // Two addresses and both are needed: the page a person can read, and the
      // one StreamAux is handed. The second carries the #kg= fragment, which
      // is what makes a shared link land on the right broadcast.
      broadcastUrl: row.broadcastUrl || (source && source.broadcastUrl) || null,
      sharedUrl: row.sharedUrl || null,
      // The row's own week, because one run can carry two of them. `run.week`
      // is the week of the collection the run read, which is right for most
      // rows and wrong for exactly the ones the window was built for.
      week: row.week || run.week || null,
      playable: playable,
      // Written on every entry rather than only where it is true. A field that
      // appears on some rows and not others reads, in the app, as "unknown"
      // -- and the difference between "we cannot play this" and "we have not
      // looked" is the whole point of the state.
      pageOnly: pageOnly,
      blocked: blocked,
      noArchive: noArchive,
      blockedUrl: blocked ? (row.probe || {}).url || null : null,
      /* The station's own word for why, where it gave one.
       *
       * "GEOBLOCK" from SRF, "rightsUnavailable" from NRK. Kept verbatim
       * rather than translated into a house vocabulary: the value of this
       * field is that it can be looked up in the broadcaster's own
       * documentation, and a tidied word cannot.
       */
      blockReason: blocked ? row.blockReason || null : null,
      firstSeen: checkedAt,
      // Only where there was something to hear. A page-only entry has never
      // been playable, and dating it as if it had been would spoil the one
      // measurement this file exists for.
      lastPlayable: playable ? checkedAt : null,
      lastCheck: checkedAt,
      // From the answer where there was one, from the refusal where there was
      // not. SRF says how long a recording it will not give us stays -- true,
      // and worth keeping, because after that date it is gone in Switzerland
      // too.
      expiresAt: isoDate(answer.expiresAt || row.expiresAt),
      geoRestricted: !!(answer.geoRestricted || row.geoRestricted),
      retention: row.retention || null,
      checks: [check],
    });
  }

  // Read off the entries rather than appended to. A run that folds in two
  // weeks would otherwise announce one of them, and the list would drift from
  // what the file actually holds.
  const weeks = [...new Set([...known.values()].map((c) => c.week).filter(Boolean))].sort();

  const next = {
    generatedAt: now,
    weeks: weeks,
    concerts: [...known.values()].sort((a, b) =>
      String(a.startTime).localeCompare(String(b.startTime))
    ),
  };

  const playableNow = next.concerts.filter((c) => c.playable).length;
  const pageOnlyNow = next.concerts.filter((c) => c.pageOnly).length;
  const blockedNow = next.concerts.filter((c) => c.blocked).length;
  const noArchiveNow = next.concerts.filter((c) => c.noArchive).length;
  console.log("Run         " + path.basename(resolvedPath) + "   week " + (run.week || "?"));
  console.log("Schedule    " + scheduleWhere);
  console.log("Added       " + added);
  console.log("Refreshed   " + refreshed + (lost ? "   (" + lost + " no longer reachable)" : ""));
  if (missingRow) {
    console.log("Skipped     " + missingRow + " reachable rows with no entry in the collected week");
  }
  console.log("Playable    " + next.concerts.length + " entries, " + playableNow + " still there, " +
    pageOnlyNow + " page only, " + blockedNow + " blocked, " + noArchiveNow + " no archive, " +
    "weeks " + weeks.join(", "));

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }
  write(playablePath, next);
  console.log("Written     " + playablePath);
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
