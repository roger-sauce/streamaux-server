"use strict";

// adapters/srf-archive.js
//
// Broadcasts from SRF. One adapter for the whole house: the address form
// belongs to the platform, not to a station, so SRF 1, 2 Kultur, 3 and
// Virus are all covered at once.
//
//   https://www.srf.ch/audio/<show>/<title>?id=<AUDI...>
//
// Everything comes out of ONE page fetch. The recording sits openly in the
// markup on download-media.srf.ch, and the path says /world/ -- the
// worldwide pool, as at NRK, so no country lock.
//
// The Integration Layer (il.srgssr.ch) is the SECOND way, used only where
// the first fails. It does not know the "AUDI..." id from the address bar
// (404 on both mediaComposition and byUrn, measured 14.08.2026); it knows
// the urn, and the urn appears on the page. That was read in August as a
// reason to leave the API alone -- a second call for data already in hand.
//
// Measured on 16.09.2026, that reasoning was half right and cost twelve
// broadcasts of thirteen. The recording is in the markup for SOME
// programmes and fetched by the player for others, and nothing about the
// address says which. `Jazz Collection` carried its mp3 in the HTML;
// `Concerto`, `Jazz in Concert`, `Im Konzertsaal` and `Klassik punkt CH`
// did not, and the page then looked to this adapter exactly like a page
// with no recording at all -- "This page of SRF carries no recording",
// said about a recording that was sitting there behind a URN.
//
// So: read the markup first, because it is free. Where it is empty, take
// the urn off the page and ask the Integration Layer.
//
// TRAP: the page carries a JSON payload, but HTML-ESCAPED, with &quot;
// instead of quotation marks. An expression like &quot;show&quot;:&quot;([^&]*)
// looks right and breaks at the first apostrophe or dash inside the value,
// because those are entities too. So each value is read up to the next
// &quot; and then put through unescapeHtml.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unescapeHtml, unsupported } = require("./_shared");

// An episode address has TWO path parts after /audio/, the livestream page
// only one ("radio-srf-2-kultur-live-hoeren") -- that is the whole
// separation, no guessing needed. The lookahead guards the case of
// something ever appearing below a live page.
const PAGE_RE =
  /^https?:\/\/(?:www\.)?srf\.ch\/audio\/(?![^/?#]*-live-hoeren(?:\/|$))[^/?#]+\/[^/?#]+/i;
const ASSET_ID_RE = /[?&]id=([A-Za-z0-9_-]+)/;
const MP3_RE = /https:\/\/download-media\.srf\.ch\/[^"'\s<>\\]+\.mp3/gi;

/* The urn of THE broadcast, among a page full of other urns.
 *
 * A programme page carries one `urn:srf:audio:<uuid>` -- the episode it is
 * showing -- beside a dozen `urn:srf:eawEpisode:AUDI...` for the other
 * instalments in the sidebar. Only the first kind leads to a recording, which
 * is why the pattern names it rather than matching `urn:` and hoping.
 *
 * Colons arrive escaped as %3A where the urn sits inside a nested JSON string,
 * so both spellings are read.
 */
const AUDIO_URN_RE =
  /urn(?::|%3A)srf(?::|%3A)audio(?::|%3A)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const IL_BASE = "https://il.srgssr.ch/integrationlayer/2.0/mediaComposition/byUrn/";

function match(url) {
  return PAGE_RE.test(url);
}

// Reads a field out of the page's JSON, in both spellings: escaped
// (&quot;show&quot;:&quot;...) as SRF writes it today, and plain, should
// that ever change.
function jsonField(html, name) {
  const escaped = new RegExp(
    "&quot;" + name + "&quot;\\s*:\\s*&quot;((?:(?!&quot;)[\\s\\S])*)&quot;",
    "i"
  );
  const plain = new RegExp('"' + name + '"\\s*:\\s*"([^"]*)"', "i");
  const hit = escaped.exec(html) || plain.exec(html);
  return hit ? cleanText(unescapeHtml(hit[1])) : "";
}

function jsonNumber(html, name) {
  const hit = new RegExp("(?:&quot;|\")" + name + "(?:&quot;|\")\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)", "i")
    .exec(html);
  return hit ? Number(hit[1]) : null;
}

function metaContent(html, property) {
  const hit = new RegExp(
    '<meta[^>]+property=["\']' + property + '["\'][^>]*content=["\']([^"\']*)["\']',
    "i"
  ).exec(html) ||
  new RegExp(
    '<meta[^>]+content=["\']([^"\']*)["\'][^>]*property=["\']' + property + '["\']',
    "i"
  ).exec(html);
  return hit ? cleanText(unescapeHtml(hit[1])) : "";
}

// "jazz-collection" -> "Jazz Collection". Last resort for the series, if
// neither show nor rubric stands in the page.
function showFromPath(url) {
  const hit = /\/audio\/([^/?#]+)\//i.exec(String(url || ""));
  if (!hit) return "";
  return hit[1]
    .split("-")
    .filter(Boolean)
    .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
    .join(" ");
}

// There was exactly one recording on the page measured, so picking by id is
// not strictly needed -- it is in anyway, because it costs nothing and
// holds if SRF ever lists further episodes beside the one asked for.
function pickAudio(html, url) {
  MP3_RE.lastIndex = 0;
  const found = [];
  let hit;
  while ((hit = MP3_RE.exec(html)) !== null) {
    if (found.indexOf(hit[0]) === -1) found.push(hit[0]);
  }
  if (!found.length) return null;
  const wanted = ASSET_ID_RE.exec(String(url || ""));
  if (wanted) {
    const byId = found.find(function (u) { return u.indexOf(wanted[1]) !== -1; });
    if (byId) return byId;
  }
  return found[0];
}

/* The recording by way of the Integration Layer.
 *
 * Returns the mp3 addresses it names, in the order it names them; the caller
 * puts them through the same choice the markup goes through, so the "?id="
 * from the address still decides where several are offered.
 *
 * A failure here is answered with an empty list rather than a throw: the
 * caller already has a truthful message for "no recording", and an API that is
 * down should not turn into a sentence about the broadcast.
 */
async function audioByUrn(html) {
  const hit = AUDIO_URN_RE.exec(String(html || ""));
  if (!hit) return { urls: [] };
  const urn = hit[0].replace(/%3A/gi, ":");
  try {
    const text = await fetchHtml(IL_BASE + urn + ".json", {
      headers: { Accept: "application/json" },
    });
    const found = [];
    let match2;
    MP3_RE.lastIndex = 0;
    while ((match2 = MP3_RE.exec(text)) !== null) {
      if (found.indexOf(match2[0]) === -1) found.push(match2[0]);
    }
    /* Why there is no file, in SRF's own words.
     *
     * Measured 16.09.2026 on "Im Konzertsaal" of 10.09: the Integration Layer
     * names no mp3 and says instead
     *
     *   blockReason:    GEOBLOCK
     *   playableAbroad: false
     *   validTo:        2026-10-10T20:00:00+02:00
     *
     * That is a better answer than "this page carries no recording", which is
     * what the adapter said about it for six days. The window is worth keeping
     * as well: after that date the recording is gone in Switzerland too.
     */
    const reason = /"blockReason"\s*:\s*"([^"]+)"/i.exec(text);
    const validTo = /"validTo"\s*:\s*"([^"]+)"/i.exec(text);
    return {
      urls: found,
      blockReason: reason ? reason[1] : null,
      expiresAt: validTo ? validTo[1] : null,
    };
  } catch (e) {
    return { urls: [] };
  }
}

async function extract(url) {
  if (!match(url)) throw new Error("srf-archive-adapter: URL does not match: " + url);

  const html = await fetchHtml(url);
  // The markup first -- it is free, and for some programmes it is all there is.
  let streamUrl = pickAudio(html, url);
  if (!streamUrl) {
    // Then the API. See the note at the top: which of the two answers is not a
    // property of the address, so both have to be tried before saying no.
    const fromApi = await audioByUrn(html);
    if (fromApi.urls.length) {
      const wanted = ASSET_ID_RE.exec(String(url || ""));
      const byId = wanted && fromApi.urls.find(function (u) {
        return u.indexOf(wanted[1]) !== -1;
      });
      streamUrl = byId || fromApi.urls[0];
    } else if (fromApi.blockReason) {
      // Declined rather than failed, and with the reason in fields as well as
      // in the sentence -- see unsupported() in _shared.js.
      throw unsupported(
        "SRF does not release this recording outside Switzerland (" +
          fromApi.blockReason + ").",
        url,
        {
          geoRestricted: /geo/i.test(fromApi.blockReason),
          blockReason: fromApi.blockReason,
          expiresAt: fromApi.expiresAt || null,
        }
      );
    }
  }
  if (!streamUrl) {
    throw new Error(
      "This page of SRF carries no recording, and its Integration Layer entry " +
        "names none either. Broadcast pages (srf.ch/audio/<show>/<title>?id=...) " +
        "usually do."
    );
  }

  // og:title hands the title over ready-made; the JSON field of the same
  // name writes the dash as an entity.
  const title = metaContent(html, "og:title") || jsonField(html, "title") || "SRF";
  const artist =
    jsonField(html, "show") || jsonField(html, "rubric") || showFromPath(url) || null;
  const cover = metaContent(html, "og:image") || null;
  // durationSeconds is there in seconds; duration in milliseconds, as at
  // RTVE and RTE. The seconds are taken, the milliseconds are the fallback.
  const seconds = jsonNumber(html, "durationSeconds");
  const milliseconds = jsonNumber(html, "duration");
  const duration =
    seconds && seconds > 0
      ? Math.round(seconds)
      : milliseconds && milliseconds > 0
        ? Math.round(milliseconds / 1000)
        : null;

  return {
    title: title,
    sourceType: "srf-archive",
    artist: artist,
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    // SRF gives no marks inside a broadcast.
    tracklist: [],
  };
}

module.exports = { match, extract };
