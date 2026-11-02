"use strict";

// adapters/radiostations/nrk-klassisk.js -- the generic HLS pattern (see
// _generic-hls-live-station.js).
//
// Added 10.09.2026, together with the guide's NRK Klassisk collector. Until
// that day the guide asked NRK's EPG for `p2` alone, and its concert strands
// were invisible: `På konsert` and `På konsert med KORK` run here, three
// broadcasts in the week of 07.09.2026 and none of them on P2.
//
// The master address was measured, not derived from P2's by analogy: `klassisk`
// answers 200 with application/x-mpegURL, while `nrk_klassisk` and
// `alltid_klassisk` answer 404. P2 was asked in the same run as a control.
//
// NO broadcastRe HERE, and that is deliberate. NRK addresses an episode as
// radio.nrk.no/serie/<slug>/<id>, which says nothing about the channel -- with
// three NRK channels collected it can no longer identify a station. The on-air
// lookup finds this adapter through `kgs=<stationId>` in the shared address
// (dispatch.js, STATION_BY_ID); the regex fallback below it is left to
// nrk-p2.js, where it has been since before the ambiguity existed.

const { createGenericHlsLiveStation } = require("../_generic-hls-live-station");

module.exports = createGenericHlsLiveStation({
  id: "nrk-klassisk",
  title: "NRK Klassisk (Livestream)",
  matchRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?klassisk/i,
  liveRe: /^https?:\/\/(www\.)?(radio\.)?nrk\.no\/(direkte\/)?klassisk\/?(\?|#|$)/i,
  archiveHint:
    "An episode page (radio.nrk.no/serie/<name>/<id>) plays its own recording; " +
    "paste one of those.",
  masterUrl: "https://nrk-live-radio-world.akamaized.net/klassisk/muxed.m3u8?adap=audio&aco=aac",
});
