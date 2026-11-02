"use strict";

// adapters/radiostations/world-of-jazz.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// World of Jazz runs on Concertzender's installation: the same Icecast
// server (streams.greenhost.nl:8006, "jazz" instead of "live"), the same
// page shapes, and its concert recordings even sit in Concertzender's own
// directory (/cz_rod/cp/). So the same rule applies as there -- live is the
// front page AND NOTHING ELSE.
//
// Until 14.08.2026 the matchRe claimed the whole site without a live rule,
// so every page of it answered with the livestream, without a word. The
// concert pages are the ones that hurt: they carry real recordings, fifteen
// pieces on the one measured, and all of it was being passed over in favour
// of whatever happened to be on air.
//
// Careful with /programma_woj/<name>_<id>/: measured on 14.08.2026 it holds
// no recording at all, only the description -- which is exactly why it is
// NOT left to this adapter. concertzender-archive.js claims it and says so
// plainly, and will play a file the day one appears. That adapter sits
// ahead of this one in dispatch.js.
//
// Livestream measured 14.08.2026: 200, audio/mpeg, 625 KB in five seconds.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "world-of-jazz",
  title: "World of Jazz (Livestream)",
  matchRe: /^https?:\/\/(www\.)?worldofjazz\.nl(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?worldofjazz\.nl\/?(\?|#|$)/i,
  archiveHint:
    "A concert (worldofjazz.nl/concertpodium/<name>/) plays its own " +
    "recording; paste one of those.",
  streamUrl: "https://streams.greenhost.nl:8006/jazz",
});
