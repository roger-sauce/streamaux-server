"use strict";

// adapters/sr-archive.js
//
// Broadcasts from Sveriges Radio. One adapter for the whole house: the
// address form belongs to the platform, so P1 to P4 and every channel below
// them are covered at once.
//
// The WEBSITE is closed to us: www.sverigesradio.se answers a plain fetch
// with 403 from Akamai's edge ("errors.edgesuite.net"), and ordinary
// browser headers change nothing. Rebuilding a browser fingerprint to get
// past that is not something we do -- and it is not needed, because SR runs
// an open API meant for machines:
//
//   https://api.sr.se/api/v2/episodes/get?id=<number>&format=json
//
// No key, no sign-in, and it answers where the site refuses. So this
// adapter never knocks on the blocked host at all.
//
// TWO ENTRANCES, one data path:
//
//   /avsnitt/2788136                     the number, used directly
//   /avsnitt/sjostakovitjs-1a-cellokonsert   the name, resolved by search
//
// The second is the interesting one. The slug in the address is the
// BEGINNING of the title, slugified -- and SR DELETES punctuation rather
// than turning it into a separator, so "1:a" becomes "1a" and not "1-a".
// That cost the first attempt: a search for "sjostakovitjs 1a cellokonsert"
// finds nothing, because the title says "1:a". The digit words are exactly
// the ones that get in the way, so they are dropped from the query --
// "sjostakovitjs cellokonsert" then returns the one right episode.
//
// The search may miss. The CHECK may not: every candidate is measured
// against the slug character for character, and only a single surviving hit
// is handed out. A wrong broadcast cannot slip through; the worst case is
// no broadcast, and then the refusal names the numeric address, which needs
// no search.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText } = require("./_shared");

const API = "https://api.sr.se/api/v2/";
const EPISODE_RE = /^https?:\/\/(?:www\.)?sverigesradio\.se\/avsnitt\/([^/?#]+)/i;
const SEARCH_SIZE = 20;

function keyOf(url) {
  const hit = EPISODE_RE.exec(String(url || ""));
  return hit ? decodeURIComponent(hit[1]) : null;
}

function match(url) {
  return keyOf(url) !== null;
}

// Mirrors how SR builds the slug in its addresses. Punctuation is removed,
// not replaced -- see the note at the top. The Swedish letters are mapped
// by hand because NFD leaves a bare "a" for both a-ring and a-umlaut, which
// is what SR wants here, but "o" with umlaut has to be said explicitly.
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[:;'"‘’“”.,!?()\[\]]/g, "")
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[éè]/g, "e")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The query is built from the slug's own words. Words carrying a digit are
// left out: the address writes "1a" where the title says "1:a", so they
// match nothing and, joined by AND, take the whole query down with them.
function queryFor(slug) {
  const words = slug.split("-").filter(Boolean);
  const plain = words.filter(function (w) { return !/[0-9]/.test(w); });
  return (plain.length ? plain : words).join(" ");
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

async function resolveId(key) {
  if (/^[0-9]+$/.test(key)) return key;

  const answer = await getJson(
    API + "episodes/search?format=json&size=" + SEARCH_SIZE +
      "&query=" + encodeURIComponent(queryFor(key))
  );
  if (!answer.ok || !answer.json) {
    throw new Error("sr-archive-adapter: Sveriges Radio answers with HTTP " + answer.status);
  }
  const hits = (answer.json.episodes || []).filter(function (e) {
    return e && e.title && slugify(e.title).indexOf(key) === 0;
  });
  if (hits.length === 1) return String(hits[0].id);

  throw new Error(
    (hits.length
      ? "Several broadcasts of Sveriges Radio fit this address. "
      : "Sveriges Radio's search does not find this broadcast by its name. ") +
      "The numbered address works without a search -- open the broadcast and " +
      "paste sverigesradio.se/avsnitt/<number>."
  );
}

// listenpodfile is what the site plays; downloadpodfile held the same file
// in the broadcast measured, and stands here as the fallback.
function fileOf(episode) {
  const listen = episode.listenpodfile || {};
  const download = episode.downloadpodfile || {};
  return listen.url ? listen : download.url ? download : null;
}

async function extract(url) {
  const key = keyOf(url);
  if (!key) throw new Error("sr-archive-adapter: URL does not match: " + url);

  const id = await resolveId(key);
  const answer = await getJson(API + "episodes/get?format=json&id=" + encodeURIComponent(id));
  if (!answer.ok || !answer.json) {
    throw new Error("sr-archive-adapter: Sveriges Radio answers with HTTP " + answer.status);
  }
  const episode = answer.json.episode;
  if (!episode) {
    throw new Error("Sveriges Radio knows no broadcast under the number " + id + ".");
  }

  const file = fileOf(episode);
  if (!file) {
    throw new Error(
      "This broadcast of Sveriges Radio carries no recording -- it is listed, " +
        "but no audio file is given."
    );
  }

  const title = cleanText(episode.title) || cleanText(file.title) || "Sveriges Radio";
  const artist = cleanText((episode.program || {}).name) || null;
  const cover = cleanText(episode.imageurl) || cleanText(episode.imageurltemplate) || null;
  // Seconds, plainly. The first house in a while that does not need dividing.
  const duration = Number(file.duration) > 0 ? Math.round(Number(file.duration)) : null;

  return {
    title: title,
    sourceType: "sr-archive",
    artist: artist,
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: file.url, cover: cover }],
    // SR gives no marks inside a broadcast.
    tracklist: [],
  };
}

module.exports = { match, extract };
