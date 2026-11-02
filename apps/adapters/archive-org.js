"use strict";

// adapters/archive-org.js
//
// The Internet Archive. Not a station and not one broadcaster's archive but
// a house of millions of entries -- the Great 78 Project, the Live Music
// Archive (etree, concert recordings published with the bands' consent),
// LibriVox, the netlabel collections. Listening is what the place is for,
// and the way in is documented and open:
//
//   https://archive.org/details/<identifier>   what the address bar shows
//   https://archive.org/metadata/<identifier>  the data, one call, no key
//   https://archive.org/download/<identifier>/<file>   the file itself
//
// FIRST TRAP: every piece is there SEVERAL TIMES, once per format. The
// Smashing Pumpkins concert measured on 14.08.2026 holds 20 pieces as 60
// files -- flac, mp3 and ogg each. Walking the file list as it comes would
// build a queue that plays everything three times over. So the files are
// grouped first and one is chosen per group.
//
// SECOND TRAP: there are two ways of telling which piece is which, and an
// entry has one or the other, not both.
//   - a "track" field ("1", "2", ...), as the netlabel albums use. Their
//     file names cannot be grouped -- "1.mp3" against "1_vbr.mp3".
//   - nothing but the file name, as etree uses: tsp2000-05-09d1t01.flac and
//     .mp3 and .ogg. No track field at all.
// Hence: group by track where there is one, by the bare file name where
// there is not.
//
// THIRD TRAP: "length" comes in two spellings, and both occur inside the
// same entry -- "262.35" is seconds, "04:22" is minutes and seconds, and
// they are the same length written differently.
//
// A title may be missing on one format and present on another (the .ogg
// files of the concert carry none), so the name is taken from whichever
// version of a piece has one, not from the one that ends up being played.
// The website does the same.
//
// WHICH FORMAT: lossless first -- no lossy artefacts before the resampling
// -- and among several lossless versions the SMALLEST. autoplay-pi hands
// everything to ffmpeg with "-ar 44100 -ac 2" (see server.js), so a 24 bit
// 96 kHz master is resampled down on the way to Roon anyway; the extra 80
// megabytes buy nothing. Among lossy versions the LARGEST wins, which
// sorts 320 kbit/s above VBR above Ogg without any bitrate parsing.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText, toIsoDate } = require("./_shared");

const BASE = "https://archive.org";
// "@name" is a user page, not an item -- it has no metadata to fetch.
const ITEM_RE = /^https?:\/\/(?:www\.)?archive\.org\/(?:details|download|embed)\/(?!@)([^/?#]+)/i;

// FOURTH TRAP, and it cost the first run on 14.08.2026: an item holds far
// more than its audio, and the rest cannot be told apart by the file NAME.
// The concert measured carries 170 files in 14 formats, of which exactly
// three are audio --
//
//   Flac 20, VBR MP3 20, Ogg Vorbis 20
//
// -- while the other eleven are Item Tile, Archive BitTorrent, Metadata,
// Flac FingerPrint, Checksums, Text, Columbia Peaks, PNG, Essentia High GZ,
// Essentia Low GZ and Spectrogram. Two of those are traps in themselves:
// "Flac FingerPrint" carries the word Flac without being audio, and the
// item's own identifier is "tsp2000-05-09.FM.flac16", so EVERY file name in
// it contains "flac" -- including the torrent and the XML. Matching on the
// name put a .txt at the head of the queue.
//
// So the extension decides what is audio at all, and the format decides
// what kind. Never the name.
const AUDIO_EXT_RE = /\.(flac|mp3|mp2|ogg|oga|m4a|m4b|aac|opus|wav|aif|aiff|shn|ape|wma)$/i;
const NOT_AUDIO_FORMAT_RE =
  /fingerprint|checksum|metadata|torrent|peaks|spectrogram|thumb|tile|text|subrip|essentia|cue|\blog\b|png|jpe?g/i;
const LOSSLESS_FORMAT_RE = /flac|wave?\b|aiff|shorten|apple lossless|monkey/i;

function idOf(url) {
  const hit = ITEM_RE.exec(String(url || ""));
  return hit ? decodeURIComponent(hit[1]) : null;
}

function match(url) {
  return idOf(url) !== null;
}

// "262.35" (seconds) and "04:22" (minutes and seconds) both occur, see the
// third trap above. An hour-long piece writes "1:02:15".
function parseLength(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  if (text.indexOf(":") !== -1) {
    const parts = text.split(":").map(Number);
    if (!parts.length || parts.some(function (n) { return !Number.isFinite(n); })) return null;
    const seconds = parts.reduce(function (total, n) { return total * 60 + n; }, 0);
    return seconds > 0 ? Math.round(seconds) : null;
  }
  const seconds = parseFloat(text);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

// The format says what kind of audio it is; only where there is none does
// the extension have to stand in.
function isLossless(file) {
  const format = String(file.format || "");
  if (format) return LOSSLESS_FORMAT_RE.test(format);
  return /\.(flac|wav|aiff?|shn|ape)$/i.test(String(file.name || ""));
}

function isAudio(file) {
  if (!file || !file.name) return false;
  // The extension first: it alone throws out the torrent, the XML and the
  // .ffp fingerprint, whatever their names happen to contain.
  if (!AUDIO_EXT_RE.test(file.name)) return false;
  return !NOT_AUDIO_FORMAT_RE.test(String(file.format || ""));
}

function sizeOf(file) {
  const n = Number(file.size);
  return Number.isFinite(n) ? n : 0;
}

// A track number only counts when it is really one: the netlabel album
// hc040 carries track "0", which is no more use for grouping than nothing.
function trackNumber(file) {
  const n = parseInt(String(file.track == null ? "" : file.track).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function baseName(name) {
  return String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

function groupKey(file) {
  const track = trackNumber(file);
  return track === null ? "name:" + baseName(file.name) : "track:" + track;
}

// The file the listener gets: lossless before lossy, the smallest of the
// lossless ones, the largest of the lossy ones. See the note at the top for
// why smallest rather than largest among the lossless.
function pickFile(members) {
  const lossless = members.filter(isLossless);
  if (lossless.length) {
    return lossless.reduce(function (best, f) {
      return !best || (sizeOf(f) && sizeOf(f) < sizeOf(best)) ? f : best;
    }, null);
  }
  return members.reduce(function (best, f) {
    return !best || sizeOf(f) > sizeOf(best) ? f : best;
  }, null);
}

function groupTitle(members, fallback) {
  for (let i = 0; i < members.length; i++) {
    const title = cleanText(members[i].title);
    if (title) return title;
  }
  return fallback;
}

function groupLength(members) {
  for (let i = 0; i < members.length; i++) {
    const seconds = parseLength(members[i].length);
    if (seconds) return seconds;
  }
  return null;
}

// The file name may carry a directory part, and each part has to be encoded
// on its own -- encodeURIComponent would turn the separating slash into
// %2F.
function downloadUrl(id, name) {
  const path = String(name || "").split("/").map(encodeURIComponent).join("/");
  return BASE + "/download/" + encodeURIComponent(id) + "/" + path;
}

// creator comes as a string on one entry and as a list on the next.
function creatorOf(metadata) {
  const value = metadata.creator || metadata.artist;
  if (Array.isArray(value)) return cleanText(value.filter(Boolean).join(", "));
  return cleanText(value);
}

function buildGroups(files) {
  const order = [];
  const byKey = new Map();
  files.forEach(function (file) {
    const key = groupKey(file);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(file);
  });
  return order.map(function (key) {
    const members = byKey.get(key);
    return {
      track: trackNumber(members[0]),
      name: members[0].name,
      members: members,
    };
  });
}

// By track where there is one; where there is not, by file name -- which is
// right for etree, whose numbers carry leading zeros (d1t01 ... d1t20, then
// d2t01). Entries without a track sort after those with one, which only
// matters for an entry that mixes both, and that would be broken anyway.
function sortGroups(groups) {
  return groups.slice().sort(function (a, b) {
    const ta = a.track === null ? Infinity : a.track;
    const tb = b.track === null ? Infinity : b.track;
    if (ta !== tb) return ta - tb;
    return String(a.name).localeCompare(String(b.name));
  });
}

async function extract(url) {
  const id = idOf(url);
  if (!id) throw new Error("archive-org-adapter: URL does not match: " + url);

  const resp = await fetch(BASE + "/metadata/" + encodeURIComponent(id), {
    headers: { accept: "application/json" },
  });
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }
  if (!resp.ok || !data) {
    throw new Error("archive-org-adapter: the Internet Archive answers with HTTP " + resp.status);
  }
  // An unknown or withdrawn item answers 200 with an empty object rather
  // than an error -- measured on 14.08.2026.
  const metadata = data.metadata || {};
  if (!metadata.identifier && !Array.isArray(data.files)) {
    throw new Error(
      "The Internet Archive knows no item called \"" + id + "\". It may have been " +
        "withdrawn, or the address may point at something other than an item."
    );
  }

  const audio = (data.files || []).filter(isAudio);
  if (!audio.length) {
    throw new Error(
      "This item of the Internet Archive holds no audio -- only scans, text or video."
    );
  }

  const itemTitle = cleanText(metadata.title) || id;
  // "date" is what the item says about itself and is the better answer where
  // it is a whole day; on a Great 78 it is often the bare recording year,
  // which toIsoDate drops, and then "publicdate" -- the day it was put here
  // -- is what remains. Both are read from metadata that is already in hand;
  // no second request.
  const publishedAt = toIsoDate(metadata.date) || toIsoDate(metadata.publicdate);
  const artist = creatorOf(metadata) || null;
  const cover = BASE + "/services/img/" + encodeURIComponent(id);

  const groups = sortGroups(buildGroups(audio)).map(function (group) {
    const file = pickFile(group.members);
    return {
      title: groupTitle(group.members, baseName(group.name)),
      streamUrl: downloadUrl(id, file.name),
      seconds: groupLength(group.members),
    };
  });

  const single = groups.length === 1;
  return {
    title: itemTitle,
    sourceType: "archive-org",
    artist: artist,
    cover: cover,
    publishedAt: publishedAt,
    // One recording has a length; a queue has none -- each piece starts at
    // zero and the server moves on by itself, the same rule as for the
    // Concertzender and RaiPlay queues.
    duration: single ? groups[0].seconds : null,
    tracks: groups.map(function (g) {
      return { title: g.title, streamUrl: g.streamUrl, cover: cover };
    }),
    // A single recording needs no list repeating its own title back.
    tracklist: single
      ? []
      : groups.map(function (g) {
          return { artist: "", title: g.title, seconds: null, duration: g.seconds, link: url };
        }),
  };
}

module.exports = { match, extract };
