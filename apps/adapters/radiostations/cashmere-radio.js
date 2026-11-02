"use strict";

// adapters/radiostations/cashmere-radio.js
//
// Cashmere Radio, Berlin-Lichtenberg. The livestream is Airtime/Icecast and
// answers to plain GET, so this is the createDirectStreamStation shape, the
// same as wxdu.js.
//
// liveRe IS NOT OPTIONAL. Without it the factory answers every URL of the
// domain with the livestream, which is what broke the adapters written in
// August: an episode page would have played whatever was on air instead of the
// recording. Here only the bare domain is live; /episode/... belongs to
// cashmere-archive.js, which sits ahead of this module in dispatch.js.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "cashmere-radio",
  title: "Cashmere Radio",
  matchRe: /^https?:\/\/(?:www\.)?cashmereradio\.com(?:\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(?:www\.)?cashmereradio\.com\/?(?:\?|#|$)/i,
  streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
  // Safety net only: with the dispatch order intact an episode URL never
  // reaches this module. If it ever does, say where the recording lives
  // instead of handing back the livestream.
  broadcastRe: /^https?:\/\/(?:www\.)?cashmereradio\.com\/episode\//i,
  archiveHint:
    "Cashmere Radio keeps its recordings on Mixcloud, linked from each episode page at cashmereradio.com/episode/...",
});
