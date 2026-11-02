#!/usr/bin/env node
"use strict";

/* The week, walked once while it can still be walked.
 *
 *   node resolve-week.js https://konzertguide.rogzilla.eu/data/schedule.json
 *   node resolve-week.js ../../konzert-guide/snapshots/schedule-2026-08-26.json
 *   node resolve-week.js <source> --station rne_radio3 --limit 20 --probe
 *   node resolve-week.js --reprobe data/resolved/resolved-2026-08-24.json
 *
 * WHY THIS EXISTS, and what it can and cannot do.
 *
 * A concert in the guide is an address on a broadcaster's page. Whether that
 * address still leads to a recording is a question with an expiry date: the
 * archive windows close. How soon is a question this run is meant to ANSWER
 * rather than assume -- see retention.js, which starts with a single
 * documented rule and grows from measurement.
 *
 * What this run preserves is EVIDENCE, not audio. For every entry it records
 * which adapter claimed the address, whether that adapter found a recording,
 * how many pieces it had and what they were called. It downloads nothing: the
 * probe reads one byte.
 *
 * It DOES keep the media addresses, and that is a correction. This file used
 * to say they were "mostly signed and dead within hours", which was an
 * assumption dressed as a fact. Radio France hands out plain static podcast
 * addresses with no signature parameter at all -- checked on 31.08.2026, seven
 * of seven -- and for those the address is as durable as the file behind it.
 *
 * A full week measured on 31.08.2026 went further: of 148 media addresses
 * across twelve hosts, Akamai among them, NOT ONE carried a signature
 * parameter. So "others will be signed" was a hedge that did not survive
 * either. The address is written down together with whatever expiry markers it
 * carries (Expires, hdnts, token ...), and a later reader can tell a durable
 * one from a signed one instead of taking anybody's word for it.
 *
 * That evidence is worth having for two reasons. It is the only way to measure
 * the adapters against real material rather than against a handful of examples
 * -- 390 entries a week, every station, every wording a broadcaster uses. And
 * it dates the failures: an address that resolved on Sunday and refuses in
 * December has expired, while one that never resolved at all is an adapter
 * with something missing. Those two look identical without a record.
 *
 * WHERE IT RUNS. Here, next to the adapters, and not in the konzert-guide's
 * cron container. The knowledge about resolving an address lives in
 * apps/adapters; calling it over HTTP from the other Pi would mean an
 * AUTOPLAY_KEY on a second machine and a network hop for every one of several
 * hundred entries, in exchange for nothing.
 *
 * Sequential, with a pause between entries. Several of these adapters start a
 * browser, and a fan-out would measure this machine rather than the stations.
 * The pause is per host, not global: twenty-seven broadcasters take turns, and
 * making the fast ones wait for the slow ones only lengthens the run.
 *
 * The result file is rewritten after every entry. A run over a full week takes
 * the better part of an hour, and a crash at entry 380 should not throw away
 * the first 379.
 *
 * --reprobe takes one of these result files and knocks on the addresses again:
 * one byte each, no adapter, no broadcaster page. Every pass appends to the
 * entry's `checks`, so after a few weeks the file says in numbers how long the
 * addresses of each station actually live. That is the one question no terms
 * of service answers reliably.
 *
 * --reresolve is the other half, and it exists because --reprobe cannot answer
 * a question RNE raised on 31.08.2026: of thirty entries, twenty-one were
 * refused with "RNE lists no edition for that date", and the refusals fell on
 * the NEWEST days rather than the oldest. That is the opposite of expiry and
 * looks like a publication delay -- but a probe never revisits the series page,
 * so it cannot tell. --reresolve runs the adapters again for everything that is
 * not yet `ok`, and appends to the entry's `attempts`. Refused on Monday, ok on
 * Thursday is a delay; refused both times is something else.
 */

const fs = require("fs");
const path = require("path");
const {
  SIGNATURE_PARAM,
  ASSUMED_LENGTH_MIN,
  isoDate,
  signatureMarkers,
  answerOf,
  endsAt,
  isSettled,
  isDone,
  weekOf,
  weekOfDay,
  ageInDays,
  optionOf,
} = require("./lib/rows");
const {
  detectAdapter, liveAddresses, isLiveAddress, adaptersVersion,
} = require("./autoplay-pi/dispatch");
const { isUnsupported } = require("./adapters/_shared");
const { sharedUrl } = require("./kg-url");
const { retentionFor, retentionState } = require("./retention");

const args = process.argv.slice(2);

// See optionOf in lib/rows.js: the shared version takes `args` rather than
// closing over it, which is what let three identical copies become one.
function option(name, fallback) {
  return optionOf(args, name, fallback);
}

const reprobeFile = option("reprobe", null);
const reresolveFile = option("reresolve", null);
const modeFile = reprobeFile || reresolveFile;
const source = modeFile ? null : args[0];
if (!modeFile && (!source || source.startsWith("--"))) {
  console.error(
    "Usage: node resolve-week.js <schedule.json|URL> [--probe] [--out <dir>]\n" +
      "                           [--station <id>] [--limit <n>] [--delay <ms>] [--timeout <s>]\n" +
      "       node resolve-week.js --reprobe <result.json> [--delay <ms>]\n" +
      "       node resolve-week.js --reresolve <result.json> [--probe] [--station <id>]\n" +
      "       node resolve-week.js <schedule.json|URL> --daily --probe [--out <dir>]"
  );
  process.exit(1);
}

const outDir = option("out", path.join(__dirname, "..", "data", "resolved"));
const onlyStation = option("station", null);
const limit = Number(option("limit", 0)) || 0;
const delayMs = Number(option("delay", 2000));
const timeoutMs = Number(option("timeout", 90)) * 1000;
const doProbe = args.includes("--probe");

/* --daily: the same week, asked a day at a time.
 *
 * The Sunday-night run over a whole week asks about Monday's broadcasts six
 * days after the archive page appeared, and about Sunday's an hour after. For
 * the app that is the wrong way round: what a listener wants on Tuesday is
 * Monday's concert, and a weekly run cannot give it to them before the
 * weekend.
 *
 * So this mode takes the broadcasts that are over and folds its answers into
 * one standing file, resolved.json -- no date in the name, because it is a
 * working set rather than one pass over anything. An entry whose probe found
 * audio is settled and is not asked again; everything else is asked once more
 * the next day, because "not published yet" on Tuesday and "not there" on
 * Sunday are different answers and only the last one is worth keeping.
 *
 * THE WINDOW IS THE BROADCAST, NOT THE WEEK (Roger, 07.09.2026). Stations
 * publish late, and by different amounts: a concert that is missing from the
 * archive on Wednesday can be there on Thursday. So an unanswered entry is
 * asked again every day for seven days from the end of the broadcast, and then
 * given up on -- what is not there after a week is not coming.
 *
 * That window does not fit inside a week, and an earlier draft of this mode
 * got it wrong by making the file weekly: a Sunday concert would have been
 * asked about once before Monday started a fresh file. So the file is NOT
 * reset at the turn of the week. It carries last week's unanswered entries
 * along, and those carry everything the loop needs -- title, times, address --
 * so they rejoin the queue as ordinary entries even though this week's
 * collection no longer mentions them.
 *
 * It requires --probe. Without the probe there is no verdict, nothing is ever
 * settled, and every day would ask every station about every broadcast again.
 */
const daily = args.includes("--daily");
if (daily && !doProbe) {
  console.error("--daily needs --probe: without a verdict nothing is ever settled,");
  console.error("and every day would ask every station about the whole week again.");
  process.exit(1);
}

const PROBE_TIMEOUT_MS = 15000;

// The adapters as they stand for this run, written onto every row. Read once:
// they cannot change while the process lives.
const ADAPTERS_VERSION = adaptersVersion();

// Padded so the four verdicts line up under one another in the log.
const PROBE_LABEL = {
  reachable: "AUDIO     ",
  gone: "GONE      ",
  blocked: "BLOCKED   ",
  error: "NO ANSWER ",
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function firstLine(text) {
  return String(text || "").split("\n")[0].trim();
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return "?";
  }
}




/* --- the probe ----------------------------------------------------------
 *
 * "The adapter answered" and "there is audio" are not the same statement, and
 * the first one looks like the second in a table. Seven France Musique entries
 * came back OK in a tenth of a second each on 31.08.2026 -- fast enough to
 * show that the adapter had assembled a media address out of the page id
 * without ever touching it. A record built on that would overstate itself.
 *
 * So: one byte, never a download. HEAD first, and a ranged GET where HEAD is
 * refused, which happens often enough to be worth handling rather than
 * counting as a failure.
 */

/* Who is knocking.
 *
 * Node's fetch sends no User-Agent worth the name, and a fair number of
 * origins answer that with 403 or by dropping the connection. So this one says
 * plainly what it is and where to complain.
 *
 * That is the opposite of the other thing one could do here. Imitating a
 * browser's fingerprint to get past a bot defence was refused once already,
 * for Sveriges Radio, and the line holds: identifying yourself honestly is
 * being a well-behaved client, pretending to be Chrome is defeating a measure
 * someone put there on purpose. If a station still says no to this, the answer
 * is no.
 */
// The `+` address names WHO is probing. It pointed at one particular guide
// until 02.11.2026; since this repository is public it names the project,
// which is the honest answer for every installation rather than for one.
// PROBE_CONTACT overrides it for anyone who would rather be reachable at
// their own address.
const PROBE_CONTACT =
  process.env.PROBE_CONTACT || "https://github.com/roger-sauce/streamaux-server";
const PROBE_AGENT =
  "streamaux-resolve-week/1.0 (availability probe, one byte; +" + PROBE_CONTACT + ")";

// Reading the headers is enough; fetch resolves once they are in, and the body
// is dropped rather than drained.
async function peek(url, method, extraHeaders) {
  const started = Date.now();
  const headers = Object.assign({ "User-Agent": PROBE_AGENT }, extraHeaders || {});
  const answer = await Promise.race([
    fetch(url, { method: method, headers: headers, redirect: "follow" }),
    new Promise(function (_, reject) {
      setTimeout(() => reject(new Error("no answer within 15s")), PROBE_TIMEOUT_MS);
    }),
  ]);
  if (answer.body) {
    try {
      await answer.body.cancel();
    } catch (e) {
      // A server that closed the connection itself is not a fault worth
      // reporting -- the headers, which is all this wanted, are already here.
    }
  }
  return {
    method: method,
    status: answer.status,
    contentType: answer.headers.get("content-type") || null,
    contentLength: answer.headers.get("content-length") || null,
    redirectedTo: answer.redirected ? hostOf(answer.url) : null,
    ms: Date.now() - started,
  };
}

// The transport code behind "fetch failed", which on its own says nothing.
// ECONNRESET and ECONNREFUSED read very differently from ENOTFOUND when one is
// trying to work out whether a host is throttling or simply gone.
function causeOf(e) {
  const cause = e && e.cause;
  return (cause && (cause.code || cause.errno)) || null;
}

// HEAD, and a one-byte range where HEAD is not answered properly. 405 and 501
// are the honest refusals; 403 on HEAD is common enough to treat the same way,
// and a 200 without a Content-Length says too little to rest on.
//
// One retry on a transport failure, because seven of nine connection drops
// against a single host (ztnr.rtve.es, 31.08.2026) looks far more like
// throttling than like nine missing files -- and a probe that cannot tell
// those apart is worse than no probe.
async function oneByte(url) {
  let head = null;
  try {
    head = await peek(url, "HEAD");
    const refused = head.status === 405 || head.status === 501 || head.status === 403;
    if (!refused && head.contentLength) return head;
  } catch (e) {
    head = { method: "HEAD", error: firstLine(e.message), errorKind: causeOf(e) };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ranged = await peek(url, "GET", { Range: "bytes=0-0" });
      ranged.headRefused = head && head.status ? head.status : (head && head.error) || null;
      if (attempt) ranged.retried = true;
      return ranged;
    } catch (e) {
      if (attempt) throw e;
      await sleep(3000);
    }
  }
  return head;
}

/* What a status code means for THIS question, which is not "did the request
 * work" but "is the recording still there".
 *
 *   reachable  it answered with the audio
 *   gone       404 or 410 -- the file is not there any more. The only verdict
 *              that may ever contradict a retention rule.
 *   blocked    401, 403, 451 -- it is there and we are not allowed at it. A
 *              geo-block or a rights restriction is not an expiry, and
 *              counting it as one would write "expired after 6 days" into
 *              the record for a recording sitting there perfectly intact.
 *   error      no answer at all. We do not know, and the record should say so
 *              rather than guess in either direction.
 */
function verdictFor(status) {
  if (status >= 200 && status < 400) return "reachable";
  if (status === 404 || status === 410) return "gone";
  if (status === 401 || status === 403 || status === 451) return "blocked";
  return "error";
}

function looksLikeHls(url, contentType) {
  return /\.m3u8(\?|$)/i.test(String(url)) ||
    /mpegurl/i.test(String(contentType || ""));
}

// The first real line of a playlist, resolved against the playlist's own
// address. A master playlist points at variant playlists rather than at
// segments, hence one more turn -- but only one, because a chain longer than
// that is not something this needs to understand.
async function firstMediaUri(manifestUrl, depth) {
  const answer = await fetch(manifestUrl, { redirect: "follow" });
  if (!answer.ok) throw new Error("playlist answered " + answer.status);
  const text = await answer.text();
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line) throw new Error("playlist carries no entry");
  const resolved = new URL(line, answer.url).toString();
  if (/\.m3u8(\?|$)/i.test(resolved) && depth < 2) {
    return firstMediaUri(resolved, depth + 1);
  }
  return resolved;
}

async function probeTrack(track, sourceType) {
  const url = track && track.streamUrl;
  if (!url) return { verdict: "no address", url: null };

  // Two witnesses, and the second is the one that works. `sourceType ===
  // "live"` is what the adapter CALLS its answer, and no station adapter says
  // "live" -- deutschlandfunk-kultur.live() says "deutschlandfunk-kultur". Ten
  // livestreams went into the first real run as archive recordings on the
  // strength of that, and the run reported `live 0`. `isLiveAddress` compares
  // the address against what each station says its own stream is, which is a
  // fact rather than a name. See dispatch.liveAddresses.
  const result = { url: url, live: sourceType === "live" || isLiveAddress(url) };
  try {
    result.head = await oneByte(url);
    result.verdict = verdictFor(result.head.status);

    if (result.verdict === "reachable" && looksLikeHls(url, result.head.contentType)) {
      // A 200 on a playlist means the playlist is served. It says nothing
      // about the audio, and this record is meant to be believed later.
      const segmentUrl = await firstMediaUri(url, 0);
      const segment = await oneByte(segmentUrl);
      result.segment = Object.assign({ url: segmentUrl }, segment);
      result.verdict = verdictFor(segment.status);
    }
  } catch (e) {
    // No answer at all: a reset, a refused connection, a timeout. Deliberately
    // NOT "gone" -- see verdictFor.
    result.verdict = "error";
    result.error = firstLine(e.message).slice(0, 200);
    result.errorKind = causeOf(e);
  }
  return result;
}



// A name for each adapter module, so the record says "rtve-series" rather than
// the anonymous object the dispatcher hands back. Same approach as
// check-schedule.js: require the files the dispatcher requires, and let node's
// module cache make the objects compare identical.
function adapterNames() {
  const names = new Map();
  for (const dir of ["adapters", "adapters/radiostations"]) {
    const full = path.join(__dirname, dir);
    let entries = [];
    try {
      entries = fs.readdirSync(full);
    } catch (e) {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".js")) continue;
      try {
        // A require with a computed path, and a safe one: `full` is this
        // repository's own adapter directory and `name` came from reading it.
        // No disable directive here -- eslint-plugin-security is configured in
        // konzert-guide but not in this repository, and a directive for a rule
        // that does not exist is itself an error (found 02.09.2026).
        const mod = require(path.join(full, name));
        names.set(mod, name.replace(/\.js$/, ""));
      } catch (e) {
        continue;
      }
    }
  }
  return names;
}

async function readSchedule(where) {
  if (/^https?:\/\//i.test(where)) {
    const answer = await fetch(where, { headers: { Accept: "application/json" } });
    if (!answer.ok) throw new Error("The guide answered " + answer.status);
    return answer.json();
  }
  return JSON.parse(fs.readFileSync(where, "utf8"));
}

async function extractWithTimeout(adapter, url) {
  let timer;
  const expired = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(new Error("no answer within " + Math.round(timeoutMs / 1000) + "s"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([adapter.extract(url), expired]);
  } finally {
    clearTimeout(timer);
  }
}



// How long a broadcast is worth asking about, counted from its end. Seven days
// (Roger, 07.09.2026): long enough for the slowest publisher measured so far,
// short enough that the record does not fill up with nightly refusals about
// concerts from the spring.
const RETRY_DAYS = 7;

// How long an entry stays in the daily file after it is finished with. The
// lasting record is playable.json; this one is the working set, and it is
// rewritten after every entry of every run, so a year of them would make each
// night's run slower than the night before.
const KEEP_DAYS = 30;




/* An entry from an earlier day, put back into the shape the loop expects.
 *
 * This is what lets the seven-day window outlive the week. The row was written
 * from a collection that is no longer the current one, and everything the loop
 * reads -- the address, the start, the length, the station -- is on it, so it
 * can be asked about again without the collection it came from.
 */
function concertFromRow(row) {
  return {
    id: row.id,
    stationId: row.stationId,
    station: row.station,
    title: row.title,
    subtitle: row.subtitle || null,
    genre: row.genre || null,
    startTime: row.startTime,
    dateKey: row.dateKey,
    time: row.time || null,
    durationMin: row.durationMin,
    broadcastUrl: row.broadcastUrl,
  };
}


function writeResult(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(payload, null, 2));
  fs.renameSync(file + ".tmp", file);
}

/* An unfinished result file from an earlier attempt at the same week.
 *
 * A full run is around 390 entries with a pause between them and a browser
 * started for several of them -- the better part of an hour, unattended, at ten
 * on a Sunday night. If it dies at entry 380, nobody is watching and nothing
 * retries it; without this, the next attempt would start at one and the week
 * would cost two hours instead of one, or be given up on.
 *
 * Found by the FILE and not by the name. The name carries the run date, so a
 * run that dies at 23:50 and is restarted after midnight would otherwise write
 * a second file and resume nothing. This looks for the newest one that is not
 * `finished` and was made from the same source, and keeps writing into it --
 * one attempt at a week is one file, however many times it was started.
 *
 * `source` has to match, which is what keeps last week's abandoned file out of
 * this week's run.
 */
function findResumable(dir, wantedSource) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return null;
  }
  const candidates = names
    .filter((n) => /^resolved-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  for (const name of candidates) {
    const full = path.join(dir, name);
    try {
      const old = JSON.parse(fs.readFileSync(full, "utf8"));
      if (
        old &&
        old.finished !== true &&
        old.source === wantedSource &&
        Array.isArray(old.entries) &&
        old.entries.length
      ) {
        return { file: full, payload: old };
      }
    } catch (e) {
      // Unreadable or half-written: not a resume point, and not a reason to
      // stop looking at the others.
    }
  }
  return null;
}

async function main() {
  const raw = await readSchedule(source);
  const all = Array.isArray(raw.concerts) ? raw.concerts : [];
  const names = adapterNames();

  let concerts = all;
  if (onlyStation) concerts = concerts.filter((c) => c.stationId === onlyStation);
  if (limit) concerts = concerts.slice(0, limit);

  // Only a full run resumes. A --station or --limit run is a test by hand, and
  // letting one of those adopt an interrupted week's file would mix a probe of
  // three entries into the record of a whole one.
  // --daily has its own way back into an unfinished file (see `carried`), and
  // it looks for the week rather than for a run, so the resume point of a
  // weekly run is none of its business.
  const resume = daily || onlyStation || limit ? null : findResumable(outDir, source);

  // Named after the run, not after the week it walked. The file is a record of
  // one pass over the adapters, and --reprobe/--reresolve add later passes to
  // it; the day it was made is the thing that identifies it. The week is in
  // `week` below, where it can be read without decoding a filename. A resumed
  // run keeps the file it is continuing, name and all.
  const startedAt = new Date();
  const day = startedAt.toISOString().slice(0, 10);
  let file = resume ? resume.file : path.join(outDir, "resolved-" + day + ".json");
  // One standing file, not one per run: the daily passes are days of the same
  // working set, and a name with a date in it would make one file a day.
  if (daily) file = path.join(outDir, "resolved.json");

  // A run by hand must not overwrite an interrupted full run of the same day.
  // It would be a silent loss and a costly one: the file IS the resume point,
  // so the hand test would quietly turn a run that had two hundred entries
  // behind it into one that starts at zero. Found while testing the resume,
  // 02.09.2026 -- the feature had made its own evidence destroyable.
  if (!resume && (onlyStation || limit)) {
    let unfinished = false;
    try {
      unfinished = JSON.parse(fs.readFileSync(file, "utf8")).finished !== true;
    } catch (e) {
      // No file, or none that can be read: nothing to protect.
    }
    if (unfinished) {
      file = path.join(outDir, "resolved-" + day + "-byhand.json");
      console.log("NOTE        an unfinished run of today is in the way -- writing to");
      console.log("            " + path.basename(file) + " so its resume point survives.");
    }
  }

  // What an earlier attempt already answered. Skipped rather than asked again:
  // the stations have been asked once, and asking twice is what a resume is
  // meant to avoid.
  const thisWeek = weekOf(all, raw.generatedAt);

  // What the earlier days left behind. Read whatever week it says: the file is
  // the working set of the last few days, not of one week.
  let carried = null;
  if (daily) {
    try {
      const old = JSON.parse(fs.readFileSync(file, "utf8"));
      if (old && Array.isArray(old.entries)) carried = old;
    } catch (e) {
      // No file yet, or an unreadable one: this run makes it.
    }
  }

  /* Judged again on the way in, without asking anybody.
   *
   * `probe.live` is a verdict about an ADDRESS, and the addresses in the file
   * have not changed since it was written. Until 08.09.2026 the flag came from
   * the adapter's own `sourceType`, which no station adapter sets to "live" --
   * so rows written before that carry `live: false` on the Deutschlandfunk
   * Kultur livestream, count as settled, and are never asked again. A fix that
   * reaches only future rows is half a fix; this is the other half, and it
   * costs no request.
   */
  if (carried) {
    const stale = carried.entries.filter(
      (e) => e.adapterVersion && e.adapterVersion !== ADAPTERS_VERSION
    ).length;
    if (stale) {
      console.log("Adapters    " + ADAPTERS_VERSION + " -- " + stale +
        " row(s) were answered by another set and are asked again");
    }
    let rejudged = 0;
    for (const row of carried.entries) {
      const probe = row.probe;
      if (!probe || !probe.url) continue;
      const live = isLiveAddress(probe.url);
      if (live !== !!probe.live) {
        probe.live = live;
        rejudged += 1;
      }
    }
    if (rejudged) {
      console.log("Re-judged   " + rejudged + " row(s): the address is a station" +
        " livestream, whatever the run that wrote it thought");
    }
  }

  let alreadyDone = new Set(
    resume ? resume.payload.entries.map((e) => e.id).filter(Boolean) : []
  );
  let notYet = 0;
  let retries = 0;

  if (daily) {
    const now = Date.now();
    // Answered, or out of time. Both are reasons not to ask; neither is a
    // reason to throw the row away, so they stay in the file and in the counts.
    alreadyDone = new Set(
      carried
        ? carried.entries.filter((e) => isDone(e, ADAPTERS_VERSION))
            .map((e) => e.id).filter(Boolean)
        : []
    );

    // From this week's collection: what is over. A concert still on air has no
    // archive page yet, and the refusal it produces would go into the record as
    // if the station had none.
    const over = concerts.filter((c) => {
      const end = endsAt(c);
      return end !== null && end <= now;
    });
    notYet = concerts.length - over.length;
    const fresh = over.filter((c) => !(c.id && alreadyDone.has(c.id)));

    // From the earlier days: everything still unanswered inside the seven-day
    // window, last week's included -- which is the point of the window. A row
    // past the window is left alone here and closed after the run.
    const inHand = new Set(fresh.map((c) => c.id).filter(Boolean));
    const again = [];
    for (const row of carried ? carried.entries : []) {
      if (!row.id || inHand.has(row.id) || alreadyDone.has(row.id)) continue;
      const end = endsAt(row);
      if (end === null || end > now) continue;
      if (now - end > RETRY_DAYS * 86400000) continue;
      again.push(concertFromRow(row));
    }
    retries = again.length;

    // Oldest business first: an entry on its last day of the window is asked
    // before a concert that ended an hour ago and can be asked again tomorrow.
    concerts = again.concat(fresh);
  }

  console.log("Source      " + source);
  console.log("Collected   " + (raw.generatedAt || "-"));
  console.log("Entries     " + concerts.length + " of " + all.length +
    (onlyStation ? "  (" + onlyStation + ")" : ""));
  console.log("Probe       " + (doProbe ? "on -- one byte per answer" : "off"));
  if (daily) {
    console.log("Daily       " + retries + " retried from earlier days, " +
      notYet + " not over yet, " + alreadyDone.size + " already done");
    console.log("Window      " + RETRY_DAYS + " days from the end of a broadcast, " +
      "then given up on");
  }
  console.log("Writing     " + file);
  if (resume) {
    console.log("Resuming    " + alreadyDone.size + " entries already answered on " +
      String(resume.payload.resolvedAt || "?").slice(0, 16).replace("T", " ") +
      " -- asking for the rest");
  }
  console.log("");

  // A resumed run continues the file it found -- entries, totals and reach
  // included. Re-deriving those from the loaded rows would be a second place
  // where the counting rules live, and the two would drift.
  const payload = resume ? resume.payload : carried ? carried : {
    source: source,
    generatedAt: raw.generatedAt || null,
    week: thisWeek,
    resolvedAt: startedAt.toISOString(),
    probed: doProbe,
    finished: false,
    totals: { ok: 0, suggested: 0, empty: 0, refused: 0, unsupported: 0, unclaimed: 0 },
    // Kept apart from the totals above on purpose: "the adapter answered" and
    // "the audio was reachable" are two different claims, and adding them into
    // one number is how a record starts flattering itself. `live` counts the
    // reachable ones that are livestreams -- always up, and therefore no
    // evidence at all about an archive.
    reach: { reachable: 0, gone: 0, blocked: 0, error: 0, live: 0 },
    entries: [],
  };
  if (carried) {
    // The rows that are about to be asked again are taken out first. Pushing a
    // second answer for the same id would leave both in the file, and the app
    // would show whichever it read last.
    const asking = new Set(
      concerts.map((c) => c.id).filter((id) => id && !alreadyDone.has(id))
    );
    payload.entries = payload.entries.filter((e) => !asking.has(e.id));
    payload.finished = false;
    payload.probed = doProbe;
    payload.source = source;
    payload.generatedAt = raw.generatedAt || payload.generatedAt || null;
    // The week of the collection this run read. Each row carries its own, so
    // this one is a label on the run and not a claim about every entry.
    payload.week = thisWeek;
    // `resolvedAt` stays at the day the file was started -- the retention
    // measurement counts from the row's own checks, and this is the file's
    // birthday. Today is a separate fact.
    payload.updatedAt = startedAt.toISOString();
  }
  if (resume) {
    payload.finished = false;
    // The run's own clock stays at the first attempt: `resolvedAt` says when
    // the stations were asked about this week, and that is what the retention
    // measurement counts from. When it was picked up again is a separate fact.
    payload.resumedAt = startedAt.toISOString();
  }

  const lastSeen = new Map();

  // The pause belongs to the host, not to the run: the twenty-seven
  // broadcasters take turns in the schedule, and a media host is often a
  // different one from the page host, so it gets its own count.
  async function pace(host) {
    const since = Date.now() - (lastSeen.get(host) || 0);
    if (since < delayMs) await sleep(delayMs - since);
    lastSeen.set(host, Date.now());
  }

  for (const [index, concert] of concerts.entries()) {
    // Answered by an earlier attempt at this same file. Not printed: a resumed
    // run that repeated three hundred lines before doing anything would bury
    // the part that is new.
    if (concert.id && alreadyDone.has(concert.id)) continue;

    const url = sharedUrl(concert);
    const host = hostOf(concert.broadcastUrl || "");

    let adapter = null;
    let label = null;
    try {
      // null as the clock: this run measures archives, so a concert that
      // happens to be playing while it runs must not answer with the
      // livestream. See detectAdapter.
      adapter = url ? detectAdapter(url, null) : null;
      // A live answer comes from a wrapper around the station module
      // (see detectAdapter), so the name is looked up on the module and
      // marked -- "dr-p8-jazz (live)" says something "dr-p8-jazz" would not.
      if (adapter) {
        label = names.get(adapter) ||
          (adapter.station ? (names.get(adapter.station) || "unknown module") + " (live)" : "unknown module");
      }
    } catch (e) {
      label = "dispatch failed: " + firstLine(e.message);
    }

    const row = {
      id: concert.id,
      stationId: concert.stationId || null,
      station: concert.station || null,
      title: concert.title || null,
      // Carried so that a row can be asked about again on a later day, and
      // described in the archive, without the collection it came from -- which
      // by then is last week's file. See concertFromRow.
      subtitle: concert.subtitle || null,
      genre: concert.genre || null,
      time: concert.time || null,
      week: weekOfDay(concert.dateKey) || thisWeek,
      startTime: concert.startTime || null,
      // The broadcast day in the station's own local time, as the collector
      // saw it. The retention rules count from it, and it is the only field
      // that survives an ARD Nachtkonzert at half past one in the morning.
      dateKey: concert.dateKey || null,
      // Who answered, and in what state the adapters were. `adapter` alone
      // cannot say: the same name answered the Nachtkonzert wrongly on 06.09.
      // and correctly on 08.09. See dispatch.adaptersVersion.
      adapterVersion: ADAPTERS_VERSION,
      durationMin: concert.durationMin || null,
      broadcastUrl: concert.broadcastUrl || null,
      sharedUrl: url || null,
      adapter: label,
      status: "unclaimed",
      answer: null,
      probe: null,
      // Filled in after the probe, once there is a first check to judge by.
      // The archive UI counts down to `expiresOn` and shows nothing at all
      // where the state is "unknown" -- the rule lives here, in the data, so
      // that a rule found in December does not need an app release.
      retention: null,
      checks: [],
      // Every time an adapter was asked, and what it said. The first entry is
      // written below; --reresolve appends. Without the history a later "ok"
      // would erase the fact that it was refused on the day of the run, and
      // that difference is the measurement.
      attempts: [],
      error: null,
      seconds: 0,
    };

    const head = String(index + 1).padStart(4) + ". " +
      String(concert.stationId || "?").padEnd(16) +
      String(concert.dateKey || "") + " " + String(concert.time || "") + "  " +
      String(concert.title || "").slice(0, 44);

    if (!adapter) {
      payload.totals.unclaimed += 1;
      row.error = url ? "no adapter claims this address" : "the entry carries no address";
      console.log(head + "\n      UNCLAIMED " + (row.error || ""));
    } else {
      await pace(host);

      const started = Date.now();
      try {
        const result = await extractWithTimeout(adapter, url);
        row.seconds = Math.round((Date.now() - started) / 100) / 10;
        const tracks = (result && result.tracks) || [];
        row.answer = answerOf(result);
        if (tracks.length) {
          // Counted apart from `ok`, because it is a different sentence. `ok`
          // means the adapter found the broadcast; this means it did not, and
          // offered the nearest thing it had. Both have audio behind them and
          // only one is an answer.
          row.status = row.answer.suggestion ? "suggested" : "ok";
          payload.totals[row.status] += 1;
          console.log(head + "\n      " + (row.answer.suggestion ? "SUGGESTED " : "OK        ") +
            label + " -- " + tracks.length +
            " piece(s), \"" + String(result.title || "").slice(0, 48) + "\", " +
            row.seconds + "s");

          if (doProbe) {
            await pace(hostOf((tracks[0] && tracks[0].streamUrl) || ""));
            row.probe = await probeTrack(tracks[0], row.answer.sourceType);
            // The first probe is check number one, in the same shape every
            // later --reprobe appends. One history, not a special case plus a
            // history.
            row.checks.push({
              at: new Date().toISOString(),
              ageDays: ageInDays(row.startTime),
              verdict: row.probe.verdict,
              status: (row.probe.segment || row.probe.head || {}).status || null,
              error: row.probe.error || null,
            });
            row.retention = retentionState(
              row,
              retentionFor(row.stationId, row.broadcastUrl)
            );
            payload.reach[row.probe.verdict] += 1;
            if (row.probe.verdict === "reachable" && row.probe.live) {
              payload.reach.live += 1;
            }
            const p = row.probe;
            const numbers = p.segment || p.head || {};
            const r = row.retention;
            console.log("      " + PROBE_LABEL[p.verdict] +
              (numbers.method || "-") + " " + (numbers.status || p.error || "-") +
              (numbers.contentType ? " " + numbers.contentType : "") +
              (p.segment ? "  (first HLS segment)" : "") +
              (p.live ? "  [live, proves nothing about an archive]" : "") +
              (r && r.expiresOn
                ? "  until " + r.expiresOn + (r.state === "stated" ? " (stated)" : "")
                : "") +
              (r && r.geoRestricted ? "  [geo-restricted]" : "") +
              (r && r.state === "contradicted" ? "  [rule contradicted]" : ""));
          }
        } else {
          row.status = "empty";
          payload.totals.empty += 1;
          console.log(head + "\n      EMPTY     " + label + " -- nothing in the answer");
        }
      } catch (e) {
        row.seconds = Math.round((Date.now() - started) / 100) / 10;
        // Since 31.08.2026 the two are told apart at the source rather than
        // by whoever reads this file: an adapter saying "this page carries no
        // recording" has worked correctly, and counting that as a failure
        // made every summary look worse than the truth. Nineteen of RNE's
        // twenty-one refusals in one week were of exactly that kind.
        row.status = isUnsupported(e) ? "unsupported" : "refused";
        row.error = firstLine(e.message).slice(0, 300);
        /* What the station said, beside the fact that it said no.
         *
         * Until 16.09.2026 a refusal kept its message and nothing else, so a
         * declared geo-block arrived as a sentence and left the archive with
         * no way to act on it. `answerOf` has carried these three for a
         * successful answer since 31.08; this is the same three on the other
         * branch. See `unsupported()` in adapters/_shared.js for the names.
         */
        if (e.geoRestricted) row.geoRestricted = true;
        if (e.blockReason) row.blockReason = String(e.blockReason).slice(0, 40);
        if (e.expiresAt) row.expiresAt = isoDate(e.expiresAt);
        // "Not yet" rather than "never" -- the row stays askable. See isSettled
        // in lib/rows.js. Cleared when it is NOT set, so a row whose adapter
        // stops saying it does not keep the flag for ever.
        if (e.retryable) row.retryable = true;
        else delete row.retryable;
        // Our own word for the refusal -- see `declined` in adapters/_shared.js.
        // Cleared when absent for the same reason as `retryable`: a row whose
        // adapter stops saying it must not keep the old word for ever.
        if (e.declined) row.declined = String(e.declined).slice(0, 20);
        else delete row.declined;
        payload.totals[row.status] += 1;
        // The address on its own line, not folded into the truncated message:
        // a refusal one can check by hand in ten seconds is worth two lines.
        console.log(head + "\n      " +
          (row.status === "unsupported" ? "DECLINED   " : "FAILED     ") +
          label + " -- " + row.error.slice(0, 118));
        if (row.broadcastUrl) console.log("                " + row.broadcastUrl);
      }
    }

    row.attempts.push({
      at: new Date().toISOString(),
      ageDays: ageInDays(row.startTime),
      status: row.status,
      adapter: row.adapter,
      error: row.error,
    });

    payload.entries.push(row);
    // A daily file has rows from earlier days in it, and some of those were
    // just taken back out. Counting as we go would count what is no longer
    // there, so the totals are derived from the entries instead.
    if (daily) recount(payload);
    writeResult(file, payload);
  }

  let closed = 0;
  let dropped = 0;
  if (daily) {
    const now = Date.now();
    const closedAt = new Date().toISOString();
    const keep = [];
    for (const row of payload.entries) {
      const end = endsAt(row);
      const age = end === null ? null : (now - end) / 86400000;
      if (age !== null && age > RETRY_DAYS && !isDone(row, ADAPTERS_VERSION)) {
        // Seven days of asking and no audio. Written down rather than deleted:
        // "asked seven times, never there" is a measurement of the station, and
        // it is the only thing that tells a slow publisher from a silent one.
        row.gaveUp = true;
        row.gaveUpAt = closedAt;
        closed += 1;
      }
      if (age !== null && age > KEEP_DAYS) {
        dropped += 1;
        continue;
      }
      keep.push(row);
    }
    payload.entries = keep;
    if (closed || dropped) {
      console.log("");
      console.log("Closed      " + closed + " given up on after " + RETRY_DAYS +
        " days, " + dropped + " older than " + KEEP_DAYS + " days dropped from" +
        " the working set");
    }
  }

  /* What this run did, in the file rather than only in the journal.
   *
   * Everything else about a run can be recomputed from the entries -- totals,
   * reach, how many were given up on. These five cannot: they are about what
   * was ASKED, and the entries only record what was answered. "317 not over
   * yet" and "27 already done" are the difference between a quiet night and a
   * night that failed, and until now they existed only in a journal on one Pi.
   *
   * Written for every mode. A weekly pass has no retries and no window, and
   * zeroes there are true rather than missing.
   */
  payload.run = {
    mode: daily ? "nightly" : "weekly",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    /* What this run ASKED, and the subtraction that used to be here was a
     * bug -- it showed "-314" on the monitor of 15.09.2026.
     *
     * `concerts` changes meaning half way down this function. It starts as the
     * week that was collected; then `concerts = again.concat(fresh)` narrows it
     * to exactly what a nightly run will ask about, the already-answered rows
     * having been dropped in building `fresh`. Subtracting `alreadyDone` here
     * subtracts them a SECOND time, and with a working file of five hundred
     * entries mostly answered, the result goes below zero.
     *
     * The subtraction is right for the weekly pass, where none of that
     * narrowing happens and `concerts` is still the whole list with the
     * resumed entries inside it. So the two modes need the two answers.
     */
    walked: daily ? concerts.length : concerts.length - alreadyDone.size,
    notYet: notYet,
    retried: retries,
    alreadyDone: alreadyDone.size,
    closed: closed,
    dropped: dropped,
    adapters: ADAPTERS_VERSION,
    retryDays: RETRY_DAYS,
    keepDays: KEEP_DAYS,
  };

  payload.finished = true;
  payload.resolvedUntil = new Date().toISOString();
  if (daily) recount(payload);
  writeResult(file, payload);

  const t = payload.totals;
  console.log("");
  // `suggested` stands beside `ok` and is never folded into it. A run that
  // reports 249 finds where twelve of them are offers is a run flattering
  // itself, and that is the one thing this record must not do.
  console.log("ok " + t.ok + " | suggested " + t.suggested + " | empty " + t.empty +
    " | failed " + t.refused + " | declined " + t.unsupported +
    " | unclaimed " + t.unclaimed);
  if (doProbe) {
    const r = payload.reach;
    console.log("audio reachable " + r.reachable + " | gone " + r.gone +
      " | blocked " + r.blocked + " | no answer " + r.error +
      (r.live
        ? "   (" + r.live + " of the reachable are livestreams, which say" +
          " nothing about an archive)"
        : ""));
  }
  console.log("Written     " + file);
}

/* --- reprobe -------------------------------------------------------------
 *
 * The same file, weeks later, without the broadcasters' pages: only the media
 * addresses are knocked on again. Each pass appends to the entry's `checks`,
 * so the record accumulates instead of being replaced -- three passes at day
 * 7, 21 and 40 say more together than any one of them alone.
 *
 * Entries that had no address, or never resolved, are skipped rather than
 * counted as gone: they were never there to lose.
 */
async function reprobeMain() {
  const payload = JSON.parse(fs.readFileSync(reprobeFile, "utf8"));
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const at = Date.now();

  const todo = entries.filter(function (e) {
    const first = e.answer && e.answer.tracks && e.answer.tracks[0];
    return first && first.streamUrl;
  });

  console.log("File        " + reprobeFile);
  console.log("Collected   " + (payload.generatedAt || "-"));
  console.log("Resolved    " + (payload.resolvedAt || "-"));
  console.log("Addresses   " + todo.length + " of " + entries.length);
  console.log("");

  const lastSeen = new Map();
  const perStation = new Map();

  for (const [index, entry] of todo.entries()) {
    const track = entry.answer.tracks[0];
    const age = ageInDays(entry.startTime, at);

    const host = hostOf(track.streamUrl);
    const since = Date.now() - (lastSeen.get(host) || 0);
    if (since < delayMs) await sleep(delayMs - since);
    lastSeen.set(host, Date.now());

    const probe = await probeTrack(track, entry.answer.sourceType);
    const check = {
      at: new Date().toISOString(),
      ageDays: age,
      verdict: probe.verdict,
      status: (probe.segment || probe.head || {}).status || null,
      error: probe.error || null,
    };
    if (!Array.isArray(entry.checks)) entry.checks = [];
    entry.checks.push(check);
    // Recomputed rather than patched: a single "gone" inside the documented
    // window turns the state to contradicted, and that has to be able to
    // happen on the third pass as readily as on the first.
    entry.retention = retentionState(
      entry,
      retentionFor(entry.stationId, entry.broadcastUrl)
    );

    const tally = perStation.get(entry.stationId) ||
      { reachable: 0, gone: 0, blocked: 0, error: 0, ages: [] };
    tally[probe.verdict] += 1;
    if (age !== null) tally.ages.push(age);
    perStation.set(entry.stationId, tally);

    // The expectation, where there is one, is what makes a status code mean
    // something. Marked so the eye finds the disagreements.
    const expected = entry.retention && entry.retention.days;
    let verdictNote = "";
    if (expected && age !== null) {
      const within = age <= expected;
      // Only "gone" disagrees with a rule. A block or a dropped connection
      // says nothing about whether the recording is still there.
      if (within && probe.verdict === "gone") verdictNote = "  <-- gone early";
      if (!within && probe.verdict === "reachable") verdictNote = "  <-- outlived the rule";
    } else if (!expected && probe.verdict === "reachable" && age !== null) {
      verdictNote = "  (no rule -- at least " + age + " days)";
    }

    console.log(
      String(index + 1).padStart(4) + ". " +
        String(entry.stationId || "?").padEnd(16) +
        ("day " + (age === null ? "?" : age)).padEnd(8) +
        (expected ? ("of " + expected).padEnd(7) : "".padEnd(7)) +
        String(probe.verdict).padEnd(11) +
        String(entry.title || "").slice(0, 40) +
        verdictNote
    );

    writeResult(reprobeFile, payload);
  }

  payload.checkedAt = new Date().toISOString();
  writeResult(reprobeFile, payload);

  console.log("");
  console.log("  station           reachable  gone  blocked  no answer   age (days)");
  for (const [station, t] of [...perStation].sort()) {
    const ages = t.ages.sort((a, b) => a - b);
    const span = ages.length
      ? ages[0] + (ages[0] === ages[ages.length - 1] ? "" : "-" + ages[ages.length - 1])
      : "?";
    console.log(
      "  " + String(station || "?").padEnd(18) +
        String(t.reachable).padStart(6) + String(t.gone).padStart(7) +
        String(t.blocked).padStart(8) + String(t.error).padStart(10) +
        "   " + span
    );
  }
  console.log("");
  console.log("Written     " + reprobeFile);
}

/* --- reresolve -----------------------------------------------------------
 *
 * Everything that is not `ok`, run through its adapter again, and the outcome
 * appended to the entry's `attempts` rather than written over the old one.
 *
 * The history is the whole point. "Refused on Monday, ok on Thursday" is a
 * publication delay -- the station had not put the edition on its series page
 * yet. "Refused both times" is something else: a wrong slot in the schedule,
 * an adapter with a gap, or an archive that never carried it. A file that only
 * ever shows the latest answer cannot tell those apart, and the RNE week of
 * 31.08.2026 is exactly that question, twenty-one times.
 *
 * `unclaimed` entries are retried too. An adapter added since the first run
 * would otherwise never get its chance at them.
 */
async function reresolveMain() {
  const payload = JSON.parse(fs.readFileSync(reresolveFile, "utf8"));
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const names = adapterNames();

  let todo = entries.filter((e) => e.status !== "ok" && e.sharedUrl);
  if (onlyStation) todo = todo.filter((e) => e.stationId === onlyStation);
  if (limit) todo = todo.slice(0, limit);

  console.log("File        " + reresolveFile);
  console.log("Resolved    " + (payload.resolvedAt || "-"));
  console.log("Retrying    " + todo.length + " of " + entries.length + " (everything not ok)");
  console.log("Probe       " + (doProbe ? "on" : "off"));
  console.log("");

  const lastSeen = new Map();
  const changed = [];

  for (const [index, entry] of todo.entries()) {
    const before = entry.status;
    const age = ageInDays(entry.startTime);

    let adapter = null;
    let label = entry.adapter;
    try {
      adapter = detectAdapter(entry.sharedUrl, null);
      // A live answer comes from a wrapper around the station module
      // (see detectAdapter), so the name is looked up on the module and
      // marked -- "dr-p8-jazz (live)" says something "dr-p8-jazz" would not.
      if (adapter) {
        label = names.get(adapter) ||
          (adapter.station ? (names.get(adapter.station) || "unknown module") + " (live)" : "unknown module");
      }
    } catch (e) {
      label = "dispatch failed: " + firstLine(e.message);
    }

    const head = String(index + 1).padStart(4) + ". " +
      String(entry.stationId || "?").padEnd(16) +
      ("day " + (age === null ? "?" : age)).padEnd(8) +
      String(entry.title || "").slice(0, 44);

    let status = "unclaimed";
    let error = adapter ? null : "no adapter claims this address";
    let retryable = false;
    let declined = null;

    if (adapter) {
      const host = hostOf(entry.broadcastUrl || "");
      const since = Date.now() - (lastSeen.get(host) || 0);
      if (since < delayMs) await sleep(delayMs - since);
      lastSeen.set(host, Date.now());

      try {
        const result = await extractWithTimeout(adapter, entry.sharedUrl);
        const answer = answerOf(result);
        status = answer.trackCount ? "ok" : "empty";
        if (status === "ok") {
          entry.answer = answer;
          entry.error = null;
          if (doProbe) {
            const media = hostOf((answer.tracks[0] || {}).streamUrl || "");
            const wait = Date.now() - (lastSeen.get(media) || 0);
            if (wait < delayMs) await sleep(delayMs - wait);
            lastSeen.set(media, Date.now());
            entry.probe = await probeTrack(answer.tracks[0], answer.sourceType);
            entry.checks.push({
              at: new Date().toISOString(),
              ageDays: age,
              verdict: entry.probe.verdict,
              status: (entry.probe.segment || entry.probe.head || {}).status || null,
              error: entry.probe.error || null,
            });
          }
        }
      } catch (e) {
        status = isUnsupported(e) ? "unsupported" : "refused";
        error = firstLine(e.message).slice(0, 300);
        // Same on this branch -- it asks the same adapters.
        if (e.retryable) retryable = true;
        if (e.declined) declined = String(e.declined).slice(0, 20);
      }
    }

    entry.adapter = label;
    entry.status = status;
    if (status !== "ok") entry.error = error;
    if (retryable) entry.retryable = true;
    else delete entry.retryable;
    if (declined) entry.declined = declined;
    else delete entry.declined;
    if (!Array.isArray(entry.attempts)) entry.attempts = [];
    entry.attempts.push({
      at: new Date().toISOString(),
      ageDays: age,
      status: status,
      adapter: label,
      error: error,
    });
    entry.retention = retentionState(
      entry,
      retentionFor(entry.stationId, entry.broadcastUrl)
    );

    const moved = status !== before;
    if (moved) changed.push({ entry: entry, before: before, after: status });
    console.log(head + "\n      " + before + " -> " + status +
      (moved ? "   <-- changed" : "") +
      (status === "refused" || status === "unsupported"
        ? "  " + String(error).slice(0, 70)
        : ""));

    writeResult(reresolveFile, payload);
  }

  recount(payload);
  payload.reresolvedAt = new Date().toISOString();
  writeResult(reresolveFile, payload);

  console.log("");
  console.log("Changed     " + changed.length + " of " + todo.length);
  for (const c of changed.slice(0, 25)) {
    console.log("  " + String(c.before).padEnd(10) + "-> " + String(c.after).padEnd(10) +
      String(c.entry.stationId || "?").padEnd(16) + String(c.entry.title || "").slice(0, 44));
  }
  const t = payload.totals;
  console.log("");
  // `suggested` stands beside `ok` and is never folded into it. A run that
  // reports 249 finds where twelve of them are offers is a run flattering
  // itself, and that is the one thing this record must not do.
  console.log("ok " + t.ok + " | suggested " + t.suggested + " | empty " + t.empty +
    " | failed " + t.refused + " | declined " + t.unsupported +
    " | unclaimed " + t.unclaimed);
  console.log("Written     " + reresolveFile);
}

// Statuses move under --reresolve, so the file's own tallies have to be
// rebuilt rather than incremented -- a total that disagrees with the entries
// below it is worse than no total.
function recount(payload) {
  const totals = { ok: 0, suggested: 0, empty: 0, refused: 0, unsupported: 0, unclaimed: 0 };
  const reach = { reachable: 0, gone: 0, blocked: 0, error: 0, live: 0 };
  for (const e of payload.entries || []) {
    if (totals[e.status] !== undefined) totals[e.status] += 1;
    const v = e.probe && e.probe.verdict;
    if (v && reach[v] !== undefined) {
      reach[v] += 1;
      if (v === "reachable" && e.probe.live) reach.live += 1;
    }
  }
  payload.totals = totals;
  payload.reach = reach;
}

let run = main;
if (reprobeFile) run = reprobeMain;
if (reresolveFile) run = reresolveMain;

// Loaded before any mode starts, because all three probe. The probe compares
// every address it reaches against this set, and an empty one would quietly
// answer "not a livestream" to all of them -- the same silence it was built to
// end. --reprobe in particular knocks on the very addresses in question and has
// to judge them the same way the run that wrote them did.
const ready = liveAddresses().then(function (found) {
  if (!found || !found.size) {
    console.log("NOTE        no station livestream addresses could be read --");
    console.log("            a livestream answered as a recording will not be marked.");
  }
});

ready.then(run).catch(function (e) {
  console.error(e);
  process.exit(1);
});
