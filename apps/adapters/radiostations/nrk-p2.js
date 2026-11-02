"use strict";

// adapters/radiostations/nrk-p2.js -- the generic HLS pattern (see
// _generic-hls-live-station.js).
//
// NRK addresses an episode as radio.nrk.no/serie/<name>/<PROGRAMMEID>, and
// the id is what psapi answers to -- see nrk-archive.js, which sits ahead
// of this adapter and covers every NRK channel at once. The live pages
// carry no such id, so the two never collide; liveRe here is insurance for
// pages that may appear below /direkte/p2/.

const { createGenericHlsLiveStation } = require("../_generic-hls-live-station");

module.exports = createGenericHlsLiveStation({
  id: "nrk-p2",
  title: "NRK P2 (Livestream)",
  matchRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?p2/i,
  // Broadcast pages are radio.nrk.no/serie/<slug>/<id> and say nothing about
  // the channel. The second half of the reason given here until 10.09.2026 --
  // "the guide collects no NRK channel but P2" -- stopped being true that day,
  // when NRK Klassisk and NRK Jazz were added. What still holds is the first
  // half: the on-air lookup takes `kgs=<stationId>` from the shared address
  // first (see STATION_BY_ID below), and only falls back to this regex when a
  // share carries no station. Such a fallback now answers P2's livestream for
  // any NRK episode page, which is a wrong station rather than a wrong house.
  // The two new adapters deliberately carry no broadcastRe, so they cannot
  // make that ambiguity worse.
  broadcastRe: /^https?:\/\/radio\.nrk\.no\/serie\//i,
  liveRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?p2\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (radio.nrk.no/serie/<name>/<id>) plays its own recording; " +
    "paste one of those.",
  masterUrl: "https://nrk-live-radio-world.akamaized.net/p2/muxed.m3u8?adap=audio&aco=aac",
});
