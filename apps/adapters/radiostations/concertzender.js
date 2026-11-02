"use strict";

// adapters/radiostations/concertzender.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// Concertzender is the odd one among the stations here: it has no live page
// at all. The "Luister live" button leads to the page of whatever programme
// is currently on air (/programma/<id>/, an opaque number that changes with
// every slot), and that page is not the live stream but the recording of
// the programme's first broadcast -- measured 12.08.2026, the page of
// today's "Meesterpianisten" carries .../rod/20250629-1400.mp3, a repeat
// from June 2025. "rod" is radio on demand.
//
// So live is the front page and nothing else, and the programme pages go to
// concertzender-archive.js, which plays what actually stands on them. That
// adapter sits ahead of this one in dispatch.js.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "concertzender",
  title: "Concertzender (Livestream)",
  matchRe: /^https?:\/\/(www\.)?concertzender\.nl/i,
  liveRe: /^https?:\/\/(www\.)?concertzender\.nl\/?(\?|#|$)/i,
  archiveHint:
    "A programme page (concertzender.nl/programma/<id>/) or a concert " +
    "(concertzender.nl/concertpodium/<name>/) plays its own recording; paste one of those.",
  streamUrl: "https://streams.greenhost.nl:8006/live",
});
