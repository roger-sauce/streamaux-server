"use strict";

// adapters/nrk-archive.js
//
// Broadcasts from NRK Radio. One adapter for the whole house: P2 and every
// other NRK channel address an episode the same way, and the programme id
// stands at the end of it.
//
//   radio.nrk.no/serie/shoegaze-spesial/IKUL22090126
//                                       |
//   psapi.nrk.no/playback/manifest/program/IKUL22090126  -> HLS
//   psapi.nrk.no/playback/metadata/program/IKUL22090126  -> title, cover, length
//
// Two calls, no token, no sign-in. Measured 13.08.2026: playability
// "playable", the stream sits on nrk-od-world-*.akamaized.net -- the world
// pool, not the Norwegian one -- and answers from Germany.
//
// The web pages themselves are useless here: radio.nrk.no refuses anything
// that is not a browser (403). psapi answers plainly, which is why this
// adapter never touches the page it was given beyond reading the id out of
// its address.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText, parseIsoDuration, unsupported } = require("./_shared");

// The id is the last segment and looks like IKUL22090126: letters, then
// digits. The live pages (/direkte/p2) have no such segment, which is what
// keeps them with the station adapters.
const EPISODE_RE =
  /^https?:\/\/(?:www\.)?radio\.nrk\.no\/(?:serie|podkast|program)\/[^?#]*\/([a-zA-Z]{2,8}\d{6,12})\/?(?:[?#]|$)/;

const MANIFEST = "https://psapi.nrk.no/playback/manifest/program/";
const METADATA = "https://psapi.nrk.no/playback/metadata/program/";
// A third address, and the only one that knows what was played: the catalog
// carries "playlist" (the music, with the performer in "description") and
// "indexPoints" (the chapters). The web page shows both interleaved under
// "Tidspunkter", and so does this adapter.
const CATALOG = "https://psapi.nrk.no/radio/catalog/programs/";

function match(url) {
  return EPISODE_RE.test(url);
}

async function getJson(url) {
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // reported by the caller together with the status
  }
  return { ok: resp.ok, status: resp.status, json: json };
}

// The manifest names its assets in a list; take the first playlist among
// them. Searched rather than addressed by a fixed path, because NRK has
// moved this around before and a search survives that.
function hlsFrom(manifest) {
  const assets = (manifest && manifest.playable && manifest.playable.assets) || [];
  const hit =
    assets.find(function (a) { return a && a.url && /\.m3u8(\?|$)/i.test(a.url); }) ||
    assets.find(function (a) { return a && a.url; });
  return hit ? hit.url : null;
}

// Widest picture that stays under 1000 px: the app shows it as a square,
// and the 1920 px original is a megabyte for nothing.
function coverFrom(metadata) {
  const images =
    (metadata && metadata.preplay && metadata.preplay.poster && metadata.preplay.poster.images) || [];
  const usable = images
    .filter(function (i) { return i && i.url; })
    .sort(function (a, b) { return (b.pixelWidth || 0) - (a.pixelWidth || 0); });
  const small = usable.filter(function (i) { return (i.pixelWidth || 0) <= 1000; });
  const pick = small.length ? small[0] : usable[0];
  return pick ? pick.url : null;
}

// parseIsoDuration reports null for a zero-length string, which is right
// for a length but wrong for an offset: the first chapter may well start at
// PT0S. Zero is therefore recognised here and not in the shared helper,
// where a duration of nothing really is nothing.
function offsetOf(text) {
  const seconds = parseIsoDuration(text);
  if (seconds !== null) return seconds;
  return /^PT?0*(?:[.,]0+)?S?$/i.test(String(text || "").trim()) ? 0 : null;
}

// Music and chapters into one list, in the order they were heard. The
// performer of a piece sits in "description", which reads oddly but is
// where NRK keeps it; a chapter has no performer and gets none invented.
function buildTracklist(catalog) {
  const entries = [];
  ((catalog && catalog.playlist) || []).forEach(function (item) {
    const seconds = offsetOf(item && item.startPoint);
    if (!item || !item.title || seconds === null) return;
    entries.push({
      artist: cleanText(item.description),
      title: cleanText(item.title),
      seconds: seconds,
      duration: parseIsoDuration(item.duration),
      link: null,
    });
  });
  ((catalog && catalog.indexPoints) || []).forEach(function (item) {
    const seconds = offsetOf(item && item.startPoint);
    if (!item || !item.title || seconds === null) return;
    entries.push({
      artist: "",
      title: cleanText(item.title),
      seconds: seconds,
      duration: null,
      link: null,
    });
  });
  return entries.sort(function (a, b) { return a.seconds - b.seconds; });
}

async function extract(url) {
  const hit = EPISODE_RE.exec(url);
  if (!hit) throw new Error("nrk-archive-adapter: URL does not match: " + url);
  const id = hit[1].toUpperCase();

  const manifest = await getJson(MANIFEST + id);
  if (!manifest.ok || !manifest.json) {
    throw new Error("nrk-archive-adapter: psapi answers with HTTP " + manifest.status + " for " + id);
  }
  // NRK says outright why something will not play -- a rights window that
  // has closed, a programme not released outside Norway. Passing that on
  // beats a stream that fails a minute later.
  if (manifest.json.playability && manifest.json.playability !== "playable") {
    const reason =
      (manifest.json.nonPlayable && cleanText(manifest.json.nonPlayable.reason)) ||
      cleanText(manifest.json.playability);
    /* Declined, not failed -- and with the reason in fields since 16.09.2026.
     *
     * NRK has always said WHY; the sentence went into the record and the fact
     * did not, so the archive could not tell a rights window from a broken
     * adapter. `nonPlayable.reason` is NRK's own word ("geoBlocked",
     * "rightsUnavailable", "programNotAvailable") and is kept verbatim.
     *
     * Also a `throw new Error` until today, which counted as a FAILURE in
     * every run summary. A station saying "not outside Norway" has answered
     * correctly -- the same distinction RNE's twenty-one refusals forced on
     * 31.08.2026.
     */
    throw unsupported(
      "NRK does not release this broadcast for playing here (" + reason + ").",
      url,
      {
        geoRestricted: /geo/i.test(reason),
        blockReason: reason,
        expiresAt: (manifest.json.usageRights && manifest.json.usageRights.to &&
                    manifest.json.usageRights.to.date) || null,
      }
    );
  }

  const streamUrl = hlsFrom(manifest.json);
  if (!streamUrl) throw new Error("nrk-archive-adapter: no playable asset in the manifest for " + id);

  // Metadata is a comfort, not a condition: without it the broadcast still
  // plays, only namelessly.
  let title = "";
  let series = null;
  let cover = null;
  let duration = parseIsoDuration(manifest.json.duration);
  const meta = await getJson(METADATA + id).catch(function () { return { ok: false }; });
  if (meta.ok && meta.json) {
    const preplay = meta.json.preplay || {};
    const titles = preplay.titles || {};
    title = cleanText(titles.title);
    // The subtitle is the episode within the series -- worth having when
    // the series name alone would be the same string every week.
    const subtitle = cleanText(titles.subtitle);
    if (subtitle && subtitle !== title) title = title + " - " + subtitle;
    // psapi carries no readable series name -- "series" holds an id and a
    // season, nothing else, and there is no channel field at all. So the
    // house stands there instead of an empty line, the same as with
    // Concertzender and Polskie Radio.
    series = cleanText(meta.json.series && meta.json.series.title) || null;
    cover = coverFrom(meta.json);
    duration = duration || parseIsoDuration(meta.json.duration);
  }
  if (!title) title = "NRK " + id;

  // The catalog is the third call and the most dispensable: without it the
  // broadcast plays, only without the list of what is in it.
  let tracklist = [];
  const catalog = await getJson(CATALOG + id).catch(function () { return { ok: false }; });
  if (catalog.ok && catalog.json) tracklist = buildTracklist(catalog.json);

  return {
    title: title,
    sourceType: "nrk-archive",
    artist: series || "NRK",
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    tracklist: tracklist,
  };
}

module.exports = { match, extract };
