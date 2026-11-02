"use strict";

// adapters/radiostations/rte-2fm.js -- the fixed stream pattern (see
// _direct-stream-station.js).
//
// The address handed to ffmpeg is an HLS master, not an mp3, and that was
// worth a second look on 14.08.2026: a master playlist usually means the
// station belongs on _generic-hls-live-station.js with the /live/ proxy.
// Measured, it does not.
//
//   - The window is three segments of ten seconds. Nothing to trim.
//   - The single variant points at StreamTheWorld with a SESSION ID in the
//     path (.../HLS/<uuid>/0/playlist.m3u8), issued fresh per request. The
//     proxy would fetch the master anew on every call, open a new session
//     each time, and renumber EXT-X-MEDIA-SEQUENCE from whatever the new
//     session starts at -- a sequence running backwards is what players
//     abort on. Handing the master to ffmpeg keeps exactly one session.
//
// So this stays where it is. Recordings live under
// rte.ie/radio/<station>/<series>/episodes/<uuid>/ and belong to
// rte-archive.js, which covers the whole house and sits ahead of this
// adapter -- without the live rule below, an episode page matched this
// matchRe and was answered with the livestream, without a word.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "rte-2fm",
  title: "RTÉ 2fm (Livestream)",
  matchRe: /^https?:\/\/(www\.)?rte\.ie\/radio\/2fm(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?rte\.ie\/radio\/2fm\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (rte.ie/radio/2fm/<series>/episodes/<uuid>/) plays its " +
    "own recording; paste one of those.",
  streamUrl: "https://www.rte.ie/manifests/2fm.m3u8",
});
