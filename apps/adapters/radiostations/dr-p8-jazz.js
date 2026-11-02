"use strict";

// adapters/radiostations/dr-p8-jazz.js -- the fixed Icecast pattern (see
// _direct-stream-station.js). Same house as DR P2, same address scheme:
// /lyd/<station>/<series>/<season>/<episode>-<id> is a broadcast, the bare
// station path is live.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "dr-p8-jazz",
  title: "DR P8 Jazz (Livestream)",
  matchRe: /^https?:\/\/(www\.)?dr\.dk\/lyd\/p8jazz/i,
  liveRe: /^https?:\/\/(www\.)?dr\.dk\/lyd\/p8jazz\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (dr.dk/lyd/<station>/<series>/<season>/<episode>) plays its own " +
    "recording; paste one of those.",
  streamUrl: "https://live-icy.dr.dk/A/A22H.mp3",
});
