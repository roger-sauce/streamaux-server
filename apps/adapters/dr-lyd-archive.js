"use strict";

// adapters/dr-lyd-archive.js
//
// Broadcasts from DR LYD (Danmarks Radio). One adapter for the whole
// service rather than one per station: every episode page has the same
// shape, /lyd/<station>/<series>/<season>/<episode>-<id>, so P2 and P8 Jazz
// are covered by the same file and any further DR station comes for free.
//
// Measured 12.08.2026: the audio is served worldwide, no country check
// (unlike the BBC, see KONTEXT-RADIO-ADAPTER.md 5.3). The assetlinks URL
// answers 302 into Akamai and ffprobe reads 4500 s off it.
//
// Two things about the page matter:
//
// 1. DO NOT scrape media URLs out of the HTML. Every episode page carries
//    the same 84 of them -- the live streams of all DR channels, for the
//    player's station list. Taking the first one would play P1 instead of
//    the recording. Everything real sits in the Next.js payload,
//    <script id="__NEXT_DATA__">, under props.pageProps.
//
// 2. indexPoints is the richest tracklist of any source here. Offsets in
//    milliseconds, a length per piece, and the people involved separated by
//    role -- composer, soloist, orchestra, conductor -- rather than run
//    together in one string as at the ARD or the ORF.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unsupported } = require("./_shared");

// An episode address ends in "-<long number>". That is what separates it
// from the station page (/lyd/p2), which is the livestream and belongs to
// the station adapters. A trailing "/00:01:45" occurs too -- the index
// points link to a moment that way; the episode is the same one.
const EPISODE_RE =
  /^https?:\/\/(?:www\.)?dr\.dk\/lyd\/[^?#]*-\d{6,}(?:\/\d{2}:\d{2}:\d{2})?\/?(?:[?#]|$)/i;
const TIME_TAIL_RE = /\/\d{2}:\d{2}:\d{2}\/?$/;

const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;

function match(url) {
  return EPISODE_RE.test(url);
}

// Highest bitrate that can simply be played. HLS is listed too (bitrate 0,
// target "Stream") and would work, but a progressive file can be seeked
// into with ffmpeg -ss without any playlist handling -- which is how the
// tracklist rows do their jumping.
function pickAsset(assets) {
  const progressive = (assets || []).filter(function (a) {
    return a && a.url && a.target === "Progressive";
  });
  if (progressive.length) {
    return progressive.reduce(function (best, a) {
      return !best || (a.bitrate || 0) > (best.bitrate || 0) ? a : best;
    }, null);
  }
  return (assets || []).find(function (a) { return a && a.url; }) || null;
}

// The roles are Danish and there may be several. The composer is the one
// that belongs in front of a classical piece; where there is none -- a jazz
// session, say -- the first named person is better than nothing.
function artistOf(indexPoint) {
  const roles = indexPoint.roles || [];
  const composer = roles.find(function (r) {
    return r && typeof r.role === "string" && /^komponist/i.test(r.role);
  });
  const pick = composer || roles.find(function (r) { return r && r.name; });
  return pick ? cleanText(pick.name) : "";
}

function buildTracklist(indexPoints) {
  return (indexPoints || [])
    .filter(function (p) { return p && p.title && typeof p.offsetMilliseconds === "number"; })
    .map(function (p) {
      return {
        artist: artistOf(p),
        title: cleanText(p.title),
        seconds: Math.round(p.offsetMilliseconds / 1000),
        duration:
          typeof p.durationMilliseconds === "number"
            ? Math.round(p.durationMilliseconds / 1000)
            : null,
        link: null,
      };
    });
}

async function extract(url) {
  if (!match(url)) throw new Error("dr-lyd-archive-adapter: URL does not match: " + url);

  // A link to a moment inside the broadcast still fetches the broadcast.
  const pageUrl = url.replace(TIME_TAIL_RE, "");
  const html = await fetchHtml(pageUrl);

  const payload = NEXT_DATA_RE.exec(html);
  if (!payload) {
    throw new Error(
      "dr-lyd-archive-adapter: no __NEXT_DATA__ in the page -- DR LYD has changed its build"
    );
  }
  let pageProps;
  try {
    pageProps = JSON.parse(payload[1]).props.pageProps;
  } catch (e) {
    throw new Error("dr-lyd-archive-adapter: __NEXT_DATA__ is not readable: " + e.message);
  }

  // Two refusals, and neither is a fault -- see unsupported() in _shared.js.
  // Converted 02.09.2026, on the sweep KONTEXT 5.6 asked for.
  //
  // The first one is the common case and it arrives by a specific route: the
  // collection stores DR's `presentationUrl`, and for a broadcast that has not
  // aired yet that is the SERIES page, not the episode. This adapter matches
  // it -- the pattern allows two segments as well as four -- and the honest
  // answer is that a series page is not a broadcast. It could just as well
  // have handed over the newest episode, which would play perfectly and be
  // the wrong concert; RTVE cost half a year that way.
  const episode = (pageProps && pageProps.episode) || null;
  if (!episode) {
    throw unsupported(
      "This page of DR LYD is a programme, not one broadcast. Share the concert " +
        "from the Konzertfuehrer, or open the episode itself. Its archive: " + pageUrl,
      pageUrl
    );
  }
  if (episode.isAvailableOnDemand === false) {
    throw unsupported(
      "DR has not released this broadcast for listening back. Its page: " + pageUrl,
      pageUrl
    );
  }

  const asset = pickAsset(episode.audioAssets);
  if (!asset) throw new Error("This broadcast of DR LYD carries no audio.");

  const title = cleanText(episode.title) || "DR LYD";
  const series = (episode.series && cleanText(episode.series.title)) || null;
  const duration =
    typeof episode.durationMilliseconds === "number"
      ? Math.round(episode.durationMilliseconds / 1000)
      : null;

  return {
    title: title,
    sourceType: "dr-lyd-archive",
    artist: series,
    // A finished file with a known length, straight from the payload -- no
    // ffprobe call needed, as with the OE1 broadcasts.
    duration: duration,
    tracks: [{ title: title, streamUrl: asset.url }],
    tracklist: buildTracklist(pageProps.indexPoints),
  };
}

module.exports = { match, extract };
