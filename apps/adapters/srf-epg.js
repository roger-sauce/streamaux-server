"use strict";

// adapters/srf-epg.js
//
// The archive route for an SRF broadcast the collection could only name.
//
// WHY THIS EXISTS. srf2/transform.ts writes `ep.seoUrl || STATION_PAGE`, and
// SRF fills its episode objects only gradually -- roughly 4 of 42 shows six
// days ahead against 27 the day after (measured 10.09.2026). The guide collects
// on Monday for the week ahead, so for most broadcasts there is no episode and
// therefore no address, and the row goes out carrying
//
//   https://www.srf.ch/audio/srf-2-kultur
//
// the STATION page. No adapter claimed that -- srf-archive.js requires two path
// parts after /audio/, deliberately, because one part is the livestream page.
// Three broadcasts of fifteen in the week of 14.09.2026 sat there as
// `unclaimed`: Jazz in Concert, Jazz Collection, Klassik punkt CH.
//
// That is not a fault of the collector. It cannot write an address that does
// not exist yet. And it does not need to: kg-url.js appends the start time and
// the station to every row, so the slot is in the address even when the
// broadcast is not.
//
//   https://www.srf.ch/audio/srf-2-kultur#kg=<start>&kgt=<title>&kgs=srf2
//
// WHAT THIS DOES, and it is the whole of it: ask the EPG for that day, find the
// show that begins at that minute, and hand its `seoUrl` to srf-archive.js,
// which has been able to play it all along -- markup first, Integration Layer
// second, GEOBLOCK reported with its expiry date.
//
// Measured 16.09.2026 on 15.09. and 09.09.: the EPG answers 200 to a plain
// fetch from Node (the browser needs the /api/srf2 proxy for CORS, nothing
// else), and after a broadcast every episode carried BOTH audio_uuid and an
// absolute seoUrl. The uuid is therefore not read here: a second route built
// for a case that has never been seen would be a guess with a test around it.
// If an episode ever turns up with a uuid and no seoUrl, the refusal below
// names it and OPEN-TASKS.md says what to do.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, unsupported } = require("./_shared");
const srfArchive = require("./srf-archive");

/* The station pages this stands in for, and the EPG channel behind each.
 *
 * A table and not a rule. The station page says "srf-2-kultur" and the EPG
 * wants "radio-srf-2-kultur", and there is nothing in the first that turns into
 * the second except by knowing. Keyed by both spellings the address can carry:
 * the path slug, and the guide's own station id out of `kgs=`.
 *
 * The livestream page -- "radio-srf-2-kultur-live-hoeren", also one path part --
 * is absent on purpose, so it can never be claimed here.
 */
const CHANNELS = new Map([
  ["srf-2-kultur", "radio-srf-2-kultur"],
  ["srf2", "radio-srf-2-kultur"],
]);

// One path part after /audio/ is a station page, two are a broadcast (which
// srf-archive.js takes). The lookahead keeps the livestream page out --
// "radio-srf-2-kultur-live-hoeren" also has one part, and the same guard
// stands in srf-archive.js for the same reason. It is NOT enough to rely on
// the channel table below: `kgs=srf2` in the fragment would otherwise name a
// channel for the live page too, and this adapter would answer a request for
// the running programme with last night's concert. Found by the test.
const PAGE_RE =
  /^https?:\/\/(?:www\.)?srf\.ch\/audio\/(?![^/?#]*-live-hoeren(?:\/|$))([^/?#]+)\/?$/i;
const START_RE = /[#&]kg=([^&]+)/i;
const STATION_RE = /[#&]kgs=([^&]+)/i;
const EPG_BASE = "https://www.srf.ch/epg/schedule/";

// SRF prints its schedule in Swiss wall time, so that is the clock the slot is
// read with. Not UTC: a broadcast beginning at 00:30 in Zurich is on the EPG
// page of that day, and reading the instant in UTC would look for it on the
// evening before for half the year.
const TIME_ZONE = "Europe/Zurich";

// Schedules and shares disagree by a minute now and then. Six, as everywhere
// else in this folder -- the next broadcast is never that close.
const SLACK_MINUTES = 6;

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function fragment(url, re) {
  const hit = re.exec(String(url || ""));
  return hit ? decodeURIComponent(hit[1]) : null;
}

// Which EPG channel this address stands for. The station id from `kgs=` is
// asked first: it is what the guide itself says, while the path is what SRF
// happened to spell.
function channelOf(url) {
  // The address has to be a station page BEFORE the fragment is believed. The
  // fragment is written by the app and travels with a share; the path is what
  // the address actually is.
  const hit = PAGE_RE.exec(withoutFragment(url));
  if (!hit) return null;
  const byStation = fragment(url, STATION_RE);
  if (byStation && CHANNELS.has(byStation.toLowerCase())) {
    return CHANNELS.get(byStation.toLowerCase());
  }
  return CHANNELS.get(hit[1].toLowerCase()) || null;
}

function match(url) {
  return PAGE_RE.test(withoutFragment(url)) && channelOf(url) !== null;
}

function slotOf(url) {
  const raw = fragment(url, START_RE);
  if (!raw) return null;
  const when = new Date(raw);
  return Number.isFinite(when.getTime()) ? when : null;
}

// The Zurich wall clock of an instant: the calendar day SRF files it under, and
// the minute of that day. en-CA for the ISO order, the same trick the
// collector's transform.ts and br-klassik.js both use.
function zurichStamp(when) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(when);
  const value = function (type) {
    return (parts.find(function (p) { return p.type === type; }) || {}).value;
  };
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;
  return {
    day: value("year") + "-" + value("month") + "-" + value("day"),
    minutes: hour * 60 + Number(value("minute")),
  };
}

/* Every show of an EPG day, flattened out of its sections -- minus the leading
 * carry-over.
 *
 * FOUND IN THE DATA, 16.09.2026, and it would have been a wrong recording
 * rather than a missing one. The day of 15.09. lists forty-two shows in
 * ascending order from 00:00 to 22:06 -- and puts ANOTHER 22:06 in front of
 * them all:
 *
 *      0  22:06-00:00  Notturno
 *      1  00:00-00:06  Nachrichten
 *    ...
 *     41  22:06-00:00  Notturno
 *
 * The section itself declares 00:00:00 to 23:59:59, so the first entry is the
 * one that does not belong to the run. Whether SRF means the previous evening's
 * broadcast or simply prints the slot twice cannot be told from the file --
 * both entries carry `episode: null` and are identical in content. What CAN be
 * told is that the entry the day's own ascending run reaches is the last one,
 * so the leading one is dropped and a tie below keeps the later.
 *
 * Only a LEADING one, and only while it breaks the order. A rule that deleted
 * every duplicate start time would quietly throw away a genuine simulcast.
 */
function showsOf(day) {
  const out = [];
  for (const section of (day && day.sections) || []) {
    for (const show of section.shows || []) out.push(show);
  }
  while (out.length > 1 && String(out[0].start || "") > String(out[1].start || "")) {
    out.shift();
  }
  return out;
}

/* The show that begins at the minute asked for.
 *
 * Exact first, and the slack only where nothing is exact -- a schedule that has
 * two shows six minutes apart would otherwise be decided by array order. The
 * guide's own start time came out of this same EPG, so the exact case is the
 * normal one and the slack is there for the day SRF moves something by a
 * minute.
 */
function showAt(shows, when) {
  const want = zurichStamp(when).minutes;
  let best = null;
  for (const show of shows) {
    const clock = /^(\d{1,2}):(\d{2})/.exec(String(show.start || ""));
    if (!clock) continue;
    const off = Math.abs(Number(clock[1]) * 60 + Number(clock[2]) - want);
    if (off > SLACK_MINUTES) continue;
    // "<=" and not "<": where two entries sit on the same minute, the later one
    // is the day's own. See the carry-over in showsOf() above -- that is
    // removed there, and this is the second lock on the same door.
    if (!best || off <= best.off) best = { off: off, show: show };
  }
  return best ? best.show : null;
}

async function fetchDay(channel, ymd) {
  const url = EPG_BASE + channel + "/" + ymd;
  const text = await fetchHtml(url, { headers: { Accept: "application/json" } });
  // The collector guards against this too: a proxy that answers with the SPA
  // shell rather than the API returns HTML, and JSON.parse would then blame the
  // station for a misconfiguration of ours.
  if (text.trimStart().startsWith("<")) {
    throw new Error("srf-epg-adapter: HTML instead of JSON from " + url);
  }
  return { day: JSON.parse(text), url: url };
}

async function extract(url) {
  if (!match(url)) throw new Error("srf-epg-adapter: URL does not match: " + url);
  const page = withoutFragment(url);
  const channel = channelOf(url);

  const when = slotOf(url);
  if (!when) {
    throw unsupported(
      "This is the station page of SRF, not one broadcast, and the address does " +
        "not say which start time is meant. Share the concert from the " +
        "Konzertfuehrer, which knows it -- or paste the address of the single " +
        "broadcast. The station: " + page,
      page
    );
  }

  const stamp = zurichStamp(when);
  const fetched = await fetchDay(channel, stamp.day);
  const show = showAt(showsOf(fetched.day), when);

  if (!show) {
    throw unsupported(
      "SRF's schedule for " + stamp.day + " lists no broadcast at that time. " +
        "The schedule: " + fetched.url,
      fetched.url
    );
  }

  const episode = show.episode || null;
  if (!episode || !episode.seoUrl) {
    throw unsupported(
      "SRF lists \"" + (show.title || "this broadcast") + "\" on " + stamp.day +
        " but names no edition for it" +
        (episode && episode.audio_uuid ? " (it does give a uuid, " + episode.audio_uuid +
          " -- see OPEN-TASKS.md)" : "") +
        ". Either the recording was never published, or it has not been " +
        "published yet. The schedule: " + fetched.url,
      fetched.url,
      // Not settled: SRF fills its episode objects gradually -- 4 of 42 six
      // days ahead against 27 the day after. See isSettled in lib/rows.js.
      { retryable: true }
    );
  }

  const found = await srfArchive.extract(episode.seoUrl);
  // The edition that was found, not the station page that was shared -- so a
  // second listen needs no schedule at all. Same reason as in
  // _series-page-resolver.js.
  return Object.assign({}, found, { sourceUrl: episode.seoUrl });
}

module.exports = {
  match, extract,
  // Read by apps/checks/srf-epg.test.js.
  channelOf, slotOf, showAt, showsOf, zurichStamp,
};
