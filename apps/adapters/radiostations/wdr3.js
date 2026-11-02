"use strict";

// adapters/radiostations/wdr3.js -- the ARD HLS pattern (see _ard-hls-station.js).
// Found by Chrome recon on 2026-07-23 at https://www1.wdr.de/radio/wdr3/index.html.

const { createArdHlsStation } = require("../_ard-hls-station");

module.exports = createArdHlsStation({
  id: "wdr3",
  title: "WDR 3 (Livestream)",
  matchRe: /^https?:\/\/(www\d?\.)?wdr\.de\/radio\/wdr3/i,
  // The programme preview the guide collects from, which carries the station
  // in the path and is therefore unambiguous.
  broadcastRe: /^https?:\/\/(www\d?\.)?wdr\.de\/programmvorschau\/wdr3\//i,
  // The first station with an explicit live page (09.08.2026). Until then
  // matchRe caught every programme page under /radio/wdr3/ as well -- and
  // answered with the livestream. The remaining 25 stations follow, one at
  // a time and each one checked.
  liveRe: /^https?:\/\/(www\d?\.)?wdr\.de\/radio\/wdr3\/?(index\.html)?(\?|#|$)/i,
  broadcaster: "wdr",
  stationSlug: "wdr3",
});
