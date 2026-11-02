"use strict";

// adapters/radiostations/srf2.js -- the generic HLS pattern (see
// _generic-hls-live-station.js). Needs the /live/ proxy: the CDN keeps
// about six hours of segment history, hence the entry in
// LIVE_MANIFEST_SOURCES in autoplay-pi/server.js.
//
// matchRe tightened on 14.08.2026. It was not dead, only careless: without
// a boundary after "radio-srf-2-kultur" it caught every page beginning that
// way. The live page is "…-kultur-live-hoeren", so both spellings are named
// and everything else is refused.
//
// Broadcasts have a different shape -- srf.ch/audio/<show>/<title>?id=… ,
// two path parts after /audio/ instead of one -- and belong to
// srf-archive.js, which covers the whole house and sits ahead of this
// adapter. They never matched this matchRe, so the mistake here was the
// harmless one: pasting a broadcast gave "no adapter" rather than the
// livestream without a word.

const { createGenericHlsLiveStation } = require("../_generic-hls-live-station");

module.exports = createGenericHlsLiveStation({
  id: "srf2",
  title: "SRF 2 Kultur (Livestream)",
  matchRe: /^https?:\/\/(www\.)?srf\.ch\/audio\/radio-srf-2-kultur(-live-hoeren)?(\/|\?|#|$)/i,
  // Broadcast pages are srf.ch/audio/<strand>/<episode> and do not name the
  // channel. Safe for the same reason as NRK: only guide shares get here, and
  // SRF 2 Kultur is the only SRF channel the guide collects.
  broadcastRe: /^https?:\/\/(www\.)?srf\.ch\/audio\//i,
  liveRe: /^https?:\/\/(www\.)?srf\.ch\/audio\/radio-srf-2-kultur(-live-hoeren)?\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (srf.ch/audio/<show>/<title>?id=...) plays its own " +
    "recording; paste one of those.",
  masterUrl: "https://stxt-audiostreaming.akamaized.net/hls/live/2117380/srf2/master.m3u8",
});
