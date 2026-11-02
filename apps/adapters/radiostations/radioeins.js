"use strict";

// adapters/radiostations/radioeins.js -- the fixed dispatcher pattern (see
// _direct-stream-station.js).
//
// rbb Radio 1, added 03.09.2026 on a recommendation: strongly Berlin-regional,
// and it carries small local live concerts that no other station in the guide
// has.
//
// THE ADDRESS IS THE DISPATCHER, never a resolved node. Asking it answers 302
// towards something like f131.rndfnk.com/...?token=..., and those tokens
// expire. Same rule as VRT's icecast entry point, and the reason radio3 next
// door stores the same shape.
//
// AND `high` IS NOT A GENERAL NAME. radio3 uses /rbb/rbbkultur/live/mp3/high;
// the same spelling for radioeins is a 404. It wants `128`, and it wants the
// `/stream.mp3` suffix that rbbkultur does not need. Copy the line out of
// radio3.js and the failure arrives at playback rather than at build time --
// measured 03.09.2026, all four of 256, 192, `high` and `aac` refused.
//
// 128 is all there is here, and that is the station's decision rather than a
// bad guess of ours: rbbkultur's `high` resolves to /mp3/256/, while every one
// of the three delivery nodes radioeins' own web player uses carries /mp3/128/.
// A culture channel gets the higher bitrate, a pop channel does not.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "radioeins",
  title: "radioeins (Livestream)",
  matchRe: /^https?:\/\/(www\.)?radioeins\.de/i,
  liveRe: /^https?:\/\/(www\.)?radioeins\.de\/livestream(\/|\?|#|$)/i,
  // The programme and the editorial music pages -- read only by the on-air
  // lookup in dispatch.js, never by match() or extract(). radioeins' archive
  // entries do not come from here at all: the collection stores their ARD
  // Sounds episode address, which ard-audiothek.js resolves.
  broadcastRe: /^https?:\/\/(www\.)?radioeins\.de\/(programm|musik|themen)\//i,
  archiveHint:
    "Broadcasts to listen back to sit in the ARD Audiothek: an " +
    "ardsounds.de/episode/urn:ard:episode:<id> address plays. radioeins keeps " +
    "them for about a year.",
  streamUrl: "https://dispatcher.rndfnk.com/rbb/radioeins/live/mp3/128/stream.mp3",
});
