"use strict";

// adapters/radiostations/hr2.js -- the ARD HLS pattern (see
// _ard-hls-station.js). Found by Chrome recon on 2026-07-23 at
// https://www.hr2.de/index.html.
//
// The clearest of the four: live is the front page, everything to listen
// back to lives entirely in the ARD Audiothek. Until now the whole domain
// counted as the livestream, every programme page included.

const { createArdHlsStation } = require("../_ard-hls-station");

module.exports = createArdHlsStation({
  id: "hr2",
  title: "HR2 Kultur (Livestream)",
  matchRe: /^https?:\/\/(www\.)?hr2\.de/i,
  liveRe: /^https?:\/\/(www\.)?hr2\.de\/?(index\.html)?(\?|#|$)/i,
  broadcaster: "hr",
  stationSlug: "hr2",
});
