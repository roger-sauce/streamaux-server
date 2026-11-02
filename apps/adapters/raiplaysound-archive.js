"use strict";

// adapters/raiplaysound-archive.js
//
// Broadcasts from RaiPlay Sound. One adapter for the whole house: the
// address form belongs to the platform, not to a station -- the episode
// measured on 13.08.2026 came from Rai Radio Techete, not from Radio 3.
//
// Two shapes, and RaiPlay hands both over the same way: append ".json" to
// the page address and the page's own data comes back. No API to find, no
// token, no sign-in.
//
//   /audio/<year>/<month>/<title>-<uuid>.html   one broadcast, one file
//   /playlist/<name>                            several, as a queue
//
// The audio always sits behind mediapolisvod.rai.it/relinker/..., which
// redirects to the actual file. Hand out the relinker address and never the
// resolved one -- the same rule as for dispatcher.rndfnk.com and VRT's
// icecast entry; ffmpeg follows the redirect by itself.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText } = require("./_shared");

const BASE = "https://www.raiplaysound.it";
const EPISODE_RE = /^https?:\/\/(?:www\.)?raiplaysound\.it\/audio\/[^?#]+\.html/i;
const PLAYLIST_RE = /^https?:\/\/(?:www\.)?raiplaysound\.it\/playlist\/[^/?#]+/i;

function match(url) {
  return EPISODE_RE.test(url) || PLAYLIST_RE.test(url);
}

// The data address is the page address with ".json" -- for an episode in
// place of ".html", for a playlist appended.
function jsonUrlFor(url) {
  const clean = url.split(/[?#]/)[0].replace(/\/$/, "");
  return clean.endsWith(".html") ? clean.replace(/\.html$/i, ".json") : clean + ".json";
}

async function getJson(url) {
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  const text = await resp.text();
  try {
    return { ok: resp.ok, status: resp.status, json: JSON.parse(text) };
  } catch (e) {
    return { ok: false, status: resp.status, json: null };
  }
}

// "00:46:25" and "46:25" both occur, depending on the field.
function parseClock(text) {
  const parts = String(text || "").trim().split(":").map(Number);
  if (!parts.length || parts.some(function (n) { return !Number.isFinite(n); })) return null;
  const seconds = parts.reduce(function (total, n) { return total * 60 + n; }, 0);
  return seconds > 0 ? seconds : null;
}

// Pictures are given as paths, not addresses.
function imageUrl(path) {
  const value = cleanText(path);
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : BASE + value;
}

async function extractEpisode(url) {
  const answer = await getJson(jsonUrlFor(url));
  if (!answer.ok || !answer.json) {
    throw new Error("raiplaysound-archive-adapter: RaiPlay answers with HTTP " + answer.status);
  }
  const data = answer.json;
  const audio = data.audio || {};
  if (!audio.url) {
    throw new Error(
      "This page of RaiPlay Sound carries no recording. Broadcast pages " +
        "(raiplaysound.it/audio/<year>/<month>/<title>.html) do."
    );
  }

  const title = cleanText(data.title) || cleanText(audio.title) || "RaiPlay Sound";
  // The station rather than the programme: the programme name is usually
  // the first half of the title already.
  const artist =
    cleanText(data.channel && data.channel.name) ||
    cleanText(data.program && data.program.name) ||
    null;
  const cover = imageUrl(data.image || audio.poster);

  return {
    title: title,
    sourceType: "raiplaysound-archive",
    artist: artist,
    cover: cover,
    duration: parseClock(audio.duration) || parseClock(data.duration_small_format),
    tracks: [{ title: title, streamUrl: audio.url, cover: cover }],
    tracklist: [],
  };
}

// A card either carries the recording directly or keeps it under "audio",
// the same shape an episode page uses. Read both rather than betting on
// one: the difference cost a run on 13.08.2026.
function audioOf(card) {
  const nested = (card && card.audio) || {};
  return {
    url: (card && card.url) || nested.url || null,
    title: cleanText((card && card.title) || nested.title),
    duration: (card && card.duration) || nested.duration || null,
    poster: (card && card.poster) || nested.poster || null,
  };
}

async function extractPlaylist(url) {
  const answer = await getJson(jsonUrlFor(url));
  if (!answer.ok || !answer.json) {
    throw new Error("raiplaysound-archive-adapter: RaiPlay answers with HTTP " + answer.status);
  }
  const data = answer.json;
  const cards = ((data.block || {}).cards || [])
    .map(audioOf)
    .filter(function (c) { return c.url; });
  if (!cards.length) {
    throw new Error("This playlist of RaiPlay Sound holds no recordings.");
  }

  const info = data.podcast_info || {};
  const title = cleanText(data.title) || cleanText(info.title) || "RaiPlay Sound";
  const cover = imageUrl(info.poster || (cards[0] && cards[0].poster));

  // A queue, built like a Bandcamp album: no overall length, because there
  // is none -- each piece starts at zero and the server moves on by itself.
  const tracks = cards.map(function (card) {
    return { title: card.title || title, streamUrl: card.url, cover: imageUrl(card.poster) || cover };
  });
  return {
    title: title,
    sourceType: "raiplaysound-archive",
    // The programme behind the playlist -- "Lezioni di musica" for the Bach
    // sonatas -- which the platform keeps in the subtitle.
    artist: cleanText(info.subtitle) || cleanText(info.title) || null,
    cover: cover,
    tracks: tracks,
    tracklist: tracks.map(function (track, i) {
      return {
        artist: "",
        title: track.title,
        // A queue has no offsets; the length of each piece is known, though.
        seconds: null,
        duration: parseClock(cards[i].duration),
        link: url,
      };
    }),
  };
}

async function extract(url) {
  if (EPISODE_RE.test(url)) return extractEpisode(url);
  if (PLAYLIST_RE.test(url)) return extractPlaylist(url);
  throw new Error("raiplaysound-archive-adapter: URL does not match: " + url);
}

module.exports = { match, extract };
