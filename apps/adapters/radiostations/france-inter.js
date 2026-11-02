"use strict";

// adapters/radiostations/france-inter.js -- the Radio France HLS pattern
// (see _radiofrance-hls-station.js).
//
// Radio France addresses a broadcast as
// /<station>/podcasts/<emission>/<titre>-<id>, so the bare station path is
// live and everything below it is archive. Until now the whole of
// /franceinter counted as the livestream, every podcast page included.

const { createRadioFranceStation } = require("../_radiofrance-hls-station");

module.exports = createRadioFranceStation({
  id: "france-inter",
  title: "France Inter (Livestream)",
  matchRe: /^https?:\/\/(www\.)?radiofrance\.fr\/franceinter/i,
  liveRe: /^https?:\/\/(www\.)?radiofrance\.fr\/franceinter\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (radiofrance.fr/<station>/podcasts/<emission>/<title>-<id>) plays " +
    "its own recording; paste one of those.",
  slug: "franceinter",
});
