"use strict";

const { fetchHtml, cleanText } = require("./_shared");

// Paths that are not track pages but would happen to fit the /user/slug
// pattern -- excluded on purpose.
const EXCLUDED_PATH_RE = /^\/(you|discover|stream|search|charts|people|upload|backstage|pro|mobile|jobs|legal|imprint)(\/|$)/i;

function match(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  if (!/^(www\.)?soundcloud\.com$/i.test(u.hostname)) return false;
  if (EXCLUDED_PATH_RE.test(u.pathname)) return false;
  const parts = u.pathname.split("/").filter(Boolean);
  return parts.length >= 2;
}

// Confirmed with DevTools (2026-07-22): every soundcloud.com page embeds
// the full track JSON server-side in window.__sc_hydration -- no Playwright
// needed to get at title, artist, cover and transcodings.
function parseHydration(html) {
  const m = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// The client_id rotates now and then and sits in one of the
// a-v2.sndcdn.com/assets/*.js bundles that every soundcloud.com page loads
// (confirmed with DevTools 2026-07-22, bundle "55-..." in that test).
// Worked out once per process and kept.
let cachedClientId = null;

async function discoverClientId(html) {
  const scriptUrls = Array.from(
    html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)
  ).map((m) => m[1]);
  for (const scriptUrl of scriptUrls) {
    try {
      const resp = await fetch(scriptUrl);
      if (!resp.ok) continue;
      const js = await resp.text();
      const m = js.match(/client_id:"([0-9a-zA-Z_-]{20,40})"/);
      if (m) return m[1];
    } catch (e) {
      // try the next bundle
    }
  }
  return null;
}

async function getClientId(html) {
  if (cachedClientId) return cachedClientId;
  const id = await discoverClientId(html);
  if (!id) throw new Error("soundcloud-adapter: client_id found in no asset bundle");
  cachedClientId = id;
  return id;
}

// Sorts transcodings by preference: non-legacy before legacy, HLS before
// progressive. Confirmed in practice (2026-07-22): on some tracks the
// "legacy" progressive variant answers 404 when the media is resolved,
// while the current HLS transcodings work reliably. ffmpeg and Safari play
// HLS without trouble anyway.
function rankTranscodings(transcodings) {
  if (!Array.isArray(transcodings)) return [];
  return transcodings
    // cbc-encrypted-hls and ctr-encrypted-hls are DRM encrypted (confirmed
    // in practice 2026-07-22, "Media failed to decode") -- without a licence
    // server never playable for us, so excluded entirely.
    .filter((t) => t.format && t.url && (t.format.protocol === "hls" || t.format.protocol === "progressive"))
    .slice()
    .sort((a, b) => {
      const aLegacy = a.is_legacy_transcoding ? 1 : 0;
      const bLegacy = b.is_legacy_transcoding ? 1 : 0;
      if (aLegacy !== bLegacy) return aLegacy - bLegacy;
      const aHls = a.format.protocol === "hls" ? 0 : 1;
      const bHls = b.format.protocol === "hls" ? 0 : 1;
      return aHls - bHls;
    });
}

// Tries the transcodings one after another until one resolves -- protects
// against the odd 404 on certain, mostly legacy, presets. On some tracks,
// presumably newer ones, the listed legacy hls and progressive entries are
// nothing but dead records (404, confirmed in practice 2026-07-22 even WITH
// a valid SoundCloud login, so not an authentication problem). The only
// variants left are then encrypted with real DRM (licenseAuthToken is a JWE
// licence token, a FairPlay-like licence exchange) -- implementing that
// would mean circumventing DRM and is deliberately not built, hence a clear
// error message.
async function resolveAnyStreamUrl(html, transcodings) {
  const ranked = rankTranscodings(transcodings);
  const hasEncrypted =
    Array.isArray(transcodings) && transcodings.some((t) => t.format && /encrypted/i.test(t.format.protocol || ""));
  if (ranked.length === 0) {
    if (hasEncrypted) throw new Error("soundcloud-adapter: not playable because of DRM");
    return null;
  }
  let lastError = null;
  for (const t of ranked) {
    try {
      return await resolveStreamUrlWithRetry(html, t);
    } catch (e) {
      lastError = e;
    }
  }
  if (hasEncrypted) throw new Error("soundcloud-adapter: not playable because of DRM");
  throw lastError || new Error("soundcloud-adapter: no transcoding could be resolved");
}

async function resolveStreamUrl(transcodingUrl, clientId) {
  const sep = transcodingUrl.includes("?") ? "&" : "?";
  const resp = await fetch(transcodingUrl + sep + "client_id=" + clientId);
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status + " while resolving the media " + transcodingUrl);
    /** @type {any} */ (err).status = resp.status;
    throw err;
  }
  const data = await resp.json();
  if (!data || !data.url) throw new Error("soundcloud-adapter: no url in the media answer");
  return data.url;
}

async function resolveStreamUrlWithRetry(html, transcoding) {
  let clientId = await getClientId(html);
  try {
    return await resolveStreamUrl(transcoding.url, clientId);
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      cachedClientId = null;
      clientId = await getClientId(html);
      return await resolveStreamUrl(transcoding.url, clientId);
    }
    throw e;
  }
}

// artwork_url comes as "-large" (100x100) by default -- scaled up to
// "-t500x500", the official SoundCloud size suffix.
function upscaleArtwork(url) {
  if (!url) return null;
  return url.replace(/-large\.(jpg|png)$/i, "-t500x500.$1");
}

async function extract(url) {
  if (!match(url)) throw new Error("soundcloud-adapter: URL does not match: " + url);

  const html = await fetchHtml(url);
  const hydration = parseHydration(html);
  if (!hydration) throw new Error("soundcloud-adapter: window.__sc_hydration not found");

  const soundEntry = hydration.find((h) => h.hydratable === "sound");
  const playlistEntry = hydration.find((h) => h.hydratable === "playlist");
  if (playlistEntry && playlistEntry.data) {
    return extractSet(playlistEntry.data, html);
  }
  if (!soundEntry || !soundEntry.data) {
    throw new Error("soundcloud-adapter: neither track nor set found on this page");
  }
  const sound = soundEntry.data;

  const streamUrl = await resolveAnyStreamUrl(html, sound.media && sound.media.transcodings);
  if (!streamUrl) throw new Error("soundcloud-adapter: no transcodings found");

  const title = cleanText(sound.title || "");
  const artist = sound.user ? cleanText(sound.user.username || "") : "";

  return {
    title,
    artist,
    sourceType: "soundcloud",
    cover: upscaleArtwork(sound.artwork_url),
    tracks: [{ title, streamUrl }],
    tracklist: [{ artist, title, seconds: null }],
  };
}

// Sets and playlists: for small sets the embedded hydration often already
// holds every track in full (confirmed with DevTools 2026-07-22 on a
// two-track set), for larger ones often only stubs without "media" for the
// later tracks. If any track turns up without "media", reload the whole
// thing once through the representation=full endpoint, which works
// anonymously, instead of guessing track by track which ones are missing.
async function extractSet(playlist, html) {
  let tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  if (tracks.some((t) => !t.media)) {
    const clientId = await getClientId(html);
    try {
      const resp = await fetch(
        `https://api-v2.soundcloud.com/playlists/${playlist.id}?representation=full&client_id=${clientId}`,
        { headers: { accept: "application/json" } }
      );
      if (resp.ok) {
        const full = await resp.json();
        if (Array.isArray(full.tracks)) tracks = full.tracks;
      }
    } catch (e) {
      // The fallback fails -- work with what the hydration already had.
    }
  }

  const playlistArtist = playlist.user ? cleanText(playlist.user.username || "") : "";
  const outTracks = [];
  const outTracklist = [];
  for (const t of tracks) {
    let streamUrl;
    try {
      streamUrl = await resolveAnyStreamUrl(html, t.media && t.media.transcodings);
    } catch (e) {
      // A single track is not playable (DRM, say) -- do not discard the
      // whole set over it, just skip this track.
      console.log(`[soundcloud][set] track "${t.title || t.id}" skipped: ${e.message}`);
      continue;
    }
    if (!streamUrl) continue; // stub or no usable transcoding -- skip
    const title = cleanText(t.title || "");
    const artist = t.user ? cleanText(t.user.username || "") : playlistArtist;
    const cover = upscaleArtwork(t.artwork_url || playlist.artwork_url);
    outTracks.push({ title, streamUrl, cover });
    outTracklist.push({ artist, title, seconds: null });
  }
  if (outTracks.length === 0) throw new Error("soundcloud-adapter: no streamable tracks found in the set");

  return {
    title: cleanText(playlist.title || ""),
    artist: playlistArtist,
    sourceType: "soundcloud",
    cover: upscaleArtwork(playlist.artwork_url),
    tracks: outTracks,
    tracklist: outTracklist,
  };
}

module.exports = { match, extract };
