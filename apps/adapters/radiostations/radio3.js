"use strict";

// adapters/radiostations/radio3.js
//
// radio3 (rbb) is DIFFERENT from BR-Klassik, WDR 3, SWR Kultur and HR2: no
// HLS, but a direct, continuous MP3 stream through the ARD-wide
// "dispatcher.rndfnk.com" gateway. The dispatcher redirects every request
// to a freshly signed, short-lived URL carrying a token, so always return
// the dispatcher URL itself and never cache or hardcode the resolved
// target. No /live/ proxy is needed here, unlike the HLS stations --
// ffmpeg and <audio> follow the redirect themselves. Found by Chrome recon
// on 2026-07-23 at https://www.radiodrei.de/livestream/ (the JSON config
// under .../livestream-kulturradio192.mediajsn.jsn points at the stream).
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

// The refusal below is a decline, not a failure: the adapter worked, the
// address is simply a programme page and not the livestream, and the answer
// says where to look instead. Converted on 02.09.2026 -- four sites 5.6 missed,
// found when a run over a real week counted them as faults. The page travels
// as sourceUrl so the app can offer it as a button.
const { unsupported } = require("../_shared");

const RADIO3_URL_RE = /^https?:\/\/(www\.)?(radio3\.de|radiodrei\.de)/i;

// Because the factory does not apply here (no HLS), the guard stands in
// this file by hand -- the same rule as for the ARD HLS stations: only the
// live page and the front page yield the stream, every programme page is
// refused.
const RADIO3_LIVE_RE =
  /^https?:\/\/(www\.)?(radio3\.de|radiodrei\.de)(\/(livestream\/?)?(index\.html)?)?(\?|#|$)/i;

const STREAM_URL = "https://dispatcher.rndfnk.com/rbb/rbbkultur/live/mp3/high";
const TITLE = "radio3 (rbb) - Livestream";

function match(url) {
  return RADIO3_URL_RE.test(url);
}

async function extract(url) {
  if (!match(url)) throw new Error("radio3-adapter: URL does not match: " + url);
  if (!RADIO3_LIVE_RE.test(url)) {
    throw unsupported(
      "This is a programme page from radio3, not the livestream. Broadcasts to " +
        "listen back to run through the ARD Audiothek (ardsounds.de); you can also " +
        "paste the download link of a broadcast directly.",
      url
    );
  }
  return live();
}

// The same answer as above, without the gate. detectAdapter() reaches for this
// when the shared address says the broadcast is on air right now: the address
// is then a programme page, extract() refuses it correctly, and the livestream
// is nonetheless what was asked for. See adapters/_on-air.js.
function live() {
  return {
    title: TITLE,
    sourceType: "radio3",
    tracks: [{ title: TITLE, streamUrl: STREAM_URL }],
    tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
  };
}

module.exports = { match, extract, live };
