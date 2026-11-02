"use strict";

// adapters/radiostations/wxdu.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// The last of the twenty-six stations to get a live rule, on 14.08.2026,
// and the only one where nothing else had to be corrected: the stream
// address hard-wired below is exactly the one wxdu.org/player.html uses,
// checked on the same day, and it answers 200 audio/mpeg with about
// 128 kbit/s -- the number in the file name is honest.
//
// Live is the front page and the player page; those are the two addresses
// the site leaves in the address bar. Everything else on wxdu.org is
// programme information.
//
// WXDU has no archive of its own. Its shows are published on Bandcamp, so
// the refusal points there rather than nowhere -- adapters/bandcamp.js has
// been in the set from the beginning and plays such an address with its
// tracklist.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "wxdu",
  title: "WXDU 88.7 FM (Duke University, Livestream)",
  matchRe: /^https?:\/\/(www\.)?wxdu\.org(\/|\?|#|$)/i,
  // The slash itself has to be optional too, not only what follows it:
  // written as "\/(player\.html)?" the bare "https://wxdu.org" fell through
  // to the refusal. Caught by the test table, not by reading.
  liveRe: /^https?:\/\/(www\.)?wxdu\.org(\/player\.html|\/)?(\?|#|$)/i,
  archiveHint:
    "WXDU keeps its recordings on Bandcamp; paste the Bandcamp address of " +
    "the show and it plays with its tracklist.",
  streamUrl: "https://weeping.wxdu.duke.edu:8443/wxdu128.mp3",
});
