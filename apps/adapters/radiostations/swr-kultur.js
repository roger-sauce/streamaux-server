"use strict";

// adapters/radiostations/swr-kultur.js -- the ARD HLS pattern (see
// _ard-hls-station.js). Found by Chrome recon on 2026-07-23 at
// https://www.swr.de/swrkultur/index.html.
//
// The SWR separates things more cleanly than BR: live sits under
// /swrkultur/, the broadcasts to listen back to under /kultur/. That
// second path is claimed here on purpose although the adapter cannot play
// it -- only so that, instead of "no adapter fits", it can name the way to
// the Audiothek.

const { createArdHlsStation } = require("../_ard-hls-station");

module.exports = createArdHlsStation({
  id: "swr-kultur",
  title: "SWR Kultur (Livestream)",
  matchRe: /^https?:\/\/(www\.)?swr\.de\/(swrkultur|kultur)(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?swr\.de\/swrkultur\/?(index\.html)?(\?|#|$)/i,
  broadcaster: "swr",
  stationSlug: "swrkultur",
});
