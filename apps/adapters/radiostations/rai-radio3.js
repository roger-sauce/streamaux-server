"use strict";

// adapters/radiostations/rai-radio3.js -- the fixed Icecast pattern (see
// _direct-stream-station.js).
//
// matchRe repaired on 13.08.2026, and this one was worse than a missing
// live rule: "raiplaysound.it/radio3" also matches
// "raiplaysound.it/radio3classica", so pasting the Classica page played
// Radio 3 without a word. A boundary after "radio3" ends that.
//
// Everything below the station path is programmes; the recordings
// themselves live under /audio/ and /playlist/ and belong to
// raiplaysound-archive.js, which covers the whole house and sits ahead of
// this adapter.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "rai-radio3",
  title: "Rai Radio 3 (Livestream)",
  matchRe: /^https?:\/\/(www\.)?raiplaysound\.it\/radio3(\/|\?|#|$)/i,
  // The programme pages the guide collects. RaiPlay Sound also carries Rai
  // Radio 3 Classica under the same /programmi/<slug> shape, which would be a
  // conflict if the guide collected it -- it does not; rai_radio3 is its only
  // Rai station. Should that change, this line has to go and kgs= decides.
  broadcastRe: /^https?:\/\/(www\.)?raiplaysound\.it\/programmi\//i,
  liveRe: /^https?:\/\/(www\.)?raiplaysound\.it\/radio3\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (raiplaysound.it/audio/...) or a playlist " +
    "(raiplaysound.it/playlist/...) plays its own recording; paste one of those.",
  streamUrl: "https://icestreaming.rai.it/3.mp3",
});
