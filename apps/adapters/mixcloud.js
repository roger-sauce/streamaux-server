"use strict";

// adapters/mixcloud.js
//
// Mixcloud shows pasted as their own address. Until 14.08.2026 there was
// machinery for Mixcloud but no way in: _mixcloud.js could pull the stream
// out of a page, and only wire.js used it, for thewire.co.uk articles with
// an embedded player. A plain mixcloud.com address matched nothing.
//
// Two sources, and each gives what the other does not:
//
//   api.mixcloud.com/<uploader>/<show>/   title, uploader, length, cover.
//                                         One call, no key, no sign-in.
//   the page, through Playwright          the stream, which the API
//                                         deliberately does not hand out.
//
// WHY THE API AND NOT THE PAGE: og:title carries the uploader appended to
// the title, separated by " by " -- and a show measured on 14.08.2026 is
// called "VA SPIRITS HIGH ABOVE IX a spiritual world jazz breaks mixtape by
// Tom Wieland free soul inc", so the separator stands inside the title as
// well. Splitting at the last one would work here and break on the day an
// uploader has a "by" in their name. The API's "name" field needs no
// splitting at all.
//
// TRACKLIST: Mixcloud has a "sections" field for one, and it was EMPTY on
// both shows measured -- so the shape of a filled one is unverified. It is
// read defensively: anything that does not yield a title falls out, and
// what remains of an unknown shape is nothing, which lands on the same
// placeholder as no sections at all. Never an invented mark.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, toIsoDate } = require("./_shared");
const { extractMixcloudStream } = require("./_mixcloud");

const API = "https://api.mixcloud.com";
const SHOW_RE = /^https?:\/\/(?:www\.)?mixcloud\.com\/([^/?#]+)\/([^/?#]+)\/?/i;

// Two path parts alone do not make a show: an uploader's own subpages have
// the same shape, and so do Mixcloud's own sections.
const NOT_A_SHOW = new Set([
  "uploads", "favorites", "listens", "playlists", "following", "followers",
  "stream", "reposts", "live", "select", "shows",
]);
const NOT_AN_UPLOADER = new Set([
  "discover", "search", "upload", "settings", "dashboard", "categories",
  "genres", "tags", "select", "live", "browse", "signup", "login",
]);

function keyOf(url) {
  const hit = SHOW_RE.exec(String(url || ""));
  if (!hit) return null;
  const uploader = decodeURIComponent(hit[1]);
  const show = decodeURIComponent(hit[2]);
  if (NOT_AN_UPLOADER.has(uploader.toLowerCase())) return null;
  if (NOT_A_SHOW.has(show.toLowerCase())) return null;
  return { uploader: uploader, show: show, path: "/" + hit[1] + "/" + hit[2] + "/" };
}

function match(url) {
  return keyOf(url) !== null;
}

// Largest first; a show that carries only the small sizes still gets a
// picture rather than none.
const PICTURE_ORDER = [
  "1024wx1024h", "extra_large", "large", "320wx320h", "medium",
  "medium_mobile", "thumbnail", "small",
];

function pictureOf(pictures) {
  const all = pictures || {};
  for (let i = 0; i < PICTURE_ORDER.length; i++) {
    const url = cleanText(all[PICTURE_ORDER[i]]);
    if (url) return url;
  }
  return null;
}

// A section may name a track or a chapter, and the field names differ
// between the two. Read every spelling that could carry a name; an entry
// that yields none is dropped rather than listed empty.
function sectionRow(section, link) {
  if (!section || typeof section !== "object") return null;
  const track = section.track || {};
  const artistOf = track.artist || section.artist || {};
  const title =
    cleanText(track.name) ||
    cleanText(section.chapter) ||
    cleanText(section.section_name) ||
    cleanText(section.name);
  if (!title) return null;
  const start = Number(section.start_time);
  return {
    artist: cleanText(artistOf.name) || cleanText(section.artist_name) || "",
    title: title,
    seconds: Number.isFinite(start) && start >= 0 ? Math.round(start) : null,
    link: link,
  };
}

const NO_TRACKLIST = [{ artist: "", title: "no tracklist found", seconds: null }];

function tracklistOf(data, link) {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const rows = sections
    .map(function (s) { return sectionRow(s, link); })
    .filter(Boolean);
  return rows.length ? rows : NO_TRACKLIST;
}

async function extract(url) {
  const key = keyOf(url);
  if (!key) throw new Error("mixcloud-adapter: URL does not match: " + url);

  const answer = await fetch(API + key.path, { headers: { accept: "application/json" } });
  const text = await answer.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }
  if (!answer.ok || !data || data.error) {
    throw new Error(
      answer.status === 404
        ? "Mixcloud knows no show at this address."
        : "mixcloud-adapter: Mixcloud answers with HTTP " + answer.status
    );
  }

  const title = cleanText(data.name) || key.show;
  const artist = cleanText((data.user || {}).name) || cleanText(key.uploader) || null;
  const cover = pictureOf(data.pictures);
  const seconds = Number(data.audio_length);
  const duration = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  // The address the API states, not the one that was pasted: it is the
  // canonical one, and Playwright should open that.
  const pageUrl = cleanText(data.url) || "https://www.mixcloud.com" + key.path;

  // Playwright, and only for this: the API gives everything else.
  const streamUrl = await extractMixcloudStream(pageUrl);

  return {
    title: title,
    sourceType: "mixcloud",
    // Beside audio_length and pictures in the same answer. Read if it is
    // there and silently skipped if not -- worth no request of its own.
    publishedAt: toIsoDate(data.created_time),
    artist: artist,
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    tracklist: tracklistOf(data, pageUrl),
  };
}

module.exports = { match, extract };
