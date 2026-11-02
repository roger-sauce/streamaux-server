"use strict";

// adapters/_radiofrance-hls-station.js
//
// Factory for Radio France stations (France Musique, France Inter, ...).
// They all follow the same pattern:
//   https://stream.radiofrance.fr/<slug>/<slug>.m3u8?id=radiofrance
// Unlike the ARD stations, the master playlist here already comes as a
// small sliding window -- no full-day history problem -- so the static
// master URL serves directly as streamUrl, without the /live/<id>.m3u8
// proxy the ARD stations need.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

const { unsupported } = require("./_shared");

function createRadioFranceStation(opts) {
  var id = opts.id;
  var title = opts.title;
  var matchRe = opts.matchRe;
  var slug = opts.slug;
  // Which URLs really are the station's live page. Without it the old
  // behaviour stands -- everything matchRe catches counts as live -- so the
  // stations on this factory can be brought over one at a time.
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
  var streamUrl = "https://stream.radiofrance.fr/" + slug + "/" + slug + ".m3u8?id=radiofrance";

  function match(url) {
    return matchRe.test(url);
  }

  // A refusal here is the adapter working, not failing: the address is a
  // programme page and not the livestream, and saying so is the correct answer.
  // Marked as such since 31.08.2026 -- see unsupported() in _shared.js.
  function defaultRefusal() {
    return (
      "This is not the " + title.replace(/ \(Livestream\)$/, "") +
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

module.exports = { createRadioFranceStation: createRadioFranceStation };
