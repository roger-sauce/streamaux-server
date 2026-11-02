"use strict";

// adapters/_direct-stream-station.js
//
// Factory for stations with one fixed, directly playable audio stream URL
// (Icecast/Shoutcast mp3, no HLS). No live manifest proxy is needed here
// because there is no playlist to parse or trim -- see
// _generic-hls-live-station.js for the HLS sliding window case.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

const { unsupported } = require("./_shared");

function createDirectStreamStation(opts) {
  var id = opts.id;
  var title = opts.title;
  var matchRe = opts.matchRe;
  var streamUrl = opts.streamUrl;
  // Which URLs really are the station's live page. Without it the old
  // behaviour stands -- everything matchRe catches counts as live -- so the
  // eleven stations on this factory can be brought over one at a time
  // instead of switching all of them and having checked none.
  var liveRe = opts.liveRe || null;
  // Where to go instead. A refusal that only says no is half an answer.
  var archiveHint = opts.archiveHint || "";

  // Which addresses of this station are BROADCAST pages -- the programme
  // pages the guide collects, not the live page. Read only by detectAdapter,
  // and only to answer with this station's livestream while a broadcast is
  // running; match() and extract() are untouched by it, so nothing about the
  // ordinary archive routing changes. Optional: without it the on-air lookup
  // falls back to match(), which is right wherever a station's broadcast pages
  // sit below the path its live page already claims.
  var broadcastRe = opts.broadcastRe || null;

  function match(url) {
    return matchRe.test(url);
  }

  // A refusal here is the adapter working, not failing: the address is a
  // programme page and not the livestream, and saying so is the correct answer.
  // Marked as such since 31.08.2026 -- see unsupported() in _shared.js.
  function defaultRefusal() {
    return (
      "This is not the " + title.replace(/\s*\([^)]*Livestream[^)]*\)\s*$/i, "") +
      " livestream but another page of the site. " + archiveHint
    ).trim();
  }

  async function extract(url) {
    if (!match(url)) throw new Error(id + "-adapter: URL does not match: " + url);
    // The mistake that went unnoticed until 09.08.2026: a programme page
    // matched the same matchRe as the live page, and back came the
    // livestream, without a word.
    if (liveRe && !liveRe.test(url)) throw unsupported(defaultRefusal());
    return live();
  }

  // The same answer as above, without the gate. detectAdapter() reaches for
  // this when the shared address says the broadcast is on air right now: the
  // address is then a programme page, extract() refuses it correctly, and the
  // livestream is nonetheless what was asked for. See adapters/_on-air.js.
  function live() {
    return {
      title: title,
      sourceType: id,
      tracks: [{ title: title, streamUrl: streamUrl }],
      tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
    };
  }

  return { match: match, extract: extract, live: live, broadcastRe: broadcastRe };
}

module.exports = { createDirectStreamStation: createDirectStreamStation };
