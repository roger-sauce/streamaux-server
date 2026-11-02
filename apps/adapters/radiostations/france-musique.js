"use strict";

// adapters/radiostations/france-musique.js -- the Radio France HLS pattern
// (see _radiofrance-hls-station.js). Same house as France Inter, same
// address scheme: /<station>/podcasts/<emission>/<titre>-<id> is a
// broadcast, the bare station path is live.

const { createRadioFranceStation } = require("../_radiofrance-hls-station");

module.exports = createRadioFranceStation({
  id: "france-musique",
  title: "France Musique (Livestream)",
  matchRe: /^https?:\/\/(www\.)?radiofrance\.fr\/francemusique/i,
  // The guide collects from francemusique.fr, the live page sits on
  // radiofrance.fr/francemusique -- two hosts for one station. Only the
  // on-air lookup reads this; see _direct-stream-station.js.
  broadcastRe: /^https?:\/\/(www\.)?francemusique\.fr\//i,
  liveRe: /^https?:\/\/(www\.)?radiofrance\.fr\/francemusique\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (radiofrance.fr/<station>/podcasts/<emission>/<title>-<id>) plays " +
    "its own recording; paste one of those.",
  slug: "francemusique",
});
