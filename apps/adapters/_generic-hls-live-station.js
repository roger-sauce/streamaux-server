"use strict";

// adapters/_generic-hls-live-station.js
//
// Factory for HLS live stations with a fixed master URL that -- as with
// some ARD stations -- serves far too large a sliding window (SRF2, for
// instance, keeps about six hours of segment history instead of a few
// seconds). Those need the same /live/<id>.m3u8 rewriting proxy as
// _ard-hls-station.js. What differs is where the master URL comes from:
// not a convention built from broadcaster and station slug, but an
// arbitrary URL passed in -- hence a separate generic factory rather than
// an extension of _ard-hls-station.js.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

const { fetchHtml, buildLiveManifest, unsupported } = require("./_shared");

function pickBestVariant(masterText) {
  const lines = masterText.split("\n");
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/);
    const path = lines[i + 1] && lines[i + 1].trim();
    if (m && path && !path.startsWith("#")) {
      const bandwidth = parseInt(m[1], 10);
      if (!best || bandwidth > best.bandwidth) best = { bandwidth, path };
    }
  }
  return best;
}

function createGenericHlsLiveStation(opts) {
  const id = opts.id;
  const title = opts.title;
  const matchRe = opts.matchRe;
  const masterUrl = opts.masterUrl;
  const keepSegments = opts.keepSegments || 6;
  // Which URLs really are the station's live page. Without it the old
  // behaviour stands -- everything matchRe catches counts as live -- so the
  // stations on this factory can be brought over one at a time.
  const liveRe = opts.liveRe || null;
  // Where to go instead. A refusal that only says no is half an answer.
  const archiveHint = opts.archiveHint || "";

  // Which addresses of this station are BROADCAST pages -- the programme
  // pages the guide collects, not the live page. Read only by detectAdapter,
  // and only to answer with this station's livestream while a broadcast is
  // running; match() and extract() are untouched by it, so nothing about the
  // ordinary archive routing changes. Optional: without it the on-air lookup
  // falls back to match(), which is right wherever a station's broadcast pages
  // sit below the path its live page already claims.
  const broadcastRe = opts.broadcastRe || null;
  const liveManifestPath = "/live/" + id + ".m3u8";

  async function fetchLiveManifest() {
    const masterText = await fetchHtml(masterUrl);
    const best = pickBestVariant(masterText);
    if (!best) throw new Error(id + "-adapter: no stream variant found in the master playlist");
    const segIndexUrl = new URL(best.path, masterUrl).href;
    const rawManifest = await fetchHtml(segIndexUrl);
    return buildLiveManifest(rawManifest, segIndexUrl, keepSegments);
  }

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
      tracks: [{ title: title, streamUrl: liveManifestPath }],
      tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
    };
  }

  return { match: match, extract: extract, live: live, broadcastRe: broadcastRe, fetchLiveManifest: fetchLiveManifest };
}

module.exports = { createGenericHlsLiveStation: createGenericHlsLiveStation };
