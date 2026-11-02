"use strict";

// adapters/oe1-archive.js
//
// Archive broadcasts from OE1 (ORF). Two ways in, because OE1 keeps two
// different things behind two different hosts:
//
//   /programm/<YYYYMMDD>/<id>  the broadcast itself, kept for seven days,
//                              served from the loopstream file server
//   /artikel/<id>/<slug>       a curated clip that stays put -- the one
//                              measured on 12.08.2026 is from 2021
//
// The broadcast route is why this adapter exists. Its API hands out
// something no other source here does: every piece with interpreter,
// length and an absolute start time. Subtracting the start of the
// recording turns those into real offsets, so unlike the ARD Audiothek
// (see estimateOffsets in ard-audiothek.js) nothing has to be spread out
// by guesswork and nothing is marked "estimated".
//
// Measured 12.08.2026:
//   https://audioapi.orf.at/oe1/api/json/current/broadcast/841192/20260810
// The 5.0 version that sound.orf.at itself calls refuses this numeric id
// (404 in every shape tried, with and without items and _o) and appears to
// want a programKey instead -- hence the older path, which answers.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unescapeHtml } = require("./_shared");
const { probeDuration } = require("./direct-audio");

const BROADCAST_RE = /^https?:\/\/(?:www\.)?oe1\.orf\.at\/programm\/(\d{8})\/(\d+)/i;
const ARTICLE_RE = /^https?:\/\/(?:www\.)?oe1\.orf\.at\/artikel\/(\d+)/i;

const API = "https://audioapi.orf.at/oe1/api/json/current/broadcast/";

// The player URL exactly as sound.orf.at builds it, minus the RFC 6570
// placeholders it carries there ({&shoutcast}{&player}{&referer}{&userid}):
// those are for the browser player to fill in and left standing they break
// the URL. "offsetende" is left out too -- the file already ends where the
// broadcast ends (ffprobe: 3278.999 s against end-start = 3279000 ms), the
// parameter only matters for a broadcast still on air.
const LOOPSTREAM = "https://loopstream01.apa.at/?channel=oe1&id=";

// Only ever in the page source of an article, never in the rendered text:
// the clip sits on a different host from the broadcasts and outlives the
// seven days. Upper case in practice (.MP3), hence the /i.
const CLIP_RE = /https?:\/\/audioondemand\.sf\.apa\.at\/[^\s"'<>]+\.mp3/i;

function match(url) {
  return BROADCAST_RE.test(url) || ARTICLE_RE.test(url);
}

// The original is 1750 px wide -- a megabyte for a square on an iPad. Take
// the widest that stays under a thousand, and only fall back to the first
// entry if the API ever stops offering small ones.
function coverUrl(images) {
  const versions = (images && images[0] && images[0].versions) || [];
  const usable = versions
    .filter(function (v) { return v && v.path; })
    .sort(function (a, b) { return b.width - a.width; });
  const small = usable.filter(function (v) { return v.width <= 1000; });
  const pick = small.length ? small[0] : usable[0];
  return pick ? pick.path : null;
}

// originMs is the start of the recording, not of the broadcast: the file is
// what gets seeked into. Both coincide in the measured case, but a stream
// that started late would shift every offset.
function buildTracklist(items, originMs) {
  return (items || []).map(function (item) {
    const offset = Math.round((item.start - originMs) / 1000);
    return {
      artist: cleanText(item.interpreter),
      title: cleanText(item.title),
      // A piece announced before the recording began has no place in it --
      // no start time is better than a negative one.
      seconds: Number.isFinite(offset) && offset >= 0 ? offset : null,
      duration: typeof item.duration === "number" ? Math.round(item.duration / 1000) : null,
      link: null,
    };
  });
}

async function extractBroadcast(day, id) {
  const resp = await fetch(API + id + "/" + day, { headers: { accept: "application/json" } });
  if (!resp.ok) {
    throw new Error("oe1-archive-adapter: API answers with HTTP " + resp.status + " for " + id);
  }
  const body = await resp.json();
  const stream = (body.streams || [])[0];
  if (!stream || !stream.loopStreamId) {
    throw new Error(
      "This broadcast of OE1 cannot be listened back to. OE1 keeps its broadcasts " +
        "for seven days; after that only the programme description is left."
    );
  }

  const cover = coverUrl(body.images);
  const title = cleanText(body.title) || cleanText(body.programTitle) || "OE1";
  // From the recording, not from the schedule: a broadcast that started
  // late or ran long would otherwise carry a length its file does not have.
  const duration = Math.round((stream.end - stream.start) / 1000);

  return {
    title: title,
    sourceType: "oe1-archive",
    artist: cleanText(body.programTitle) || null,
    cover: cover,
    duration: duration > 0 ? duration : null,
    tracks: [{ title: title, streamUrl: LOOPSTREAM + stream.loopStreamId, cover: cover }],
    tracklist: buildTracklist(body.items, stream.start),
  };
}

async function extractArticle(url) {
  const html = await fetchHtml(url);
  const hit = CLIP_RE.exec(html);
  if (!hit) {
    throw new Error(
      "This page of OE1 carries no audio. Broadcasts to listen back to sit under " +
        "oe1.orf.at/programm/<date>/<id> and stay there for seven days."
    );
  }
  const streamUrl = hit[0];
  const titleHit = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title =
    (titleHit
      ? unescapeHtml(cleanText(titleHit[1])).replace(/\s*-\s*oe1\.ORF\.at\s*$/i, "")
      : "") || "OE1";
  // No length in the page and none in an API -- the clip is not a broadcast.
  // ffprobe is the only way to the progress bar here, and it stays quiet
  // when it is missing (see direct-audio.js).
  const duration = await probeDuration(streamUrl);

  return {
    title: title,
    sourceType: "oe1-archive",
    artist: "Ö1",
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl }],
    tracklist: [],
  };
}

async function extract(url) {
  const broadcast = BROADCAST_RE.exec(url);
  if (broadcast) return extractBroadcast(broadcast[1], broadcast[2]);
  const article = ARTICLE_RE.exec(url);
  if (article) return extractArticle(url);
  throw new Error("oe1-archive-adapter: URL does not match: " + url);
}

module.exports = { match, extract };
