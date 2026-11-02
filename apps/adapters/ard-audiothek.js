"use strict";

// adapters/ard-audiothek.js
//
// Archive broadcasts from the ARD Audiothek -- since 2026 at ardsounds.de,
// while the old ardaudiothek.de carries the same URLs. Both domains are
// accepted: the URN scheme (urn:ard:episode:<hash>) is identical, and links
// from older sources still bear the old name.
//
// This brings in the case the whole thing was always about: hearing
// Monday's concert on Wednesday. The livestream adapters could never do it
// -- given a programme page they quietly played the running programme (see
// the liveRe guard in _ard-hls-station.js).
//
// One call is enough: the API takes the URN directly and needs neither the
// detour over the page nor GraphQL (measured 09.08.2026):
//   https://api.ardaudiothek.de/items/urn:ard:episode:f4f74954d4bcf755
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const API = "https://api.ardaudiothek.de/items/";

// Episode pages on both domains, with a URN or a numeric identifier.
const URL_RE = /^https?:\/\/(www\.)?(ardsounds\.de|ardaudiothek\.de)\/episode\/([^/?#]+)/i;

function match(url) {
  return URL_RE.test(url);
}

// "9m 25s", "1h 4m", "59s" -- the notation changes from desk to desk, so
// each unit is looked for on its own instead of expecting a fixed pattern.
function parseLength(text) {
  if (!text) return null;
  var hours = /(\d+)\s*h/i.exec(text);
  var minutes = /(\d+)\s*m(?!s)/i.exec(text);
  var seconds = /(\d+)\s*s/i.exec(text);
  if (!hours && !minutes && !seconds) return null;
  return (
    (hours ? Number(hours[1]) * 3600 : 0) +
    (minutes ? Number(minutes[1]) * 60 : 0) +
    (seconds ? Number(seconds[1]) : 0)
  );
}

// The tracklist arrives as running text in the synopsis field, separated
// by "+++", and the first block carries the programme description ahead of
// it:
//
//   Kein anderer Jazzmusiker ... polarisiert.
//
//   Wynton Marsalis Septet - Black Codes From The Underground (9m 25s)
//   +++
//   Wynton Marsalis Septet - Where's The Music (3m 24s)
//
// It is not a data field but text written by hand, so nothing is forced
// here: a line that does not fit the pattern is taken as a title without
// artist and without length rather than thrown away.
function parseTracklist(synopsis) {
  if (!synopsis || synopsis.indexOf("+++") < 0) return [];
  return synopsis
    .split(/\+\+\+/)
    .map(function (block) {
      // From the first block only the last non-empty line -- what stands
      // before it is the description of the programme.
      var lines = block.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      return lines.length ? lines[lines.length - 1] : "";
    })
    .filter(Boolean)
    .map(function (line) {
      var withLength = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(line);
      var head = withLength ? withLength[1].trim() : line;
      var duration = withLength ? parseLength(withLength[2]) : null;

      var split = /^(.*?)\s+-\s+(.*)$/.exec(head);
      return {
        artist: split ? split[1].trim() : "",
        title: split ? split[2].trim() : head,
        seconds: null,
        duration: duration,
        link: null,
      };
    });
}

// There are no start times, but there are lengths. The difference to the
// total is presenting; spread evenly across the gaps, one before each
// piece, the sum works out exactly and the error stays at a minute or two
// -- instead of growing towards the end to the entire presenting time, as
// plain adding up would.
//
// Deliberately only where the arithmetic is plausible: if a length is
// missing, or the sum exceeds the broadcast, seconds stays null and the app
// shows no start time rather than an invented one.
function estimateOffsets(entries, total) {
  if (!entries.length || !total) return entries;
  var lengths = entries.map(function (e) { return e.duration; });
  if (lengths.some(function (d) { return !d; })) return entries;

  var sum = lengths.reduce(function (a, b) { return a + b; }, 0);
  if (sum >= total) return entries;

  var gap = (total - sum) / entries.length;
  var cursor = 0;
  return entries.map(function (entry, i) {
    cursor += gap;
    var start = cursor;
    cursor += lengths[i];
    return Object.assign({}, entry, { seconds: Math.round(start), estimated: true });
  });
}

function imageUrl(image) {
  if (!image) return null;
  var raw = image.url1X1 || image.url;
  if (!raw) return null;
  // The image API expects a width in place of the placeholder.
  return raw.replace("{width}", "448");
}

async function extract(url) {
  var hit = URL_RE.exec(url);
  if (!hit) throw new Error("ard-audiothek-adapter: URL does not match: " + url);

  var id = decodeURIComponent(hit[3]);
  var resp = await fetch(API + encodeURIComponent(id), { headers: { accept: "application/json" } });
  if (!resp.ok) {
    throw new Error("ard-audiothek-adapter: API answers with HTTP " + resp.status + " for " + id);
  }
  var body = await resp.json();
  var item = body && body.data && body.data.item;
  if (!item) throw new Error("ard-audiothek-adapter: no episode in the answer for " + id);

  var audio = (item.audios || []).find(function (a) { return a && (a.url || a.downloadUrl); });
  var streamUrl = audio && (audio.url || audio.downloadUrl);
  if (!streamUrl) throw new Error("ard-audiothek-adapter: no audio in episode " + id);

  var show = (item.tracking && item.tracking.page && item.tracking.page.page_show) || null;
  var title = item.title || show || "ARD Audiothek";
  var duration = typeof item.duration === "number" ? item.duration : null;

  return {
    title: title,
    sourceType: "ard-audiothek",
    artist: show,
    cover: imageUrl(item.image),
    // A finished file with a known length -- that is what sets these apart
    // from everything else here, and the reason these broadcasts can have a
    // real progress bar.
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: imageUrl(item.image) }],
    tracklist: estimateOffsets(parseTracklist(item.synopsis), duration),
  };
}

module.exports = { match, extract };
