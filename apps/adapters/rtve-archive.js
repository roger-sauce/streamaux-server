"use strict";

// adapters/rtve-archive.js
//
// Broadcasts from RTVE. One adapter for the whole house: the number at the
// end of the address is the key to everything, and it is the same number
// whichever of the three forms the site hands out --
//
//   https://rneaudio.rtve.es/a/17135188                       short link
//   https://www.rtve.es/a/17135188/                           short link
//   https://www.rtve.es/play/audios/solo-jazz/despedimos-...-29-06-26/17135188/
//
// -- and https://api.rtve.es/api/audios/<id>.json answers to it without a
// token or a sign-in. The recording itself is https://ztnr.rtve.es/ztnr/
// <id>.mp3, which the JSON also states outright under qualities[].filePath.
//
// TRAP, and the reason this adapter is fussy about what it matches: the
// live page of RNE Radio 3 has exactly the shape of a broadcast page,
// "play/audios/programa/rne-rne3-live/1712469/" being programme, title and
// number like any other. Since archive adapters sit ahead of their stations
// in the dispatcher, this one would swallow the livestream. Hence the
// exclusion of "programa/<...>-live/" below -- it belongs here and not in
// the station adapters, because it is this adapter that is too eager.
//
// SECOND TRAP: duration comes in MILLISECONDS. Every other house so far
// gave seconds or "mm:ss"; taken over unchecked, an hour of jazz becomes
// forty-one days.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText, unescapeHtml } = require("./_shared");

const API = "https://api.rtve.es/api/audios/";
const MEDIA = "https://ztnr.rtve.es/ztnr/";

const ID_RE =
  /^https?:\/\/(?:rneaudio\.)?(?:www\.)?rtve\.es\/a\/(\d+)|^https?:\/\/(?:www\.)?rtve\.es\/play\/audios\/(?!programa\/[^/]*-live(?:\/|$))[^/]+\/[^/]+\/(\d+)/i;

function idOf(url) {
  const hit = ID_RE.exec(String(url || ""));
  return hit ? hit[1] || hit[2] : null;
}

function match(url) {
  return idOf(url) !== null;
}

// RTVE writes the piece list into the description, always the same way:
//   COMPOSER: <em>Work</em> (m.ss). Performer.
// The <em> is what makes this readable at all -- the work is the only part
// the markup marks -- so the pieces are found by the tag and the composer
// is read backwards from there.
const PIECE_RE = /<em[^>]*>([\s\S]*?)<\/em>[\s\S]{0,12}?\((\d{1,3})[.,:](\d{1,2})\)/gi;

// Marks are added up from the piece lengths, because that is all the
// description gives. Announcements between the pieces are not counted, so
// the marks run ahead of the recording, further the longer it goes: the
// broadcast measured on 14.08.2026 was 59:32 long with 48:45 of music, ten
// minutes of talk the listener would otherwise hunt for. Hence the warning
// at the end of the list rather than a quiet, wrong number.
const DRIFT_WARNING =
  "Marks are added up from the piece lengths; announcements between the " +
  "pieces are not counted, so the further into the broadcast, the earlier " +
  "a mark sits against the real recording.";

function composerBefore(chunk) {
  const text = cleanText(unescapeHtml(String(chunk).replace(/<[^>]+>/g, " ")));
  // The performer of the previous piece ends the sentence before, so the
  // composer is whatever stands after the last full stop.
  const parts = text.split(".").map(function (p) { return p.trim(); }).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  return last.endsWith(":") ? cleanText(last.slice(0, -1)) : "";
}

function parseDescription(html, link) {
  const source = String(html || "");
  const rows = [];
  let cursor = 0;
  let offset = 0;
  let hit;
  PIECE_RE.lastIndex = 0;
  while ((hit = PIECE_RE.exec(source)) !== null) {
    const title = cleanText(unescapeHtml(hit[1]));
    const seconds = Number(hit[2]) * 60 + Number(hit[3]);
    if (title) {
      rows.push({
        artist: composerBefore(source.slice(cursor, hit.index)),
        title: title,
        seconds: offset,
        duration: seconds,
        link: link,
      });
      offset += seconds;
    }
    cursor = PIECE_RE.lastIndex;
  }
  // No pieces, no warning: an empty list needs no caveat.
  if (rows.length) {
    rows.push({ artist: "", title: DRIFT_WARNING, seconds: null, duration: null, link: link });
  }
  return rows;
}

// qualities[] is sorted by nothing in particular, and a broadcast may carry
// several presets. Take the best one that names a file.
function pickQuality(qualities) {
  return (Array.isArray(qualities) ? qualities : [])
    .filter(function (q) { return q && q.filePath; })
    .reduce(function (best, q) {
      return !best || (Number(q.bitRate) || 0) > (Number(best.bitRate) || 0) ? q : best;
    }, null);
}

function coverOf(item) {
  const previews = item.previews || {};
  return (
    cleanText(previews.square) ||
    cleanText(previews.horizontal) ||
    cleanText(item.thumbnail) ||
    cleanText(item.imageSEO) ||
    null
  );
}

async function extract(url) {
  const id = idOf(url);
  if (!id) throw new Error("rtve-archive-adapter: URL does not match: " + url);

  const resp = await fetch(API + id + ".json", { headers: { accept: "application/json" } });
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }
  if (!resp.ok || !data) {
    throw new Error("rtve-archive-adapter: RTVE answers with HTTP " + resp.status);
  }

  const item = ((data.page || {}).items || [])[0];
  if (!item) {
    throw new Error(
      "RTVE knows no audio under the number " + id + ". Broadcast pages " +
        "(rtve.es/play/audios/...) and their short links (rneaudio.rtve.es/a/...) have one."
    );
  }

  const title = cleanText(unescapeHtml(item.title)) ||
    cleanText(unescapeHtml(item.longTitle)) ||
    "RTVE";
  // The programme rather than the station -- "Solo jazz" says more to the
  // listener than "Radio Clasica", which the station adapters already say.
  const artist = cleanText(unescapeHtml((item.programInfo || {}).title)) || null;
  const cover = coverOf(item);
  const quality = pickQuality(item.qualities);
  // The JSON states the file outright; the convention below is the fallback
  // for the day a broadcast arrives without a qualities entry.
  const streamUrl = (quality && quality.filePath) || MEDIA + id + ".mp3";
  // Milliseconds -- see the second trap at the top of this file.
  const milliseconds = Number(item.duration) || Number(quality && quality.duration) || 0;
  const duration = milliseconds > 0 ? Math.round(milliseconds / 1000) : null;

  return {
    title: title,
    sourceType: "rtve-archive",
    artist: artist,
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    tracklist: parseDescription(item.description, cleanText(item.htmlUrl) || url),
    /* What RTVE says about the recording's life and its reach.
     *
     * Added 16.09.2026, and it was a plain oversight: `rtve-series.js` has
     * read these two out of the SAME endpoint since 31.08 (see extrasOf
     * there), while this file -- which fetches api.rtve.es/api/audios/<id>.json
     * itself -- dropped them. One house, one payload, two adapters, and only
     * one of them looked.
     *
     * The cost was measurable: the Fila cero question stayed open for days
     * because nothing in the record said what RTVE had stated outright. Note
     * the caution that came out of it, and that is why `geoRestricted` is
     * carried but never believed on its own: `geolocalizado` is FALSE for
     * every Fila cero edition, and every one of them is refused at the CDN
     * from Berlin. A true here is a true statement; a false says nothing.
     */
    expiresAt: item.expirationDate || null,
    geoRestricted: !!item.geolocalizado,
  };
}

module.exports = { match, extract };
