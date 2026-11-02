"use strict";

// adapters/_rne-hls-station.js
//
// Factory for RNE stations (Radio Nacional de Espana, RTVE). They all
// follow the same pattern:
//   https://rtvelivestream.rtve.es/rtvesec/rne/<slug>_main_dvr.m3u8
// The master playlist here -- unlike the other HLS factories -- offers
// muxed audio and video variants (Golumi platform, RESOLUTION and an avc1
// codec per variant) even though this is radio, presumably a studio camera
// simulcast. Every variant carries the same audio track (mp4a.40.2) and
// differs only in video quality, so this factory deliberately picks the
// LOWEST bandwidth variant instead of the highest as
// _generic-hls-live-station.js does -- no point burning bandwidth on the
// Pi for a picture nobody sees. There is also a sliding window of roughly
// an hour, as with ARD and SRF2, so the same /live/<id>.m3u8 rewriting
// proxy is needed.
//
// liveRe added on 14.08.2026, last of the five factories to get it. Until
// then every page a station's matchRe caught was answered with the
// livestream, without a word -- see the comment in extract().
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

const { fetchHtml, buildLiveManifest, unsupported } = require("./_shared");

function pickLowestVariant(masterText) {
  const lines = masterText.split("\n");
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/);
    const path = lines[i + 1] && lines[i + 1].trim();
    if (m && path && !path.startsWith("#")) {
      const bandwidth = parseInt(m[1], 10);
      if (!best || bandwidth < best.bandwidth) best = { bandwidth, path };
    }
  }
  return best;
}

function createRneHlsStation(opts) {
  const id = opts.id;
  const title = opts.title;
  const matchRe = opts.matchRe;
  const slug = opts.slug;
  const keepSegments = opts.keepSegments || 6;
  // Which URLs really are the station's live page. Without it the old
  // behaviour stands -- everything matchRe catches counts as live.
  const liveRe = opts.liveRe || null;
  // Where to go instead. A refusal that only says no is half an answer.
  const archiveHint = opts.archiveHint || "";

  // Accepted for symmetry with the other four factories, and deliberately left
  // unset by both RNE stations -- see the note in rne-radio-3.js. Present so a
  // broadcastRe passed here would not be silently ignored.
  const broadcastRe = opts.broadcastRe || null;
  const masterUrl = "https://rtvelivestream.rtve.es/rtvesec/rne/" + slug + "_main_dvr.m3u8";
  const liveManifestPath = "/live/" + id + ".m3u8";

  async function fetchLiveManifest() {
    const masterText = await fetchHtml(masterUrl);
    const best = pickLowestVariant(masterText);
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

module.exports = { createRneHlsStation: createRneHlsStation };
