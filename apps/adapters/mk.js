"use strict";
const { parse } = require("node-html-parser");
const { cleanText } = require("./_shared");

const ALLOWED_HOSTS = ["minnakikeru.com"];

function isHostAllowed(hostname) {
  var h = (hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some(function (allowed) { return h === allowed || h.endsWith("." + allowed); });
}

function match(url) {
  try {
    var parsed = new URL(url);
    return parsed.protocol === "https:" && isHostAllowed(parsed.hostname);
  } catch (e) {
    return false;
  }
}

function isAudioUrl(url) {
  if (!url) return false;
  if (/\.mp3(\?.*)?$/i.test(url)) return true;
  if (/\.m3u8(\?.*)?$/i.test(url)) return true;
  if (/\/stream\/\d+\/file(\?|$)/i.test(url)) return true;
  return false;
}

function resolveUrl(maybeRelative, baseUrl) {
  try { return new URL(maybeRelative, baseUrl).href; } catch (e) { return null; }
}

function findRow(el) {
  var node = el;
  while (node) {
    var tag = node.tagName ? node.tagName.toUpperCase() : "";
    if (tag === "TR" || tag === "LI") return node;
    node = node.parentNode;
  }
  return el.parentNode || el;
}

function pushTrack(results, seen, url, row) {
  if (!url || seen.has(url)) return;
  if (!isAudioUrl(url)) return;
  seen.add(url);
  var titleEl = row ? row.querySelector(".name") : null;
  var durEl = row ? row.querySelector(".time") : null;
  var title = titleEl ? cleanText(titleEl.text) : "";
  var dur = durEl ? cleanText(durEl.text) : "";
  if (!title) {
    var text = row ? cleanText(row.text) : "";
    var dm = text.match(/\b\d{1,2}:\d{2}(:\d{2})?\b/);
    dur = dur || (dm ? dm[0] : "");
    title = text.replace(dur, "").trim();
  }
  if (!title) {
    title = decodeURIComponent(url.split("/").pop().replace(/\.mp3.*/i, ""));
  }
  results.push({ title: title, streamUrl: url, duration: dur });
}

// Parsing logic ported one to one from mk-autoplay-pi/extract.js; only the
// return shape follows the new adapter schema (title/streamUrl instead of
// t/u, tracks instead of tracks with u/t/d).
function parsePlaylist(html, pageUrl) {
  var root = parse(html, { lowerCaseTagName: false });
  var results = [];
  var seen = new Set();

  root.querySelectorAll("audio[data-src]").forEach(function (audio) {
    pushTrack(results, seen, resolveUrl(audio.getAttribute("data-src"), pageUrl), findRow(audio));
  });
  root.querySelectorAll("audio[src]").forEach(function (audio) {
    pushTrack(results, seen, resolveUrl(audio.getAttribute("src"), pageUrl), findRow(audio));
  });
  root.querySelectorAll("audio source[src]").forEach(function (s) {
    pushTrack(results, seen, resolveUrl(s.getAttribute("src"), pageUrl), findRow(s));
  });
  root.querySelectorAll("a[href]").forEach(function (a) {
    var href = a.getAttribute("href");
    if (!href || !isAudioUrl(href)) return;
    pushTrack(results, seen, resolveUrl(href, pageUrl), findRow(a));
  });

  if (!results.length) return null;

  var h1 = root.querySelector("h1");
  var titleTag = root.querySelector("title");
  var album = h1 ? cleanText(h1.text) : titleTag ? cleanText(titleTag.text) : "";

  var artistEl = root.querySelector('dd.artist a[href*="/artist/"]') || root.querySelector('a[href*="/artist/"]');
  var artist = artistEl ? cleanText(artistEl.text) : "";

  var ogImg = root.querySelector('meta[property="og:image"]');
  var cover = ogImg ? ogImg.getAttribute("content") || "" : "";
  if (cover) {
    var resolvedCover = resolveUrl(cover, pageUrl);
    if (resolvedCover) cover = resolvedCover;
  }

  return { title: album, artist: artist, cover: cover, tracks: results };
}

async function extract(url) {
  if (!match(url)) throw new Error("mk-adapter: URL does not match: " + url);
  var resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoplayPi/1.0)" },
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  var finalHost = new URL(resp.url).hostname;
  if (!isHostAllowed(finalHost)) {
    throw new Error("Redirect to a domain that is not allowed: " + finalHost);
  }
  var html = await resp.text();
  var playlist = parsePlaylist(html, resp.url);
  if (!playlist) throw new Error("mk-adapter: no tracks (.mp3) found on this page");
  return {
    title: playlist.title,
    artist: playlist.artist,
    sourceType: "minnakikeru",
    cover: playlist.cover,
    tracks: playlist.tracks,
  };
}

module.exports = { match: match, extract: extract };
