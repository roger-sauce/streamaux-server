"use strict";

// adapters/radiostations/rai-radio3-classica.js -- the generic HLS pattern
// (see _generic-hls-live-station.js).
//
// New station on 13.08.2026. It needs the /live/ proxy: the CDN keeps
// 1440 segments of about ten seconds each in its window, four hours of
// history, so playing the playlist as it stands would start somewhere in
// the middle of the night. Same case as SRF 2.
//
// The master playlist offers exactly one variant, 320 kbit/s AAC, and
// points at it with a relative path ("../../../2032595/..."), which the
// factory resolves against the master URL.
//
// NOTE: a station on this factory must also be entered in
// LIVE_MANIFEST_SOURCES in autoplay-pi/server.js. Without it
// /live/<id>.m3u8 answers "404 Unknown live stream" -- and try-adapter.js
// would not notice, because it only prints the path.
//
// Recordings live under /audio/ and /playlist/ and belong to
// raiplaysound-archive.js, which covers the whole house.

const { createGenericHlsLiveStation } = require("../_generic-hls-live-station");

module.exports = createGenericHlsLiveStation({
  id: "rai-radio3-classica",
  title: "Rai Radio 3 Classica (Livestream)",
  matchRe: /^https?:\/\/(www\.)?raiplaysound\.it\/radio3classica(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?raiplaysound\.it\/radio3classica\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (raiplaysound.it/audio/...) or a playlist " +
    "(raiplaysound.it/playlist/...) plays its own recording; paste one of those.",
  masterUrl:
    "https://radiotreclassica-live.akamaized.net/hls/live/2032595/radiotreclassica/radiotreclassica/playlist.m3u8",
});
