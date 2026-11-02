"use strict";

// adapters/radiofrance-archive.js
//
// Broadcasts from Radio France. One adapter for the whole house rather than
// one per station: France Musique, France Inter and the rest address an
// episode the same way, /<station>/podcasts/<emission>/<titre>-<id>.
//
// The page itself is a trap. Measured 12.08.2026 on a Concert du soir
// episode: three media URLs sit in the HTML -- the episode and two
// neighbours, dated 03.08.2026, 23.04.2026 and 23.11.2025. Taking the first
// would have played the right one that day and the wrong one on the next.
// The schema.org markup (<script type="application/ld+json">) carries
// exactly one: an AudioObject with contentUrl, and the length beside it as
// an ISO 8601 duration. So we ask the markup instead of guessing.
//
// The graph is walked generically rather than along fixed field paths: the
// audio is whichever node carries a contentUrl, the series whichever node
// says RadioSeries. Radio France rearranges that graph from time to time,
// and a walk survives what a path does not.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, parseIsoDuration, unsupported } = require("./_shared");

// An episode address ends in "-<long number>". That is what separates it
// from the station page (/franceinter), which is the livestream and belongs
// to the station adapters.
// Radio France answers under two names for the same page. The konzert-guide
// stores the station's own domain,
//
//   francemusique.fr/francemusique/podcasts/le-concert-du-soir/…-6525661
//
// while this adapter knew only radiofrance.fr and therefore claimed nothing at
// all -- not even enough to refuse with a hint. The page is the same document
// under both names and carries the radiofrance.fr address as its canonical, so
// the station domains are simply added here.
//
// Listed rather than matched loosely: `[a-z]+\.fr` would also take in every
// other French site, and the station adapters below rely on this one being
// exact about what it claims.
const HOUSE = "(?:radiofrance|francemusique|franceinter|franceculture|francebleu|fip|mouv)\\.fr";
const EPISODE_RE = new RegExp("^https?://(?:www\\.)?" + HOUSE + "/[^?#]*-\\d{6,}(?:/|\\?|#|$)", "i");
const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const AUDIO_URL_RE = /\.(m4a|mp3|aac)(\?|$)/i;

function match(url) {
  return EPISODE_RE.test(url);
}

// Every object in the document, whatever its nesting -- @graph, arrays,
// objects inside objects. Cheaper than knowing the shape.
function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) {
    node.forEach(function (n) { flatten(n, out); });
  } else if (node && typeof node === "object") {
    out.push(node);
    Object.keys(node).forEach(function (k) { flatten(node[k], out); });
  }
  return out;
}

function typesOf(node) {
  const t = node["@type"];
  return Array.isArray(t) ? t : t ? [t] : [];
}

function readGraph(html) {
  const nodes = [];
  let hit;
  LD_JSON_RE.lastIndex = 0;
  while ((hit = LD_JSON_RE.exec(html)) !== null) {
    try {
      flatten(JSON.parse(hit[1]), nodes);
    } catch (e) {
      // A broken block is not a reason to give up on the others.
    }
  }
  return nodes;
}

async function extract(url) {
  if (!match(url)) throw new Error("radiofrance-archive-adapter: URL does not match: " + url);

  const html = await fetchHtml(url);
  const nodes = readGraph(html);
  if (!nodes.length) {
    throw new Error(
      "radiofrance-archive-adapter: no schema.org markup in the page -- Radio France has changed its build"
    );
  }

  const audio = nodes.find(function (n) {
    return typeof n.contentUrl === "string" && AUDIO_URL_RE.test(n.contentUrl);
  });
  if (!audio) {
    // A decline and not a failure: the page was fetched, the markup parsed,
    // there is simply no recording ON it. Measured on 02.09.2026 -- three
    // broadcasts still days in the future were counted as failures, and the
    // old wording pointed at the episode-page shape the address already had,
    // which reads as an accusation of using the wrong address.
    //
    // The page goes along as sourceUrl, because it is the honest place to look:
    // if the recording appears later, it appears there.
    throw unsupported(
      "Radio France shows this page but no recording on it. Either the " +
        "broadcast has not aired yet, or none was published.",
      url
    );
  }

  const page = nodes.find(function (n) { return typesOf(n).indexOf("WebPage") >= 0; }) || {};
  const article = nodes.find(function (n) { return typesOf(n).indexOf("NewsArticle") >= 0; }) || {};
  const series = nodes.find(function (n) { return typesOf(n).indexOf("RadioSeries") >= 0; }) || {};

  const title =
    cleanText(page.name) || cleanText(article.headline) || cleanText(audio.name) || "Radio France";
  const duration = parseIsoDuration(audio.duration) || parseIsoDuration(article.duration);
  const cover =
    (article.image && cleanText(article.image.url)) ||
    (page.image && cleanText(page.image.url)) ||
    null;

  return {
    title: title,
    sourceType: "radiofrance-archive",
    artist: cleanText(series.name) || null,
    duration: duration,
    tracks: [{ title: title, streamUrl: audio.contentUrl, cover: cover }],
    cover: cover,
    // Radio France does list the works played, but in prose on the page and
    // not in the markup, and without times. Nothing invented here.
    tracklist: [],
  };
}

module.exports = { match, extract };
