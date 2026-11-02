"use strict";

// apps/lib/rows.js
//
// The pure helpers of the resolver and the archive builder: what a row means,
// when a broadcast is over, which week it belongs to, whether it can be
// played. No argv, no files, no network -- give them a row and they answer.
//
// WHY THIS FILE EXISTS. `resolve-week.js` and `build-archive.js` are scripts,
// not modules: they read `process.argv` while loading and call
// `process.exit(1)` when it is empty. A check that required one of them would
// print a usage line and end the run, so `apps/checks/_load.js` read the
// helpers out of the SOURCE instead -- by text, counting braces. It worked and
// it sprang its own trap: a function whose body calls another had to be asked
// for together with it, or it failed at the first call rather than at load.
// `isoDate` did exactly that.
//
// It also ended a duplication. `isoDate` existed TWICE -- once in each script,
// written to the same intent on the same day, differing only in the order of
// its two conditions. Two copies of a date rule is how a file ends up with two
// date rules, and this one had already caught the app: seven RTVE rows in
// "30-09-2026 23:59:00" form failed the decoding of all 247.
//
// What is NOT here, deliberately: anything that reads arguments, writes files
// or asks a station. `optionOf` is the one concession -- it takes the argv
// array as its first parameter rather than closing over a module-level `args`,
// which is what made three identical copies of it necessary.

// The parameters a time-limited address carries: CloudFront signs with
// Expires/Signature/Key-Pair-Id, Akamai with hdnts or __token__, and a few
// broadcasters roll their own. An address with none of them does not expire by
// itself -- it dies when the file behind it is taken down, which is a
// different clock and usually a much slower one.
const SIGNATURE_PARAM = /exp|token|sig|policy|key-pair|hdnts|md5|^st$|^e$/i;

/* When a broadcast is over.
 *
 * The same arithmetic the app and the on-air check use: start plus the stated
 * length, and three hours where no length is stated -- generous on purpose,
 * since asking too early costs a refusal that says nothing while asking a day
 * late costs nothing at all. `durationMin` arrives as a number from most
 * stations and as "90 min" from a few, so the number is dug out rather than
 * trusted.
 */
const ASSUMED_LENGTH_MIN = 180;

/* One spelling for every date in the record, whatever the station wrote.
 *
 * ISO passes through. RTVE's "dd-MM-yyyy HH:mm:ss" is converted. Anything else
 * is kept VERBATIM rather than dropped: a date nobody can parse is still
 * evidence that the station published one, and the next reader of this file
 * would rather see it than wonder where it went.
 */
function isoDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return new Date(parsed).toISOString();
  }
  const spanish = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (spanish) {
    const [, day, month, year, hour, minute, second] = spanish;
    const made = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +(second || 0)));
    if (!Number.isNaN(made.getTime())) return made.toISOString();
  }
  return text;
}

function signatureMarkers(url) {
  try {
    const found = [...new URL(url).searchParams.keys()].filter((k) =>
      SIGNATURE_PARAM.test(k)
    );
    return found.length ? found : [];
  } catch (e) {
    return [];
  }
}

// What of an adapter's answer is worth keeping. Shared by the first run and by
// --reresolve so the two cannot drift into writing subtly different records.
function answerOf(result) {
  const tracks = (result && result.tracks) || [];
  return {
    title: (result && result.title) || null,
    sourceType: (result && result.sourceType) || null,
    /* "This is not the thing you asked for."
     *
     * Set by an adapter that could not find the broadcast and is offering
     * something related instead -- ard-programme's `weigh.similar()` exit, the
     * one for "the same concert under another date". It marks what it returns
     * and labels the title, and until 08.09.2026 this function dropped the
     * field on the floor.
     *
     * The cost of dropping it, measured: ten Nachtkonzert entries of the run
     * of 06.09. went into the record as finds, were probed, were reachable,
     * and reached the app with a headphones mark -- for a four-minute piece
     * ABOUT the series. Every one of them had to be re-asked by hand to be
     * understood, because the file could not tell a find from an offer.
     */
    suggestion: !!(result && result.suggestion),
    artist: (result && result.artist) || null,
    publishedAt: (result && result.publishedAt) || null,
    duration: (result && result.duration) || null,
    trackCount: tracks.length,
    // The media addresses, with whatever expiry markers they carry. Kept
    // because a plain unsigned address is durable, and dropping it would throw
    // away the only thing --reprobe can measure later. The markers are what
    // stops a reader from mistaking a signed address for a lasting one.
    tracks: tracks.slice(0, 50).map(function (t) {
      return {
        title: (t && t.title) || null,
        streamUrl: (t && t.streamUrl) || null,
        signature: signatureMarkers(t && t.streamUrl),
      };
    }),
    tracklist: (result && result.tracklist) || null,
    // What the STATION says about this recording, where an adapter passes it
    // on. Since 31.08.2026, and the reason is RTVE: its API answers an
    // expirationDate and a geolocalizado flag, and dropping them here would
    // mean measuring by probe what the broadcaster had already stated.
    //
    // Named for what they mean rather than for what each station calls them,
    // so the second station to grow such a field does not need a second name.
    // Normalised as well as renamed, since 07.09.2026: RTVE answers
    // "30-09-2026 23:59:00", and one house format in a file of dates is a trap
    // for whoever reads it next. It caught the app -- seven such rows failed
    // the decoding of all 247.
    expiresAt: isoDate(result && result.expiresAt),
    geoRestricted: (result && result.geoRestricted) || false,
  };
}

function endsAt(concert) {
  const started = Date.parse(concert && concert.startTime ? concert.startTime : "");
  if (!Number.isFinite(started)) return null;
  const stated = String((concert && concert.durationMin) || "").match(/\d+/);
  const minutes = stated ? Number(stated[0]) : 0;
  return started + (minutes > 0 ? minutes : ASSUMED_LENGTH_MIN) * 60000;
}

/* An entry that does not need asking again.
 *
 * Only one answer settles anything: the probe reached the audio. "ok" from an
 * adapter is not enough -- that is the claim the probe exists to check -- and
 * a refusal, an empty answer, or a SUGGESTION are states that a later day can
 * still improve on. The suggestion is the sharpest case and it was measured:
 * the ARD Radiofestival entries of 06. and 07.09. were answered with the
 * recordings of the days before, because the real episodes did not exist yet
 * when the weekly run asked. Asked again on 08.09., every one of them answered
 * correctly. A suggestion is precisely a row that tomorrow may answer properly.
 *
 * Two of the failures cannot improve:
 *
 *   unsupported  the adapter says the station has no archive at all, and it
 *                will say the same tomorrow -- UNLESS the refusal was marked
 *                `retryable`, see below.
 *   unclaimed    no adapter claims the address. That is BBC Radio 3, BBC 6
 *                Music and Yle Radio 1 -- twenty-eight entries of the first
 *                real run -- and what would change it is somebody writing an
 *                adapter, which is a deployment and not a night. Asking again
 *                for seven nights would only put seven refusals in the log for
 *                each of them. They go into the archive as the third state,
 *                page but no audio; see build-archive.js.
 */
function isSettled(row, version) {
  if (!row) return false;
  /* Answered by adapters that no longer exist in that form.
   *
   * Checked FIRST, before the states that would otherwise end the question.
   * `unclaimed` and `unsupported` are settled precisely because nothing but a
   * deployment changes them -- and a deployment is what this notices. Writing
   * a BBC adapter should make the BBC rows worth asking again; before this
   * they were the ones most certain never to be asked.
   */
  if (version && row.adapterVersion && row.adapterVersion !== version) return false;
  /* "Not yet" is not "never", and until 16.09.2026 this line could not tell
   * them apart. `unsupported` was written for "this station has no archive";
   * since 31.08.2026 it also carries every day-lookup that came up empty --
   * "RNE has no edition broadcast on 2026-09-16", thrown at 09:46 about a
   * broadcast that began at 02:00 and might be published that evening. All six
   * such rows had exactly one attempt and were never asked again.
   *
   * The adapter that throws is the only place that knows which of the two it
   * is, so that is where it is said: `retryable` on the error, `row.retryable`
   * here. The default is unchanged -- silence still means settled -- and a
   * retryable row simply falls back into the seven-day window that already
   * exists, after which gaveUp closes it.
   */
  if (row.status === "unsupported") return row.retryable !== true;
  if (row.status === "unclaimed") return true;
  // An offer is not an answer, however reachable the audio behind it is.
  if (row.status === "suggested" || (row.answer && row.answer.suggestion)) return false;
  const probe = row.probe || {};
  // Neither is a livestream. It is always up, so the probe agrees every night
  // for ever and the entry sits in the record as an archive recording nobody
  // asks about again. Ten Deutschlandfunk Kultur rows did exactly that in the
  // run of 06.09.2026.
  if (probe.live) return false;
  return probe.verdict === "reachable";
}

/* An entry that is never asked again: answered, or out of time.
 *
 * Kept apart from isSettled because the two say different things. Settled is
 * an answer; given up is the absence of one after seven days, and a reader of
 * the file should be able to tell those apart -- the first is evidence about
 * the station, the second is evidence about the rule.
 */
function isDone(row, version) {
  return isSettled(row, version) || (row && row.gaveUp === true);
}

/* The week a collection covers: the Monday of the day it was collected.
 *
 * It was the EARLIEST dateKey in the entries until 07.09.2026, and that read
 * radioeins' past instead of the week. That station looks BACKWARDS -- its
 * programme pages say nothing about an evening until the evening has happened,
 * so it reports out of an archive with the real broadcast dates on it. Seven
 * episodes from August were enough to make a run over the week of 07.09. call
 * itself the week of 24.08. The same effect dragged the app's day strip back a
 * fortnight the same morning.
 *
 * The collection runs Monday 02:00, so the Monday of `generatedAt` is the week
 * it covers, whatever any single station reports. The earliest dateKey remains
 * the fallback for a file that carries no `generatedAt` -- wrong in the same
 * way as before, but only where there is nothing better.
 */
function weekOf(concerts, generatedAt) {
  const collected = generatedAt ? new Date(generatedAt) : null;
  if (collected && !Number.isNaN(collected.getTime())) {
    const monday = new Date(collected);
    // getUTCDay: Sunday is 0, so Sunday counts as six days after its Monday.
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  const days = concerts.map((c) => String(c.dateKey || "")).filter(Boolean).sort();
  return days.length ? days[0] : new Date().toISOString().slice(0, 10);
}

/* The Monday of a broadcast day.
 *
 * The weekly run stamps its whole file with one week and that is true of it.
 * A daily run walks two weeks at every turn of the week -- Sunday's concert is
 * still being asked about on Thursday -- so the week belongs on the row, where
 * it stays right whatever the file is called.
 */
function weekOfDay(dateKey) {
  const at = Date.parse(String(dateKey || "") + "T12:00:00Z");
  if (!Number.isFinite(at)) return null;
  const monday = new Date(at);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

// Whole days between a broadcast and now. The retention rules are worded from
// the day of broadcast, and a collection can be days late, so counting from
// the run would answer a different question.
function ageInDays(startTime, at) {
  const then = Date.parse(startTime || "");
  if (!Number.isFinite(then)) return null;
  return Math.floor(((at || Date.now()) - then) / 86400000);
}

// Reachable, and not a livestream. `probe.live` is set where the address the
// adapter handed back is the station's own stream: always up, and therefore no
// evidence at all about an archive. Same distinction the run summary draws.
function isPlayable(row) {
  const probe = row.probe || {};
  // A suggestion is reachable audio and the wrong broadcast. Since 08.09.2026
  // the resolver marks it -- see `answerOf` there -- and an archive that let
  // one in would put a headphones mark on a row that plays something else.
  if (row.status === "suggested" || (row.answer && row.answer.suggestion)) return false;
  return probe.verdict === "reachable" && !probe.live;
}

/* The fourth state (Roger, 13.09.2026): the recording is THERE and we are
 * refused it.
 *
 * Not `playable` -- nothing plays. Not `pageOnly` -- an adapter found the
 * edition, so there is an address and not just a page. Not `expired` -- the
 * file sits on the server intact. Until today a row like this fell through
 * build-archive.js's admission test and never reached the app at all, which
 * meant the one state we could say most precisely about was the one nobody
 * could see.
 *
 * Fila cero (RNE Radio Clasica) is the measured case, 13.09.2026. Every
 * edition answers 403 at ztnr.rtve.es, from HEAD and from the one-byte GET
 * alike, while `noches-en-los-jardines` and `solo-jazz` come through from the
 * same machine in the same minute. Through a Spanish VPN the same signed
 * address answers 302 with a download token. It is a geo-block -- but note
 * what this function does NOT claim: the probe proves REFUSAL, and only a
 * request from another country proved the reason. So the state is "blocked",
 * not "geo-blocked", and the wording in the app follows the evidence.
 */
function isBlocked(row) {
  const probe = row.probe || {};
  if (row.status === "suggested" || (row.answer && row.answer.suggestion)) return false;
  /* Two ways to be refused, and the second was unreachable until 16.09.2026.
   *
   * MEASURED: we asked for the file and got 401, 403 or 451. That is RTVE's
   * Fila cero -- an address exists, we fetch it, the edge says no.
   *
   * DECLARED: the station said so before there was anything to fetch. SRF's
   * Integration Layer answers `blockReason: "GEOBLOCK"` and names no file at
   * all, so there is no address, no probe, and no verdict -- and this function
   * would have said "not blocked" about a recording the broadcaster had just
   * declared out of reach. Twelve SRF 2 broadcasts sat in the working file
   * that way, counted as ordinary refusals.
   *
   * The declared kind is the stronger statement of the two: it comes from the
   * house that owns the rights, not from one probe at one moment.
   */
  if (row.geoRestricted === true) return true;
  if (row.answer && row.answer.geoRestricted === true) return true;
  return probe.verdict === "blocked" && !probe.live;
}

/* The third state (Roger, 07.09.2026): page, but no audio.
 *
 * Twenty-eight entries of the first real run are addresses no adapter claims
 * -- BBC Radio 3 twenty-four, BBC 6 Music two, Yle Radio 1 two -- and every one
 * of them has a readable page at the station. Two ways of handling that were
 * both wrong. Leaving them out makes the archive lie by omission: the week had
 * those concerts in it. Letting them in as ordinary entries makes it promise a
 * button that cannot work.
 *
 * So they come in, marked. The app shows the link and no StreamAux button, and
 * the archive is complete without claiming anything it cannot do.
 *
 * `unclaimed` and not "anything that failed" on purpose. A refusal or an empty
 * answer means an adapter TRIED and something is wrong at our end; those
 * belong in the resolver's own file and in OPEN-TASKS, not in a shelf a person
 * browses. Unclaimed is the honest case: nobody ever promised this one.
 */
function isPageOnly(row) {
  return row.status === "unclaimed" && !!row.broadcastUrl;
}

/* One command-line option, without closing over the caller's `args`.
 *
 * The same six lines stood in resolve-week.js, build-archive.js and
 * audit-resolved.js, identical in all three and each reading a module-level
 * `args`. That is why they could not be shared: the function was pure except
 * for the one thing it took from its file.
 */
function optionOf(args, name, fallback) {
  const at = args.indexOf("--" + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

module.exports = {
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
  isPlayable,
  isPageOnly,
  isBlocked,
  optionOf,
};
