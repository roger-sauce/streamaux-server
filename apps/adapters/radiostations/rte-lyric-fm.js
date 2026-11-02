"use strict";

// adapters/radiostations/rte-lyric-fm.js -- the fixed stream pattern (see
// _direct-stream-station.js).
//
// Same case as its neighbour rte-2fm.js, measured the same day: the address
// is an HLS master, but the window is three segments and the variant behind
// it carries a per-request session id, so the /live/ proxy would do harm
// rather than good. The reasoning is written out there.
//
// Recordings live under rte.ie/radio/<station>/<series>/episodes/<uuid>/ and
// belong to rte-archive.js, which covers the whole house and sits ahead of
// this adapter.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "rte-lyric-fm",
  title: "RTÉ Lyric FM (Livestream)",
  matchRe: /^https?:\/\/(www\.)?rte\.ie\/radio\/lyricfm(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?rte\.ie\/radio\/lyricfm\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (rte.ie/radio/lyricfm/<series>/episodes/<uuid>/) plays " +
    "its own recording; paste one of those.",
  streamUrl: "https://www.rte.ie/manifests/lyric.m3u8",
});
