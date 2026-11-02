"use strict";

// adapters/vrt-archive.js
//
// Broadcasts from VRT MAX. One adapter for the whole house, so Klara and
// any other VRT radio station share it.
//
// Four steps, worked out on 12.08.2026, and only one of them needs the
// account:
//
//   1. the page path  -> GraphQL (public, anonymous)     -> streamId
//   2. VRT_USERNAME/PASSWORD via _vrt-session.js         -> identityToken
//   3. POST .../v2/tokens with it                        -> vrtPlayerToken
//   4. GET .../media-items/<streamId>?vrtPlayerToken=..  -> targetUrls -> HLS
//
// Step 1 is the pleasant surprise: www.vrt.be/vrtnu-api/graphql/public/v1
// answers the EpisodePage query without any header but the client name, and
// hands out player.modes[].streamId, which is exactly the
// "pbs-pub-<uuid>$aud-<uuid>" the media aggregator wants. The same id also
// sits in mediaTrackingData as a JSON string inside a JSON string; streamId
// is the clean way to it.
//
// Step 3 is where the account is unavoidable. With an anonymous token the
// aggregator answers {"code":"CONTENT_REQUIRES_AUTHENTICATION"} -- VRT
// releases broadcasts to signed-in accounts only. Not a country lock: the
// player token is issued for the whole EEA, and the CDN URL that comes out
// at the end carries no token at all and says "nodrm".
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { cleanText } = require("./_shared");
const vrtSession = require("./_vrt-session");

// An episode page carries a "~<id>" in its last segment
// (.../all-that-jazz~31-76/all-that-jazz~31-31868-0/). The channel pages
// (/vrtmax/livestream/audio/klara, /vrtmax/kanalen/klara) do not, which is
// what keeps them with the station adapters.
const EPISODE_RE = /^https?:\/\/(?:www\.)?vrt\.be\/vrtmax\/luister\/[^?#]*~[^/?#]+\/?(?:[?#]|$)/i;

const GRAPHQL = "https://www.vrt.be/vrtnu-api/graphql/public/v1";
const TOKENS = "https://media-services-public.vrt.be/vualto-video-aggregator-web/rest/external/v2/tokens";
const MEDIA_ITEMS = "https://media-services-public.vrt.be/media-aggregator/v2/media-items/";
const CLIENT = "vrtnu-web@PROD";

// Two queries rather than one, and deliberately not the site's own: theirs
// pulls in twenty fragments for a page we never render, and every field in
// it is a field that can change under us.
//
// The rich one also asks for the cover and the tracking blob; the small one
// asks for nothing but what playing requires. If VRT ever refuses a field
// in the rich query, the adapter drops to the small one and still plays --
// the broadcast matters, the cover does not.
const QUERY_RICH =
  "query EpisodePage($pageId: ID!) { page(id: $pageId) { __typename " +
  "... on PlaybackPage { title player { title image { templateUrl } " +
  "modes { streamId mediaTrackingData { data } } } } } }";
const QUERY_MIN =
  "query EpisodePage($pageId: ID!) { page(id: $pageId) { __typename " +
  "... on PlaybackPage { title player { modes { streamId } } } } }";

// The episode's own name lives nowhere but in a tracking blob: a JSON
// string inside the JSON answer, with keys like $mena (name with date),
// $prcb (channel) and $prna (programme). page.title carries only the
// series, which for a weekly programme is the same string every week --
// "All That Jazz" for the edition of the 8th and of the 15th alike.
function trackingOf(mode) {
  const raw = mode && mode.mediaTrackingData && mode.mediaTrackingData.data;
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function channelName(tracking) {
  const slug = cleanText(tracking.$prcb);
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function match(url) {
  return EPISODE_RE.test(url);
}

// The pageId is the path, without the query: the site sends "?ndl=true"
// along, but the answer is the same without it, and a share link full of
// utm_* parameters would otherwise be a different page every time.
function pageIdOf(url) {
  const parsed = new URL(url);
  return parsed.pathname.endsWith("/") ? parsed.pathname : parsed.pathname + "/";
}

async function postJson(url, body, headers) {
  const resp = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json", accept: "application/json" }, headers || {}),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // fall through, the caller reports the status
  }
  return { ok: resp.ok, status: resp.status, json: json, text: text };
}

async function askGraphql(url, query) {
  const answer = await postJson(
    GRAPHQL,
    { operationName: "EpisodePage", variables: { pageId: pageIdOf(url) }, query: query },
    { "x-vrt-client-name": "WEB" }
  );
  if (!answer.ok || !answer.json) {
    throw new Error("vrt-archive-adapter: GraphQL answers with HTTP " + answer.status);
  }
  const page = answer.json.data && answer.json.data.page;
  const modes = (page && page.player && page.player.modes) || [];
  const mode = modes.find(function (m) { return m && m.streamId; });
  return { page: page, mode: mode };
}

async function episodeFor(url) {
  let found = await askGraphql(url, QUERY_RICH).catch(function () { return { page: null, mode: null }; });
  if (!found.mode) found = await askGraphql(url, QUERY_MIN);
  if (!found.mode) {
    throw new Error(
      "This page of VRT MAX holds no broadcast. Episode pages " +
        "(vrt.be/vrtmax/luister/...) do."
    );
  }
  const page = found.page || {};
  const player = page.player || {};
  const tracking = trackingOf(found.mode);
  return {
    streamId: found.mode.streamId,
    // The name with the date if it is there, the series otherwise -- never
    // nothing.
    title: cleanText(tracking.$mena) || cleanText(page.title) || cleanText(player.title),
    // The station, not the series: the series would repeat the title.
    artist: channelName(tracking),
    cover: (player.image && cleanText(player.image.templateUrl)) || null,
  };
}

async function playerToken() {
  const identity = await vrtSession.identityToken();
  const answer = await postJson(TOKENS, { identityToken: identity });
  const token = answer.json && answer.json.vrtPlayerToken;
  if (!token) {
    throw new Error("vrt-archive-adapter: no player token, the token service answered HTTP " + answer.status);
  }
  // An anonymous token would come back with authenticated false and the
  // aggregator would refuse the broadcast a step later with a message that
  // says nothing about why. Better to say it here.
  if (answer.json.authenticated === false) {
    throw new Error(
      "vrt-archive-adapter: VRT issued an anonymous token -- the sign-in did not take. " +
        "Check VRT_USERNAME and VRT_PASSWORD."
    );
  }
  return token;
}

// The aggregator lists several formats. HLS is the one ffmpeg and AVPlayer
// both take without help; the DASH variant would need more from both.
function pickHls(targetUrls) {
  const list = targetUrls || [];
  return (
    list.find(function (t) { return t && t.url && /^hls$/i.test(String(t.type)); }) ||
    list.find(function (t) { return t && t.url && /hls/i.test(String(t.type)); }) ||
    list.find(function (t) { return t && t.url && /\.m3u8(\?|$)/i.test(t.url); }) ||
    null
  );
}

async function mediaItem(streamId, token) {
  const url =
    MEDIA_ITEMS + encodeURIComponent(streamId) +
    "?client=" + encodeURIComponent(CLIENT) + "&vrtPlayerToken=" + encodeURIComponent(token);
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // handled below
  }
  if (json && json.code === "CONTENT_REQUIRES_AUTHENTICATION") {
    throw new Error(
      "VRT MAX releases this broadcast to signed-in accounts only, and the account " +
        "in use is not being accepted for it."
    );
  }
  if (!resp.ok || !json) {
    throw new Error("vrt-archive-adapter: media aggregator answers with HTTP " + resp.status);
  }
  return json;
}

async function extract(url) {
  if (!match(url)) throw new Error("vrt-archive-adapter: URL does not match: " + url);

  const found = await episodeFor(url);
  const item = await mediaItem(found.streamId, await playerToken());

  const target = pickHls(item.targetUrls);
  if (!target) throw new Error("vrt-archive-adapter: no HLS variant among the target URLs");

  const title = found.title || cleanText(item.title) || "VRT MAX";
  const duration =
    typeof item.duration === "number" && item.duration > 0 ? Math.round(item.duration / 1000) : null;

  return {
    title: title,
    sourceType: "vrt-archive",
    artist: found.artist || cleanText(item.programName) || null,
    cover: found.cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: target.url, cover: found.cover }],
    // VRT does list the music played, but on the page and without offsets.
    tracklist: [],
  };
}

module.exports = { match, extract };
