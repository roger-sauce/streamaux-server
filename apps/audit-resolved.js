#!/usr/bin/env node
// apps/audit-resolved.js
//
// Reads a resolver result and asks the questions its own counters cannot.
//
//   node audit-resolved.js data/resolved/resolved.json
//   node audit-resolved.js data/resolved/resolved-2026-09-06.json --quiet
//
// A RESOLVER file, not playable.json. All four questions below are about the
// MEDIA address a broadcast resolved to, and playable.json does not keep one --
// it holds the page and the share link, which is all the app needs. Running
// this against it answers nothing four times over, so it says so out loud in
// the last line rather than reporting all clear.
//
// WHY THIS EXISTS. On 07.09.2026 the first real run reported `ok 249` and
// `audio reachable 247` out of 383, and 33 of those were the wrong recording.
// Both numbers were true and neither could see it: `ok` says the adapter
// answered, `reachable` says the file exists, and a five-minute SWR2 piece from
// 2023 satisfies both while answering a WDR 3 Nachtkonzert of last week.
//
// What DOES see it needs no judgement and no second source: ONE ADDRESS
// SERVING BROADCASTS ON SEVERAL DIFFERENT DAYS. A recording belongs to a
// broadcast; two broadcasts on two days cannot share one. That single question
// found four distinct faults at once -- a stuck search, a livestream in
// disguise, a series page handing out its newest episode whatever was asked,
// and a file from 2024.
//
// So this file counts. It fixes nothing, decides nothing, and deliberately
// exits 0 whatever it finds: a report that fails a systemd unit is a report
// nobody leaves running. What it prints is meant to be diffed from week to
// week -- the number going down is the only evidence a fix worked, and today
// there is no such number at all.

"use strict";

const fs = require("fs");
const path = require("path");
const { optionOf } = require("./lib/rows");

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith("--")) {
  console.error(
    "Usage: node audit-resolved.js <resolved.json> [--quiet] [--limit <n>]\n" +
      "                              [--json <file>] [--history <file>]\n" +
      "       A RESOLVER file. playable.json keeps no media address, so it\n" +
      "       answers none of these questions."
  );
  process.exit(1);
}

// See optionOf in lib/rows.js: the shared version takes `args` rather than
// closing over it, which is what let three identical copies become one.
function option(name, fallback) {
  return optionOf(args, name, fallback);
}

const quiet = args.includes("--quiet");

/* --json writes what the report says, for something other than a person.
 *
 * The same computation, two renderings -- not a second script. The four
 * questions are the hard part and must not exist twice: two copies of a check
 * are how a monitor and a report come to disagree about the same week.
 *
 * An OPERATING file, not an application one. `playable.json` answers "what is
 * still there to listen to"; this answers "how did the runs go". Different
 * question, different reader, different lifetime. Folding the second into the
 * first was suggested on 08.09.2026 and refused, rightly -- it would have put
 * operating figures into the file people play from.
 */
const jsonOut = option("json", null);

/* --history appends one compact record per run to a file that is never
 * rewritten.
 *
 * A number without a yesterday cannot be read. "4 dates disagree" is neither
 * good nor bad on its own; four where there were nineteen is a fix working, and
 * four where there was one is something new. Roger asked for it on 08.09.2026
 * on seeing the first report -- rightly, and the answer was that a monitor with
 * no memory shows a state and never a direction.
 *
 * Appended, not recomputed. Each run knows only about itself, and a history
 * assembled from whatever files happen to still be lying around would change
 * shape every time one was cleaned up.
 */
const historyOut = option("history", null);

// How many rows of a finding travel. The worst check on the run of 06.09.2026
// held 71 entries; forty is enough to look at and keeps a file that is fetched
// by a phone from growing without a bound.
const FINDING_LIMIT = 40;

const HISTORY_NOTE =
  "One record per resolver run, appended and never rewritten. `stations` is " +
  "[asked, playable] per station. The findings behind the counts live in " +
  "resolver.json, which holds only the newest run.";
const limit = Number(option("limit", 12)) || 12;

/* The station livestreams, asked of the adapters that own them.
 *
 * Not a list of patterns. A guess at what a livestream address looks like
 * would be wrong in both directions -- it would miss the ones that look like
 * files and it would condemn archive recordings that happen to sit under
 * /stream/. The station adapters each hold their own live address as a
 * constant, so the exact answer is available for the asking.
 *
 * Optional on purpose. This runs inside the autoplay-pi container, where the
 * adapters and their dependencies are; on a host with a bare checkout the
 * require fails, and a report that refuses to run at all because ONE of its
 * four questions cannot be answered would be a poor trade.
 */
async function liveAddresses() {
  let dispatch = null;
  try {
    dispatch = require("./autoplay-pi/dispatch");
  } catch (e) {
    return null;
  }
  if (typeof dispatch.liveAddresses !== "function") return null;
  try {
    return await dispatch.liveAddresses();
  } catch (e) {
    return null;
  }
}

/* Everything except the parameters that vary between two requests for the SAME
 * recording -- signatures, expiry markers, aggregator tags.
 *
 * Origin and path alone was the first attempt, and it was wrong in a way that
 * produced the two biggest findings of the first run (08.09.2026). At Rai and
 * Ö1 the identity of the recording lives IN the query:
 *
 *     mediapolisvod.rai.it/relinker/relinkerServlet.htm?cont=<token>
 *     loopstream01.apa.at/?channel=oe1&id=2026-08-31_1405_...
 *
 * Ö1's path is only "/". Dropping the query merged 21 correct Rai answers into
 * one finding and 17 correct Ö1 answers into another -- 38 of 71, a monitor
 * reporting its own blindness as a station's fault. Checked entry by entry:
 * the tokens and ids differ per broadcast, and Ö1's id even carries the
 * broadcast's own local start time.
 *
 * The same pattern the resolver uses for signature markers, inverted: those
 * parameters are dropped, everything else is identity. Sorted, so that two
 * spellings of one address still meet.
 */
const VARYING_PARAM = /exp|token|sig|policy|key-pair|hdnts|md5|aggregator|^st$|^e$/i;

function addressKey(url) {
  try {
    const parsed = new URL(String(url));
    const kept = [...parsed.searchParams.entries()]
      .filter(([name]) => !VARYING_PARAM.test(name))
      .map(([name, value]) => name + "=" + value)
      .sort();
    return parsed.origin + parsed.pathname + (kept.length ? "?" + kept.join("&") : "");
  } catch (e) {
    return String(url || "");
  }
}

/* A date written into an address.
 *
 * `20240812-2000.mp3` and `.../2023/03/02/...` both say plainly which day the
 * file belongs to, and a station that writes one is telling the truth about it
 * -- the name is generated from the recording, not from the request. Where it
 * disagrees with the broadcast day by more than a day, the answer is not the
 * broadcast that was asked about, and no probe or counter can say otherwise.
 *
 * Only 8-digit runs that are a plausible date, and only where they are not
 * part of a longer run of digits: an id of 20240812345 is an id.
 */
function dateInAddress(url) {
  const text = String(url || "");
  const found = [];
  const pattern = /(?<!\d)(20\d{2})[-/.]?(0[1-9]|1[0-2])[-/.]?(0[1-9]|[12]\d|3[01])(?!\d)/g;
  let hit;
  while ((hit = pattern.exec(text)) !== null) {
    found.push(hit[1] + "-" + hit[2] + "-" + hit[3]);
  }
  return found;
}

/* The clock beside the date, where the address carries one.
 *
 * `20240812-2000.mp3` and `..._drk_20260831_0817_...` both name an hour, and
 * at a repeating station that hour is the thing that stays true while the date
 * does not. Concertzender, 08.09.2026: across one week the clock in the name
 * matched six times out of seven and the date twice -- because the name dates
 * the FIRST transmission and the schedule is largely repeats. Reported so a
 * reader sees that pattern instead of six findings.
 */
function timeInAddress(url) {
  const text = String(url || "");
  const found = [];
  const pattern = /(?<![\d:])([01]\d|2[0-3])[-_:]?([0-5]\d)(?![\d:])/g;
  let hit;
  while ((hit = pattern.exec(text)) !== null) found.push(hit[1] + ":" + hit[2]);
  return found;
}

function daysApart(a, b) {
  const first = Date.parse(a + "T12:00:00Z");
  const other = Date.parse(b + "T12:00:00Z");
  if (!Number.isFinite(first) || !Number.isFinite(other)) return null;
  return Math.abs(first - other) / 86400000;
}

// Both files this reads carry a list under a different name, and both hold the
// same fields for the purpose of these four questions.
function entriesOf(payload) {
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.concerts)) return payload.concerts;
  return [];
}

// The address a row actually resolved to. A resolver row keeps its tracks
// under `answer`; a playable.json row keeps none, and there the question
// cannot be asked -- said out loud rather than answered with zero findings.
function addressesOf(row) {
  const answer = row.answer || {};
  const tracks = Array.isArray(answer.tracks) ? answer.tracks : [];
  const found = tracks.map((t) => t && t.streamUrl).filter(Boolean);
  if (found.length) return found;
  const probe = row.probe || {};
  return probe.url ? [probe.url] : [];
}

/* Per station, over the whole working set.
 *
 * The one number that says whether a station is drifting: of its broadcasts
 * that were asked about, how many ended with audio. A run summary cannot show
 * that -- it counts one night, and a station goes wrong over weeks.
 */
/* What a finding is, once it has to travel.
 *
 * Names and clocks, and the FILE NAME rather than the address. The media
 * addresses are the one thing in a resolver file that must not be published:
 * they are the stations' own recordings, and `data/resolved/` is gitignored for
 * that reason. The last segment identifies the recording well enough to
 * recognise it -- "swr2-zeitwort-20230302-..." says what went wrong at a glance
 * -- and is not something anybody can play.
 */
function fileNameOf(url) {
  const text = String(url || "");
  try {
    const path = new URL(text).pathname;
    const last = path.split("/").filter(Boolean).pop() || path;
    return last.slice(0, 70);
  } catch (e) {
    return text.split("/").pop().slice(0, 70);
  }
}

function rowBrief(row) {
  return {
    id: row.id || null,
    station: row.stationId || null,
    dateKey: row.dateKey || null,
    startTime: row.startTime || null,
    title: row.title || null,
  };
}

function byStation(rows) {
  const found = new Map();
  for (const row of rows) {
    const id = row.stationId || "?";
    if (!found.has(id)) {
      found.set(id, {
        station: id,
        name: row.station || id,
        entries: 0, playable: 0, suggested: 0, failed: 0,
        unclaimed: 0, unsupported: 0, live: 0, gaveUp: 0,
      });
    }
    const one = found.get(id);
    const probe = row.probe || {};
    const suggested = row.status === "suggested" || !!(row.answer && row.answer.suggestion);
    one.entries += 1;
    if (suggested) one.suggested += 1;
    else if (row.status === "unclaimed") one.unclaimed += 1;
    else if (row.status === "unsupported") one.unsupported += 1;
    else if (probe.verdict === "reachable" && !probe.live) one.playable += 1;
    else one.failed += 1;
    if (probe.live) one.live += 1;
    if (row.gaveUp) one.gaveUp += 1;
  }
  return [...found.values()].sort((a, b) => b.entries - a.entries);
}

function plainly(text) {
  console.log("");
  console.log(text);
}

function pad(text, width) {
  const value = String(text === null || text === undefined ? "" : text);
  return value.length > width ? value.slice(0, width - 1) + "…" : value.padEnd(width);
}

// "1 addresses" in a report about carelessness reads badly.
function count(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// The same set the last line of the report counts, so the file and the page
// cannot disagree about it.
function suspectCount(spread, mismatched) {
  const suspect = new Set();
  for (const finding of spread) for (const row of finding.bucket.rows) suspect.add(row.id);
  for (const finding of mismatched) suspect.add(finding.row.id);
  return suspect.size;
}

function heading(text) {
  console.log("");
  console.log(text);
  console.log("-".repeat(Math.min(78, text.length + 20)));
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = entriesOf(payload);
  const live = await liveAddresses();

  console.log("File        " + file);
  console.log("Entries     " + rows.length +
    (payload.week ? "   run week " + payload.week : "") +
    (Array.isArray(payload.weeks) ? "   weeks " + payload.weeks.join(", ") : ""));
  console.log("Livestreams " + (live
    ? live.size + " station addresses, asked of the adapters"
    : "not checked -- the adapters are not loadable from here"));

  if (rows.length && rows.every((r) => !addressesOf(r).length)) {
    plainly("NOTE  Not one row carries a media address. This is a resolver file's");
    console.log("      question -- playable.json keeps the page, not the recording --");
    console.log("      so what follows is four times nothing, and not four times clear.");
  }

  // One bucket per address, carrying the rows that resolved to it.
  const byAddress = new Map();
  let withoutAddress = 0;
  for (const row of rows) {
    const found = addressesOf(row);
    if (!found.length) {
      withoutAddress += 1;
      continue;
    }
    for (const url of found) {
      const key = addressKey(url);
      if (!byAddress.has(key)) byAddress.set(key, { url: url, rows: [] });
      byAddress.get(key).rows.push(row);
    }
  }

  /* ---------------------------------------------------------------- 1 --- */

  const spread = [];
  const sameDay = [];
  for (const bucket of byAddress.values()) {
    const days = new Set(bucket.rows.map((r) => r.dateKey).filter(Boolean));
    if (days.size > 1) spread.push({ bucket: bucket, days: [...days].sort() });
    else if (bucket.rows.length > 1) sameDay.push(bucket);
  }
  spread.sort((a, b) => b.bucket.rows.length - a.bucket.rows.length);

  heading("1. One address, broadcasts on several days");
  const spreadRows = spread.reduce((n, s) => n + s.bucket.rows.length, 0);
  console.log(count(spread.length, "address", "addresses") + ", " +
    count(spreadRows, "entry", "entries") + ".");
  if (spread.length && !quiet) {
    console.log("");
    for (const finding of spread.slice(0, limit)) {
      const stations = [...new Set(finding.bucket.rows.map((r) => r.stationId))];
      console.log("  " + finding.bucket.rows.length + " entries, " +
        finding.days.length + " days: " + finding.days.join(" ") +
        "   [" + stations.join(", ") + "]");
      console.log("    " + finding.bucket.url);
      const titles = [...new Set(finding.bucket.rows.map((r) => r.title).filter(Boolean))];
      // One title across several days is what a REPEAT looks like, and a
      // repeat sharing one recording is correct. Concertzender broadcasts the
      // same concert twice in a week; the finding was the monitor's, not the
      // station's. Said rather than filtered: the same shape also fits an
      // adapter stuck on one answer, and only the titles tell them apart.
      if (titles.length === 1) {
        console.log("    ONE TITLE -- may be a repeat, which shares a recording by right");
      }
      for (const title of titles.slice(0, 4)) console.log("      " + title);
      if (titles.length > 4) console.log("      ... and " + (titles.length - 4) + " more");
      console.log("");
    }
    if (spread.length > limit) {
      console.log("  ... and " + (spread.length - limit) + " more addresses.");
    }
  }

  /* ---------------------------------------------------------------- 2 --- */

  /* Two different things had been counted as one, until 15.09.2026.
   *
   * An address with several entries on ONE day is either of these:
   *
   *   several STATIONS, one recording   a simulcast. Correct, and the normal
   *                                     state of the ARD Kulturwellen -- the
   *                                     collector marks the group itself.
   *   one station, TWICE                the same shape as finding 1, only
   *                                     inside a day. Nothing entitles one
   *                                     station to answer the same file for
   *                                     two of its own broadcasts.
   *
   * The line said "186, plausible, unverified" and left the reader with a
   * number that could mean either. Roger, 15.09.2026: an orange number with
   * nothing behind it says nothing -- "was sagt mir die Zahl wenn ich die
   * nicht im detail ueberpruefen kann?"
   *
   * Finding 1 already draws this distinction with `oneTitle`. This is the same
   * question asked one day at a time.
   */
  function repeatsAStation(bucket) {
    const seen = new Set();
    for (const row of bucket.rows) {
      const id = row.stationId;
      if (!id) continue;
      if (seen.has(id)) return true;
      seen.add(id);
    }
    return false;
  }

  const sameDaySuspect = sameDay.filter(repeatsAStation);

  heading("2. One address, one day, several start times");
  const sameDayRows = sameDay.reduce((n, b) => n + b.rows.length, 0);
  const sameDaySuspectRows = sameDaySuspect.reduce((n, b) => n + b.rows.length, 0);
  console.log(count(sameDay.length, "address", "addresses") + ", " +
    count(sameDayRows, "entry", "entries") + ".");
  console.log(count(sameDaySuspect.length, "address", "addresses") + " of them repeat a " +
    "STATION -- the rest are simulcasts, which share a recording by right.");
  if (sameDaySuspect.length && !quiet) {
    console.log("");
    for (const bucket of sameDaySuspect.slice(0, limit)) {
      const stations = [...new Set(bucket.rows.map((r) => r.stationId))];
      console.log("  " + bucket.rows.length + " entries   [" + stations.join(", ") + "]");
      console.log("    " + bucket.url);
      for (const row of bucket.rows.slice(0, 4)) {
        console.log("      " + (row.startTime || "?") + "  " + (row.title || "?"));
      }
      console.log("");
    }
    if (sameDaySuspect.length > limit) {
      console.log("  ... and " + (sameDaySuspect.length - limit) + " more addresses.");
    }
  }

  /* ---------------------------------------------------------------- 3 --- */

  const mismatched = [];
  for (const row of rows) {
    if (!row.dateKey) continue;
    for (const url of addressesOf(row)) {
      const dates = dateInAddress(url);
      if (!dates.length) continue;
      // The closest one wins. An address can carry a series id and an episode
      // date, and condemning it for the wrong one would be the same fault this
      // file was written to find.
      const gaps = dates.map((d) => daysApart(d, row.dateKey)).filter((n) => n !== null);
      if (!gaps.length) continue;
      const nearest = Math.min(...gaps);
      if (nearest > 1) {
        mismatched.push({ row: row, url: url, days: nearest, dates: dates });
        break;
      }
    }
  }
  mismatched.sort((a, b) => b.days - a.days);

  heading("3. A date in the address that disagrees with the broadcast day");
  console.log(count(mismatched.length, "entry", "entries") + ".");
  if (mismatched.length && !quiet) {
    console.log("A clock that fits while the date does not is a REPEAT naming its first");
    console.log("transmission, and that is a correct answer -- see Concertzender.");
  }
  if (mismatched.length && !quiet) {
    console.log("");
    console.log("  " + pad("station", 24) + pad("broadcast", 12) +
      pad("in the address", 16) + pad("off by", 12) + "clock");
    for (const finding of mismatched.slice(0, limit)) {
      console.log("  " + pad(finding.row.stationId, 24) + pad(finding.row.dateKey, 12) +
        pad(finding.dates.join(","), 16) +
        pad(Math.round(finding.days) + " days", 12) +
        (timeInAddress(finding.url).join(",") || "-"));
      console.log("    " + finding.row.title);
    }
    if (mismatched.length > limit) {
      console.log("  ... and " + (mismatched.length - limit) + " more.");
    }
  }

  /* ---------------------------------------------------------------- 4 --- */

  let liveCaught = null;
  let liveUnflagged = null;
  let liveFindings = [];

  heading("4. A station's livestream, answered as a recording");
  if (!live) {
    console.log("Not checked -- run this inside the autoplay-pi container, where");
    console.log("the station adapters are, and it asks each of them for its own address.");
  } else {
    const caught = [];
    for (const row of rows) {
      for (const url of addressesOf(row)) {
        if (!live.has(addressKey(url))) continue;
        caught.push({ row: row, url: url, flagged: !!(row.probe && row.probe.live) });
        break;
      }
    }
    const unflagged = caught.filter((c) => !c.flagged);
    liveCaught = caught.length;
    liveUnflagged = unflagged.length;
    liveFindings = caught.map((one) => Object.assign(
      { file: fileNameOf(one.url), marked: one.flagged }, rowBrief(one.row)
    ));
    console.log(count(caught.length, "entry", "entries") +
      " resolved to a station livestream, " +
      unflagged.length + " of them NOT marked live by the run.");
    if (unflagged.length) {
      console.log("");
      console.log("An unmarked one is counted among the archive recordings and reaches");
      console.log("playable.json as something to listen back to. It is always up, so the");
      console.log("probe agrees, and the row is wrong every day without ever failing.");
    }
    if (caught.length && !quiet) {
      const byStation = new Map();
      for (const one of caught) {
        const id = one.row.stationId || "?";
        byStation.set(id, (byStation.get(id) || 0) + 1);
      }
      console.log("");
      for (const [id, count] of [...byStation].sort((a, b) => b[1] - a[1])) {
        console.log("  " + pad(id, 24) + count);
      }
    }
  }

  /* ------------------------------------------------------------ totals --- */

  if (jsonOut) {
    /* Counts and names, never the addresses.
     *
     * The addresses in a resolver file are media URLs from a home-network run,
     * which is why `data/resolved/` is gitignored. This file is published, so
     * what travels is how many and which station -- enough to see a fault and
     * to know where to look, and nothing that is somebody else's to serve.
     */
    const report = {
      generatedAt: new Date().toISOString(),
      source: path.basename(file),
      // Straight from the run, because these cannot be recomputed from the
      // entries: they are about what was ASKED. See payload.run.
      run: payload.run || null,
      week: payload.week || null,
      collected: payload.generatedAt || null,
      working: {
        entries: rows.length,
        withoutAddress: withoutAddress,
        gaveUp: rows.filter((r) => r.gaveUp).length,
      },
      totals: payload.totals || null,
      reach: payload.reach || null,
      checks: {
        spreadAddresses: spread.length,
        spreadEntries: spreadRows,
        sameDayAddresses: sameDay.length,
        sameDayEntries: sameDayRows,
        // The half of the above that is NOT a simulcast: one station answering
        // the same file for two of its own broadcasts on one day.
        sameDaySuspectAddresses: sameDaySuspect.length,
        sameDaySuspectEntries: sameDaySuspectRows,
        dateMismatch: mismatched.length,
        livestreams: liveCaught,
        livestreamsUnmarked: liveUnflagged,
        answered: null,
      },
      stations: byStation(rows),
      /* The rows behind the four numbers.
       *
       * Roger, 08.09.2026, on the first report in the app: "hier muessen wir
       * die Zahlen aufloesen koennen, ich muss wissen welches die one address
       * several days ist". A count that cannot be opened is a count nobody can
       * act on -- and acting on it means going to the station and looking,
       * which needs a name and a day.
       */
      findings: {
        spread: spread.slice(0, FINDING_LIMIT).map((finding) => ({
          file: fileNameOf(finding.bucket.url),
          days: finding.days,
          stations: [...new Set(finding.bucket.rows.map((r) => r.stationId).filter(Boolean))],
          // One title across several days is what a repeat looks like, and a
          // repeat sharing one recording is correct. Said rather than filtered:
          // the same shape also fits an adapter stuck on one answer.
          oneTitle: new Set(finding.bucket.rows.map((r) => r.title)).size === 1,
          entries: finding.bucket.rows.slice(0, FINDING_LIMIT).map(rowBrief),
        })),
        dateMismatch: mismatched.slice(0, FINDING_LIMIT).map((finding) => ({
          file: fileNameOf(finding.url),
          inAddress: finding.dates,
          clock: timeInAddress(finding.url),
          days: Math.round(finding.days),
          entry: rowBrief(finding.row),
        })),
        livestreams: liveFindings.slice(0, FINDING_LIMIT),
        // Only the suspect ones. A list of correct simulcasts would be a page
        // of rows that are all right, and nobody reads that twice.
        sameDay: sameDaySuspect.slice(0, FINDING_LIMIT).map((bucket) => ({
          file: fileNameOf(bucket.url),
          stations: [...new Set(bucket.rows.map((r) => r.stationId).filter(Boolean))],
          entries: bucket.rows.slice(0, FINDING_LIMIT).map(rowBrief),
        })),
      },
    };
    report.checks.answered = suspectCount(spread, mismatched);
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut + ".tmp", JSON.stringify(report, null, 2));
    fs.renameSync(jsonOut + ".tmp", jsonOut);
    console.log("");
    console.log("Written     " + jsonOut);

    if (historyOut) {
      /* One line per run, and the file grows.
       *
       * Deliberately not the findings -- a year of those would be megabytes and
       * nobody reads last March's row. What a trend needs is the counts, and
       * per station the two numbers that make a share: asked and playable.
       * Twenty-seven stations at some twenty bytes is about half a kilobyte a
       * night, a fifth of a megabyte a year.
       *
       * A run that cannot be appended is a warning and never a failure: the
       * report itself is already written, and losing an archive over a history
       * entry would be the wrong trade.
       */
      const record = {
        at: report.generatedAt,
        mode: (report.run && report.run.mode) || null,
        week: report.week,
        entries: report.working.entries,
        totals: report.totals,
        reach: report.reach,
        checks: report.checks,
        gaveUp: report.working.gaveUp,
        adapters: (report.run && report.run.adapters) || null,
        stations: report.stations.reduce(function (found, one) {
          found[one.station] = [one.entries, one.playable];
          return found;
        }, Object.create(null)),
      };
      try {
        let history = { note: HISTORY_NOTE, runs: [] };
        try {
          const old = JSON.parse(fs.readFileSync(historyOut, "utf8"));
          if (old && Array.isArray(old.runs)) history = old;
        } catch (e) {
          // No history yet. This run starts it.
        }
        history.note = HISTORY_NOTE;
        history.runs.push(record);
        fs.writeFileSync(historyOut + ".tmp", JSON.stringify(history, null, 2));
        fs.renameSync(historyOut + ".tmp", historyOut);
        console.log("Appended    " + historyOut + "  (" + history.runs.length + " runs)");
      } catch (e) {
        console.log("WARNING     the history could not be written: " + e.message);
      }
    }
  }

  heading("In one line");
  const suspect = new Set();
  for (const finding of spread) for (const row of finding.bucket.rows) suspect.add(row.id);
  for (const finding of mismatched) suspect.add(finding.row.id);
  console.log(suspect.size + " of " + rows.length + " entries are answered by at least one" +
    " of these questions." +
    (withoutAddress ? "  (" + withoutAddress + " carry no address at all.)" : ""));
}

main().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
