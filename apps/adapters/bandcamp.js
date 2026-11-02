"use strict";
const { parse } = require("node-html-parser");
const { fetchHtml, cleanText, toIsoDate } = require("./_shared");

const BANDCAMP_RADIO_RE = /^https?:\/\/(www\.)?bandcamp\.com\/radio(\?|$)/i;
const BANDCAMP_DAILY_RE = /^https?:\/\/daily\.bandcamp\.com\//i;
const BANDCAMP_ALBUM_RE = /^https?:\/\/(?!daily\.|www\.bandcamp\.com|bandcamp\.com)([a-z0-9-]+)\.bandcamp\.com\/album\//i;

function match(url) {
  return BANDCAMP_RADIO_RE.test(url) || BANDCAMP_DAILY_RE.test(url) || BANDCAMP_ALBUM_RE.test(url);
}

function coverUrl(imageId, size, prefix) {
  if (!imageId) return null;
  var padded = String(imageId).padStart(10, "0");
  return "https://f4.bcbits.com/img/" + (prefix || "") + padded + "_" + (size || "10") + ".jpg";
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

// ---------- 1) Bandcamp Radio ----------
// Confirmed with DevTools (2026-07-21): tracklist.{title,imageId,compiledTrack.streamUrl}
// and tracklist.tracks[].{title,artistName,timecode}. The one continuous
// compiledTrack file is played on purpose, NOT the individual track.streamUrl per
// track -- those carry a playLimit (three plays, say) and would lock after a few rounds.
async function extractRadio(url) {
  const parsed = new URL(url);
  const showId = parsed.searchParams.get("show");
  if (!showId) throw new Error("bandcamp-adapter (radio): no show parameter in the URL");

  const resp = await fetch("https://bandcamp.com/api/player/2/player_data_web", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_type: "radio", item_id: Number(showId) }),
  });
  if (!resp.ok) throw new Error("bandcamp-adapter (radio): HTTP " + resp.status);
  const data = await resp.json();

  const tl = data && data.tracklist;
  if (!tl || !tl.compiledTrack || !tl.compiledTrack.streamUrl) {
    throw new Error("bandcamp-adapter (radio): no compiledTrack.streamUrl in the API answer");
  }

  const title = tl.title || "Bandcamp Radio " + showId;
  const streamUrl = tl.compiledTrack.streamUrl;

  const rawTracks = Array.isArray(tl.tracks) ? tl.tracks : [];
  const tracklist = rawTracks.map((t) => ({
    artist: t.artistName || "",
    title: t.title || "",
    seconds: typeof t.timecode === "number" ? t.timecode : null,
  }));

  return {
    title,
    sourceType: "bandcamp-radio",
    cover: coverUrl(tl.imageId, "10"),
    tracks: [{ title, streamUrl }],
    tracklist,
  };
}

// ---------- 2) Bandcamp Daily Editorial ----------
// Confirmed with DevTools (2026-07-21): data-player-infos on #p-daily-article
// is an HTML-entity-encoded JSON array, one object per embedded album, each
// with a full tracklist including a signed audio_url["mp3-128"].
// Decided with the user: chain all albums in article order into one queue,
// which is what the NOW PLAYING behaviour on the page does.
//
// THAT audio_url IS NOT USED, and this is the whole point of the detour
// below. Measured on 16.08.2026 on "uncovering-obscure-records": all six
// albums of the article carried ONE AND THE SAME signature, stamped 953
// minutes earlier, and it stayed the same across two independent requests --
// the page itself was served fresh (x-cache MISS), so this is not our cache
// and no request of ours can shake it loose. Bandcamp freezes that block on
// its own side. ffmpeg got HTTP 410 Gone, and so did curl, which rules out
// the user agent as the cause. Restarting did not help because the second
// extraction fetched the same frozen block; skipping to the next track did
// not help because every track in the queue came out of it.
//
// The album page signs on request: measured in the same minute, ts = the
// second of the request and a second stamp exactly 24 hours later. So the
// address comes from there, and everything else -- title, artist, cover,
// order -- keeps coming from the article, which knows those better.
// A freshly signed address for one track, or "" if anything at all is in the
// way. Deliberately quiet where extractAlbum below shouts: there a missing
// data-tralbum means the request has failed, here it means one album of six
// falls back to the article's own address -- which may still be good on a
// young article, and is the better bet either way than dropping the track.
async function freshStreamUrl(albumUrl, trackId) {
  if (!albumUrl || !trackId) return "";
  try {
    const html = await fetchHtml(albumUrl);
    const scriptEl = parse(html, { lowerCaseTagName: false }).querySelector("script[data-tralbum]");
    const raw = scriptEl && scriptEl.getAttribute("data-tralbum");
    if (!raw) return "";
    const data = JSON.parse(decodeEntities(raw));
    const list = Array.isArray(data.trackinfo) ? data.trackinfo : [];
    // Both fields carry the same number on every album measured; matching
    // either way means a page that fills only one of them still works.
    const track = list.find(function (t) {
      return String(t.track_id) === String(trackId) || String(t.id) === String(trackId);
    });
    return (track && track.file && track.file["mp3-128"]) || "";
  } catch (e) {
    console.log("[bandcamp][daily] no fresh address from " + albumUrl + ": " + e.message);
    return "";
  }
}

async function extractDaily(url) {
  const html = await fetchHtml(url);
  const root = parse(html, { lowerCaseTagName: false });

  const articleEl = root.querySelector("#p-daily-article");
  if (!articleEl) throw new Error("bandcamp-adapter (daily): #p-daily-article not found");
  const raw = articleEl.getAttribute("data-player-infos");
  if (!raw) throw new Error("bandcamp-adapter (daily): data-player-infos attribute missing");

  let players;
  try {
    players = JSON.parse(decodeEntities(raw));
  } catch (e) {
    throw new Error("bandcamp-adapter (daily): data-player-infos is not valid JSON: " + e.message);
  }
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error("bandcamp-adapter (daily): no albums found in data-player-infos");
  }

  const titleTag = root.querySelector("article-title") || root.querySelector("title");
  const title = titleTag ? cleanText(titleTag.text) : "Bandcamp Daily";

  // player_id ("t220447789", say) marks the ONE track the article curates
  // per album -- tracklist[] is the complete album, there for listening on
  // in the mini player, not what the article itself features. Only that one
  // track per album goes into the queue.
  const picked = [];
  for (const player of players) {
    const list = Array.isArray(player.tracklist) ? player.tracklist : [];
    const featuredId = player.player_id && String(player.player_id).replace(/^t/, "");
    const featured = list.find((t) => String(t.track_id) === featuredId) || list[0];
    if (!featured) continue;
    const articleUrl = featured.audio_url && featured.audio_url["mp3-128"];
    if (!articleUrl) continue; // curated track not streamable itself -- skip the album
    // tralbum_url is the page of the album the curated track was lifted
    // from, confirmed against the field list on 2026-08-09. It can be
    // relative and is therefore resolved against band_url; if that fails,
    // better no link than a broken one.
    var albumUrl = null;
    try {
      if (player.tralbum_url) {
        albumUrl = new URL(player.tralbum_url, player.band_url || url).toString();
      }
    } catch (e) {
      albumUrl = null;
    }
    picked.push({ featured, articleUrl, albumUrl, trackId: featured.track_id });
  }
  if (picked.length === 0) throw new Error("bandcamp-adapter (daily): no streamable tracks found");

  // All album pages at once. Six requests in a row would add six round trips
  // to an extraction the app already waits on; side by side they cost one.
  const freshUrls = await Promise.all(
    picked.map((p) => freshStreamUrl(p.albumUrl, p.trackId))
  );
  const stale = freshUrls.filter((u) => !u).length;
  if (stale) {
    console.log(
      "[bandcamp][daily] " + stale + "/" + picked.length +
        " tracks fall back to the article's own address, which is usually the expired one"
    );
  }

  const tracks = picked.map((p, i) => ({
    title: p.featured.track_title || "",
    streamUrl: freshUrls[i] || p.articleUrl,
    cover: coverUrl(p.featured.art_id, "10", "a"),
  }));
  const tracklist = picked.map((p) => ({
    artist: p.featured.artist || "",
    title: p.featured.track_title || "",
    seconds: null,
    link: p.albumUrl,
  }));

  return {
    title,
    sourceType: "bandcamp-daily",
    cover: tracks.length ? tracks[0].cover : null,
    tracks,
    tracklist,
  };
}

// ---------- 3) Bandcamp album pages ----------
// Confirmed with DevTools (2026-07-21): script[data-tralbum] holds
// trackinfo[] with file["mp3-128"] (null where a track is locked). Only
// tracks that have a file are taken, the rest are skipped without a word.
async function extractAlbum(url) {
  const html = await fetchHtml(url);
  const root = parse(html, { lowerCaseTagName: false });

  const scriptEl = root.querySelector("script[data-tralbum]");
  if (!scriptEl) throw new Error("bandcamp-adapter (album): script[data-tralbum] not found");
  const raw = scriptEl.getAttribute("data-tralbum");
  if (!raw) throw new Error("bandcamp-adapter (album): data-tralbum attribute empty");

  let data;
  try {
    data = JSON.parse(decodeEntities(raw));
  } catch (e) {
    throw new Error("bandcamp-adapter (album): data-tralbum is not valid JSON: " + e.message);
  }

  const rawTracks = Array.isArray(data.trackinfo) ? data.trackinfo : [];
  const playable = rawTracks.filter((t) => t.file && t.file["mp3-128"]);
  if (playable.length === 0) {
    throw new Error("bandcamp-adapter (album): not a single track is streamable (fully locked or preorder)");
  }
  if (playable.length < rawTracks.length) {
    console.log(
      `[bandcamp][album] only ${playable.length}/${rawTracks.length} tracks streamable, the rest is skipped`
    );
  }

  const artist = (data.current && data.current.artist) || data.artist || "";
  const title = (data.current && data.current.title) || "Bandcamp Album";
  const artId = data.art_id || (data.current && data.current.art_id);
  const cover = coverUrl(artId, "10", "a");

  const tracks = playable.map((t) => ({ title: t.title || "", streamUrl: t.file["mp3-128"], cover }));
  // On an album page, the album page is the called URL itself.
  const tracklist = playable.map((t) => ({ artist, title: t.title || "", seconds: null, link: url }));

  return {
    title,
    sourceType: "bandcamp-album",
    // In data-tralbum, beside trackinfo -- seen in the field list on
    // 16.08.2026 while the Daily trap was being measured. Written as
    // "17 Aug 2026 00:00:00 GMT", which toIsoDate reads.
    publishedAt: toIsoDate(data.album_release_date),
    artist,
    cover,
    tracks,
    tracklist,
  };
}

async function extract(url) {
  if (BANDCAMP_RADIO_RE.test(url)) return extractRadio(url);
  if (BANDCAMP_DAILY_RE.test(url)) return extractDaily(url);
  if (BANDCAMP_ALBUM_RE.test(url)) return extractAlbum(url);
  throw new Error("bandcamp-adapter: URL matches no known pattern: " + url);
}

module.exports = { match, extract };
