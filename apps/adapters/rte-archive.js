"use strict";

// adapters/rte-archive.js
//
// Broadcasts from RTE (Ireland). One adapter for the whole house: 2fm and
// Lyric FM use the same address form, and so does every other RTE radio
// station.
//
//   https://www.rte.ie/radio/<station>/<series>/episodes/<uuid>/
//
// The uuid at the end goes unchanged into
// https://www.rte.ie/rteavgen/getplaylist/?id=<uuid>, which answers without
// a token, without a sign-in, and -- measured on 14.08.2026 -- without
// cookies or a referer, which the Pi has neither of.
//
// RTE does not host its recordings itself: they sit on Omny Studio
// (traffic.omny.fm, the Triton Digital platform). The player fetches a
// signed, session-bound address with a timestamp in it; getplaylist gives
// out the PLAIN one instead --
//   https://traffic.omny.fm/d/clips/<org>/<series>/<episode>/audio.mp3
// -- which answers 206 audio/mpeg on its own. So there is nothing to build
// here and, unlike Mixcloud and SoundCloud, nothing that expires.
//
// The API states x-country-code in its own answer -- it knows where the
// request comes from and hands the address out anyway. No geoblocking,
// unlike the BBC.
//
// TRAP: duration comes in MILLISECONDS, as at RTVE. Taken over unchecked,
// a 35-minute broadcast becomes 24 days.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText, unescapeHtml, toIsoDate } = require("./_shared");

const API = "https://www.rte.ie/rteavgen/getplaylist/?id=";
const EPISODE_RE =
  /^https?:\/\/(?:www\.)?rte\.ie\/radio\/[^/?#]+\/[^/?#]+\/episodes\/([0-9a-fA-F-]{36})/i;

function idOf(url) {
  const hit = EPISODE_RE.exec(String(url || ""));
  return hit ? hit[1] : null;
}

function match(url) {
  return idOf(url) !== null;
}

function text(value) {
  return cleanText(unescapeHtml(value));
}

// Milliseconds -- see the trap at the top of this file.
function seconds(milliseconds) {
  const value = Number(milliseconds) || 0;
  return value > 0 ? Math.round(value / 1000) : null;
}

// valid_end was null in both broadcasts measured, but the field exists, so
// a broadcast whose time has run out gets a plain answer rather than a
// stream address that leads nowhere.
function expired(show) {
  const end = show && show.valid_end;
  if (!end) return false;
  const stamp = Date.parse(end);
  return Number.isFinite(stamp) && stamp < Date.now();
}

async function extract(url) {
  const id = idOf(url);
  if (!id) throw new Error("rte-archive-adapter: URL does not match: " + url);

  const resp = await fetch(API + id, { headers: { accept: "application/json" } });
  const body = await resp.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    data = null;
  }
  if (!resp.ok || !data) {
    throw new Error("rte-archive-adapter: RTE answers with HTTP " + resp.status);
  }

  const shows = Array.isArray(data.shows) ? data.shows : [];
  // "shows" is an array, so it is read as one: should a broadcast ever come
  // in several parts, they become a queue instead of the first one quietly
  // standing for all of them.
  const playable = shows.filter(function (s) {
    return s && s.url && (!s.medium || String(s.medium).toLowerCase() === "audio");
  });

  if (!playable.length) {
    if (shows.some(expired)) {
      throw new Error("This broadcast of RTE is no longer available for listening back.");
    }
    if (shows.length) {
      throw new Error(
        "RTE holds no audio recording under this address -- the entry names " +
          "the medium \"" + text(shows[0].medium) + "\"."
      );
    }
    throw new Error(
      "RTE knows no broadcast under the number " + id + ". An episode page " +
        "(rte.ie/radio/<station>/<series>/episodes/<uuid>/) has one."
    );
  }
  if (playable.every(expired)) {
    throw new Error("This broadcast of RTE is no longer available for listening back.");
  }

  const first = playable[0];
  // The title carries the date ("Suaimhneas - 8 August 2026"), so it is kept
  // whole; the series goes into the artist, as everywhere else here.
  const title = text(first.title) || text(first.ptitle) || "RTE";
  const artist = text(first.series) || text(first.channel) || null;
  const cover = cleanText(first.thumbnail) || null;

  const tracks = playable.map(function (show) {
    return {
      title: text(show.title) || text(show.ptitle) || title,
      streamUrl: show.url,
      cover: cleanText(show.thumbnail) || cover,
    };
  });

  return {
    title: title,
    sourceType: "rte-archive",
    artist: artist,
    cover: cover,
    // Beside valid_end, which expired() above already reads, so the field is
    // in the answer either way -- and where it is not, the row simply shows
    // no date. RTE writes the day into the title as well ("Suaimhneas -
    // 8 August 2026"), so this may read twice on the screen; that is the
    // title's doing and not worth cutting words out of it for.
    publishedAt: toIsoDate(first.valid_start),
    // One recording has a length; a queue has none -- the same rule as for
    // the Concertzender and RaiPlay queues.
    duration: tracks.length === 1 ? seconds(first.duration) : null,
    tracks: tracks,
    // RTE gives no marks inside a broadcast. For a queue the list at least
    // shows what is coming; for a single recording it stays empty rather
    // than repeating the title back.
    tracklist:
      tracks.length > 1
        ? tracks.map(function (track, i) {
            return {
              artist: "",
              title: track.title,
              seconds: null,
              duration: seconds(playable[i].duration),
              link: url,
            };
          })
        : [],
  };
}

module.exports = { match, extract };
