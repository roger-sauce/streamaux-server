"use strict";

// adapters/_ard-hls-station.js
//
// Factory for ARD radio stations, which all share the same HLS CDN pattern
// (<broadcaster>-radio.ard-mcdn.de/<broadcaster>/radio/<slug>/hls/...).
// Confirmed for BR-Klassik, WDR 3, SWR Kultur and HR2 (2026-07-23).
//
// Important: extract() returns a relative path ("/live/<id>.m3u8") which
// server.js assembles on demand through fetchLiveManifest(). Returning the
// CDN URL directly failed: the full playlist carries the whole day's
// history (segments hours old come first), and the parameter meant for
// exactly that, "_HLS_skip=YES", is refused by Safari and AVPlayer on the
// first request (code 4, MEDIA_ERR_SRC_NOT_SUPPORTED), because a delta
// update presupposes a full playlist fetched earlier. buildLiveManifest
// (see _shared.js) builds a small, spec-conformant live playlist itself --
// works everywhere, no special parameter.

const { fetchHtml, buildLiveManifest, unsupported } = require("./_shared");

// Picks the highest-bandwidth variant from the master playlist instead of
// hardcoding a bitrate: when a station changes what it offers, the adapter
// follows by itself.
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

function createArdHlsStation(opts) {
  var id = opts.id;
  var title = opts.title;
  var matchRe = opts.matchRe;
  var broadcaster = opts.broadcaster;
  var stationSlug = opts.stationSlug;
  var keepSegments = opts.keepSegments || 6;
  // Which URLs really are the station's live page. Without this the old
  // behaviour stands -- everything matchRe catches counts as live -- so
  // stations can be brought over one at a time instead of switching all 26
  // at once and having checked none of them.
  var liveRe = opts.liveRe || null;
  // For stations where a regular expression is not enough. BR is that
  // case: there the live page has the same shape as the archive page
  // (/programm/<date>/<id>/) and differs only in the date, which cannot be
  // written as a pattern, only asked of the calendar. Return true for
  // live, otherwise false -- or the sentence that should stand in the
  // error instead.
  var liveTest = opts.liveTest || null;
  // Where to go instead. An error that only says "no" is half an answer.
  var archiveHint = opts.archiveHint || "Broadcasts to listen back to run through the ARD Audiothek (ardsounds.de).";

  // Which addresses of this station are BROADCAST pages -- the programme
  // pages the guide collects, not the live page. Read only by detectAdapter,
  // and only to answer with this station's livestream while a broadcast is
  // running; match() and extract() are untouched by it, so nothing about the
  // ordinary archive routing changes. Optional: without it the on-air lookup
  // falls back to match(), which is right wherever a station's broadcast pages
  // sit below the path its live page already claims.
  var broadcastRe = opts.broadcastRe || null;

  var masterUrl =
    "https://" + broadcaster + "-radio.ard-mcdn.de/" + broadcaster + "/radio/" + stationSlug + "/hls/master.m3u8";
  var liveManifestPath = "/live/" + id + ".m3u8";

  // A refusal here is the adapter working, not failing: the address is a
  // programme page and not the livestream, and saying so is the correct answer.
  // Marked as such since 31.08.2026 -- see unsupported() in _shared.js.
  function defaultRefusal() {
    return (
      "This is a programme page from " + title.replace(/ \(Livestream\)$/, "") +
      ", not the livestream. " + archiveHint
    );
  }

  async function fetchLiveManifest() {
    const masterText = await fetchHtml(masterUrl);
    const best = pickBestVariant(masterText);
    if (!best) {
      throw new Error(id + "-adapter: no stream variant found in the master playlist");
    }
    const segIndexUrl = new URL(best.path, masterUrl).href;
    const rawManifest = await fetchHtml(segIndexUrl);
    return buildLiveManifest(rawManifest, segIndexUrl, keepSegments);
  }

  function match(url) {
    return matchRe.test(url);
  }

  async function extract(url) {
    if (!match(url)) throw new Error(id + "-adapter: URL does not match: " + url);
    // The mistake that went unnoticed until 09.08.2026: a programme page
    // matched the same matchRe as the live page, and back came the
    // livestream, without a word. Putting on Monday's concert on Wednesday
    // therefore meant listening to the running programme and noticing only
    // by the sound of it.
    if (liveTest) {
      var verdict = liveTest(url);
      if (verdict !== true) {
        throw unsupported(typeof verdict === "string" && verdict ? verdict : defaultRefusal());
      }
    } else if (liveRe && !liveRe.test(url)) {
      throw unsupported(defaultRefusal());
    }
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

  return { match, extract, live, broadcastRe, fetchLiveManifest };
}

module.exports = { createArdHlsStation };
