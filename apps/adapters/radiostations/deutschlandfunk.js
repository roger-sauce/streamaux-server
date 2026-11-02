"use strict";

// adapters/radiostations/deutschlandfunk.js
//
// Deutschlandfunk (Deutschlandradio -- NOT part of the ARD, hence a
// different CDN from BR-Klassik, WDR 3, SWR Kultur and HR2). The official,
// static stream URL from their own "links for web radios and players"
// page: no HLS, no master playlist handling. Internally it redirects
// through the same "*.rndfnk.com" dispatcher as radio3 (rbb), so always
// return this stable entry URL and never cache or hardcode the resolved
// redirect target. Found by Chrome recon on 2026-07-23 at
// https://www.deutschlandfunk.de/livestream-100.html.
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

const DLF_URL_RE = /^https?:\/\/(www\.)?deutschlandfunk\.de(\/|$)/i;

// Live means the front page and the livestream page the URL above came
// from. Every other page on deutschlandfunk.de is a broadcast, an article
// or a news item -- and until today every one of them was quietly answered
// with the running programme.
const DLF_LIVE_RE =
  /^https?:\/\/(www\.)?deutschlandfunk\.de(\/(livestream-100\.html)?)?(\?|#|$)/i;

const STREAM_URL = "https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3?aggregator=web";
const TITLE = "Deutschlandfunk (Livestream)";

function match(url) {
  return DLF_URL_RE.test(url);
}

async function extract(url) {
  if (!match(url)) throw new Error("deutschlandfunk-adapter: URL does not match: " + url);
  if (!DLF_LIVE_RE.test(url)) {
    throw unsupported(
      "This is a programme page from Deutschlandfunk, not the livestream. " +
    "Broadcasts to listen back to run through the Dlf Audiothek: choose "
      + "\"Teilen\" on the broadcast there and paste the share.deutschlandradio.de link here.",
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
    sourceType: "deutschlandfunk",
    tracks: [{ title: TITLE, streamUrl: STREAM_URL }],
    tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
  };
}

module.exports = { match, extract, live };
