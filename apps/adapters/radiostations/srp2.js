"use strict";

// adapters/radiostations/srp2.js -- the fixed stream pattern (see
// _direct-stream-station.js). Channel 163 in SR's numbering, the same
// number that turns up in the API's statkey for a P2 broadcast.
//
// matchRe tightened on 14.08.2026. It was not dead, only careless: without
// a boundary after "p2" it caught everything beginning that way.
//
// Broadcasts have a different shape -- sverigesradio.se/avsnitt/... -- and
// belong to sr-archive.js, which covers the whole house and sits ahead of
// this adapter. They never matched this matchRe, so the mistake here was
// the harmless one: pasting a broadcast gave "no adapter" rather than the
// livestream without a word.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "srp2",
  title: "Sveriges Radio P2 (Livestream)",
  matchRe: /^https?:\/\/(www\.)?sverigesradio\.se\/(kanaler\/)?p2(\/|\?|#|$)/i,
  liveRe: /^https?:\/\/(www\.)?sverigesradio\.se\/(kanaler\/)?p2\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (sverigesradio.se/avsnitt/...) plays its own " +
    "recording; paste one of those.",
  streamUrl: "https://www.sverigesradio.se/topsy/direkt/srapi/163.mp3",
});
