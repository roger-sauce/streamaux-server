"use strict";

// adapters/radiostations/deutschlandfunk-kultur.js
//
// Deutschlandfunk Kultur (Deutschlandradio -- NOT part of the ARD). The
// same pattern as deutschlandfunk.js: an official, static stream URL, no
// HLS. A different subdomain from DLF ("st02" instead of "st01", channel
// number "02"), found with DevTools on the play button at
// https://www.deutschlandfunkkultur.de/ on 2026-07-23, because the
// official "links for web radios" page does not exist under the URL one
// would expect by analogy with dlf.de. Like deutschlandfunk.js it
// redirects internally through "*.rndfnk.com", so always return this
// stable entry URL and never cache the redirect target.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

// The refusal below is a decline, not a failure: the adapter worked, the
// address is simply a programme page and not the livestream, and the answer
// says where to look instead. Converted on 02.09.2026 -- four sites 5.6 missed,
// found when a run over a real week counted them as faults. The page travels
// as sourceUrl so the app can offer it as a button.
const { unsupported, fetchHtml } = require("../_shared");
const { airtimeOf } = require("../_on-air");
const dradio = require("../deutschlandradio");

const DLF_KULTUR_URL_RE = /^https?:\/\/(www\.)?deutschlandfunkkultur\.de/i;

/* Live means the front page and the programme page WITHOUT a date.
 *
 * The query is the discriminator, and it had to become one on 08.09.2026. The
 * collector writes a broadcastUrl of the form
 *
 *   deutschlandfunkkultur.de/programm?drsearch:date=2026-08-31#:~:text=In Concert
 *
 * for every DLF Kultur entry -- a SCHEDULE, one day of it, with a text fragment
 * pointing at the broadcast. The old pattern accepted `/programm` followed by a
 * `?`, so every one of those looked like the livestream page: ten entries of
 * the week of 31.08. answered with the running programme, were probed, were
 * reachable, and reached the app as recordings.
 *
 * With a date it is a schedule and is read (see extract); without one it is the
 * front page and the livestream is what is meant. Deutschlandfunk next door was
 * never wrong here -- its own pattern accepts only the bare domain and
 * /livestream-100.html.
 */
const DLF_KULTUR_LIVE_RE =
  /^https?:\/\/(www\.)?deutschlandfunkkultur\.de(\/(programm\/?)?)?(#|$)/i;

const STREAM_URL = "https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3?aggregator=web";
const TITLE = "Deutschlandfunk Kultur (Livestream)";

function match(url) {
  return DLF_KULTUR_URL_RE.test(url);
}

async function extract(url) {
  if (!match(url)) throw new Error("deutschlandfunk-kultur-adapter: URL does not match: " + url);
  if (DLF_KULTUR_LIVE_RE.test(url)) return live();

  /* A schedule page, and the recording is in it.
   *
   * Measured 08.09.2026: one day carries 44 broadcasts with data-audio-src and
   * data-audio-title, plus 4 livestream players, and every recording's file
   * name ends in _drk_<date>_<time>_. So the broadcast the share names can be
   * picked by its own clock rather than by wording or position -- and picking
   * by position is precisely the trap, because the first .mp3 on the page is
   * the livestream.
   *
   * The `#:~:text=` anchor the collector appends is no help: a text fragment is
   * resolved by the browser and never reaches a server.
   */
  const airtime = airtimeOf(url, null);
  if (!airtime) {
    throw unsupported(
      "This is a programme page from Deutschlandfunk Kultur and carries no broadcast " +
      "time, so which of the day's recordings is meant cannot be told. Share the " +
      "concert from the Konzertfuehrer, which sends one -- or choose \"Teilen\" on the " +
      "broadcast in the Dlf Audiothek and paste that link here.",
      url
    );
  }

  const html = await fetchHtml(url);
  const tag = dradio.pickAudioTagAt(html, new Date(airtime.startsAt));
  const found = tag ? dradio.describe(tag) : null;
  if (!found) {
    // Deliberately NOT the livestream. It would play, and it would be the wrong
    // thing playing -- which is the failure this whole adapter was rewritten to
    // stop. A broadcast can also simply not be published yet: the schedule of
    // 01.09.2026 carried no audio for its concerts while the 31.08. did.
    throw unsupported(
      "Deutschlandfunk Kultur's schedule for that day carries no recording of this " +
      "broadcast. It may not be published yet, or no longer be there -- the page " +
      "itself says which.",
      url,
      // Not settled: "may not be published yet" is a state that ends. The
      // schedule of 01.09.2026 carried no audio for its concerts while the
      // 31.08. did. See isSettled in lib/rows.js.
      { retryable: true }
    );
  }

  return {
    title: found.title,
    // The same delivery as a share page: an ondemand MP3 or an HLS VOD, and
    // deutschlandradio.js already reads both.
    sourceType: "deutschlandradio",
    artist: found.artist,
    cover: found.cover,
    duration: found.duration,
    tracks: [{ title: found.title, streamUrl: found.streamUrl, cover: found.cover }],
    tracklist: [],
    link: found.link,
  };
}

// The same answer as above, without the gate. detectAdapter() reaches for this
// when the shared address says the broadcast is on air right now: the address
// is then a programme page, extract() refuses it correctly, and the livestream
// is nonetheless what was asked for. See adapters/_on-air.js.
function live() {
  return {
    title: TITLE,
    sourceType: "deutschlandfunk-kultur",
    tracks: [{ title: TITLE, streamUrl: STREAM_URL }],
    tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
  };
}

module.exports = { match, extract, live };
