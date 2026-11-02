"use strict";

// adapters/radiostations/dr-p2.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// DR LYD addresses a broadcast as
// /lyd/<station>/<series>/<season>/<episode>-<id>, so everything below the
// bare station path is archive, and the station path itself is live. Until
// now the whole of /lyd/p2 counted as the livestream, every broadcast page
// included.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "dr-p2",
  title: "DR P2 (Livestream)",
  matchRe: /^https?:\/\/(www\.)?dr\.dk\/lyd\/p2/i,
  liveRe: /^https?:\/\/(www\.)?dr\.dk\/lyd\/p2\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (dr.dk/lyd/<station>/<series>/<season>/<episode>) plays its own " +
    "recording; paste one of those.",
  streamUrl: "https://live-icy.dr.dk/A/A04H.mp3",
});
