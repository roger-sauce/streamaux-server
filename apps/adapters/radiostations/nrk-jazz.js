"use strict";

// adapters/radiostations/nrk-jazz.js -- the generic HLS pattern (see
// _generic-hls-live-station.js).
//
// Added 10.09.2026 for a station that will report almost nothing. NRK Jazz is
// a rolling jazz stream cut by time of day -- Nattjazz, Kveldsjazz, Morgenjazz
// -- and the guide collects one strand from it, `Lørdagsjazz`, and only where
// the announcement names a place: its archive holds "Jazz Award 2023: Live
// from the Ibsen House in Skien". A channel that travels twice a year is worth
// a livestream all the same, and the app has to be able to play it when it
// does.
//
// `jazz` answers 200 with application/x-mpegURL; `nrk_jazz` and `alltid_jazz`
// answer 404. Measured 10.09.2026 with p2 as a control.
//
// No broadcastRe -- see nrk-klassisk.js for why.

const { createGenericHlsLiveStation } = require("../_generic-hls-live-station");

module.exports = createGenericHlsLiveStation({
  id: "nrk-jazz",
  title: "NRK Jazz (Livestream)",
  matchRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?jazz/i,
  liveRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?jazz\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (radio.nrk.no/serie/<name>/<id>) plays its own recording; " +
    "paste one of those.",
  masterUrl: "https://nrk-live-radio-world.akamaized.net/jazz/muxed.m3u8?adap=audio&aco=aac",
});
