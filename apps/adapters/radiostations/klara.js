"use strict";

// adapters/radiostations/klara.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// matchRe was narrow already: the archive lives under /vrtmax/luister/...
// and was never claimed by this adapter. It is handled by vrt-archive.js,
// which signs in -- VRT releases broadcasts to accounts only. liveRe here
// is insurance for pages that may appear below /kanalen/klara/.

// The stream URL below is an entry point, not the audio: it answers 302 to
// quantumcast.vrtcdn.be and from there to a vrt.streamabc.net address
// carrying a session key. Always hand out this stable URL and never the
// resolved one -- the same rule as for dispatcher.rndfnk.com in radio3.js.
// ffmpeg follows the chain by itself; only try-adapter.js stumbles over it,
// which is a limitation of the tool, not of the stream.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "klara",
  title: "Klara (VRT, Livestream)",
  matchRe: /^https?:\/\/(www\.)?vrt\.be\/vrtmax\/(livestream\/audio|kanalen)\/klara/i,
  liveRe: /^https?:\/\/(www\.)?vrt\.be\/vrtmax\/(livestream\/audio|kanalen)\/klara\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (vrt.be/vrtmax/luister/...) plays its own recording; paste one of those.",
  streamUrl: "https://icecast.vrtcdn.be/klara-high.mp3",
});
