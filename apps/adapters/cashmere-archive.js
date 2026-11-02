"use strict";

// adapters/cashmere-archive.js
//
// Cashmere Radio (Berlin, Lichtenberg) keeps its archive on Mixcloud, and the
// episode page says so in plain sight -- twice. So this adapter does no
// browser work of its own: one fetch, two regular expressions, and the
// existing _mixcloud.js takes it from there. The same shape as
// concertzender-archive.js, not the Playwright shape of nts.js.
//
// HOW IT WAS FOUND, 30.09.2026, and the detour is worth recording because the
// first two answers were both wrong:
//
//   1. The page's own XHR to /api/live/?stream=30046 looked like the playback
//      call and is not: it answers {"isLive":false,...,"url":"","name":"Past
//      Forward #117 with Louis Largo"} -- the name of whatever is on air right
//      now, not of the episode being read. It is the poll that decides whether
//      the player offers the livestream or the recording.
//   2. The audio request is no XHR at all but a media request, and it goes to
//      aod.mixcloud.stream with origin player-widget.mixcloud.com. That is
//      what named Mixcloud as the host.
//
// TWO SOURCES FOR THE SAME ADDRESS, and the order took a measurement to get
// right. Against the live page on 30.09.2026, 159417 bytes:
//
//   the JSON     "episodeMixcloudLink":"https://mixcloud.com/CashmereRadio/..."
//   the iframe   .../widget/iframe/?...&feed=%2FCashmereRadio%2F<slug>%2F
//
// THE IFRAME IS NOT IN THE DELIVERED HTML. It is in the DevTools DOM, and
// that is what misled the first draft of this file: React builds the player
// after the page has loaded, so a plain fetch never sees it -- indexOf
// ("widget/iframe") answers -1. The only static source is the JSON in
// __NEXT_DATA__, an artefact of Next.js' pages router that would be gone the
// day the site moves to the app router.
//
// Hence the JSON first, the iframe kept behind it against the day the player
// is server-rendered, and the SELECTOR_DRIFT warning on the JSON going
// missing rather than on the iframe: a warning that fires on every call
// teaches nobody anything.
//
// WHAT IS DELIBERATELY NOT DONE: building the address. It would be derivable
// -- the Mixcloud slug is the Cashmere slug plus the date, and acf.episodeDate
// stands in the same response. But the two date formats run against each other
// (20260929 there, -29092026 in the slug), and a built address breaks silently
// the day a title is transliterated differently. It is written out; read it.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist }>

const { fetchHtml, cleanText, unescapeHtml, unsupported } = require("./_shared");
const { extractMixcloudStream } = require("./_mixcloud");

const EPISODE_RE = /^https?:\/\/(?:www\.)?cashmereradio\.com\/episode\/[^/?#]+/i;

// The address in __NEXT_DATA__, under the episode's ACF fields. The one
// source a fetch can see.
const ACF_LINK_RE = /"episodeMixcloudLink"\s*:\s*"([^"]+)"/i;

// The player's own iframe, for the day it is server-rendered. `feed` is the
// Mixcloud path, percent-encoded. The separator is written [?&;] because an
// ampersand inside an attribute arrives as &amp; -- then the character in
// front of `feed` is a semicolon and a plain [?&] would miss it.
const WIDGET_FEED_RE = /mixcloud\.com\/widget\/iframe\/[^"']*[?&;]feed=([^"'&]+)/i;

const OG_TITLE_RE = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/* The tracklist sits under a heading that reads "Playlist", as bare text
 * separated by <br>, one line per track:
 *
 *     <h2 class="css-szaf2w">Playlist</h2>
 *     * Fatima Miranda - Canto Largo
 *     <br>
 *      * Le Mystere Des Voix Bulgares - Kalimankou Denkou
 *
 * ANCHORED ON THE HEADING TEXT, NOT ON THE CLASS. Those class names are
 * generated React atoms (css-szaf2w, css-1mosoun) and change with any build --
 * _mixcloud.js carries the same warning about Mixcloud's own markup, and it is
 * the reason its play button is found by aria-label instead.
 */
const PLAYLIST_RE = /<h2[^>]*>\s*Playlist\s*<\/h2>([\s\S]*?)<\/article>/i;

// Artist and title, separated by an en dash with spaces around it. Em dash and
// a plain hyphen are accepted too: the lines are typed by the show hosts, and
// three of the ten episodes measured on 30.09.2026 used a different dash.
const DASH_RE = /\s+[\u2013\u2014-]\s+/;

function match(url) {
  return EPISODE_RE.test(url);
}

function stripTags(html) {
  return unescapeHtml(String(html).replace(/<[^>]*>/g, " "));
}

/** The Mixcloud page for this episode, or null. */
function mixcloudUrlFrom(html) {
  const acf = ACF_LINK_RE.exec(html);
  if (acf) {
    // The field is written without the www host; normalise it so the same
    // episode always reaches _mixcloud.js under one address.
    return acf[1].replace(/^https?:\/\/(?:www\.)?mixcloud\.com/i, "https://www.mixcloud.com");
  }

  const widget = WIDGET_FEED_RE.exec(html);
  if (widget) {
    console.warn(
      "[cashmere][WARN][SELECTOR_DRIFT] no episodeMixcloudLink in __NEXT_DATA__; " +
        "read the address out of the player iframe instead. The site may have left " +
        "the Next.js pages router -- check ACF_LINK_RE."
    );
    let feed;
    try {
      feed = decodeURIComponent(widget[1]);
    } catch (e) {
      feed = widget[1];
    }
    return "https://www.mixcloud.com" + (feed.startsWith("/") ? feed : "/" + feed);
  }

  return null;
}

// The site appends its own name to BOTH metadata fields, behind an en dash in
// og:title and behind a pipe in the title tag. Measured 30.09.2026:
// "Astral Traveling #40, w/ Maxime L. \u2013 Cashmere Radio". Without this the
// station would stand in every track name in Roon.
const SITE_SUFFIX_RE = /\s*[|\u2013\u2014-]\s*Cashmere Radio\s*$/i;

/** The episode's own name, as the page gives it. */
function titleFrom(html, url) {
  const og = OG_TITLE_RE.exec(html);
  if (og) return cleanText(unescapeHtml(og[1])).replace(SITE_SUFFIX_RE, "");
  const tag = TITLE_RE.exec(html);
  if (tag) return cleanText(unescapeHtml(tag[1])).replace(SITE_SUFFIX_RE, "");
  const slug = (url.match(/\/episode\/([^/?#]+)/i) || [])[1] || "";
  return slug.replace(/-/g, " ") || "Cashmere Radio";
}

/* One entry per line. No timestamps anywhere on these pages, so `seconds`
 * stays null throughout -- the same answer nts.js gives for the entries whose
 * timestamps sit behind its paywall.
 */
function tracklistFrom(html) {
  const block = PLAYLIST_RE.exec(html);
  if (!block) return [];
  return block[1]
    .split(/<br\s*\/?>/i)
    .map((line) => cleanText(stripTags(line)))
    // The bullet is decoration and belongs to neither field.
    .map((line) => line.replace(/^[\u2022*\u00b7-]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // The FIRST dash only: one measured title carries a comma-separated list
      // of guests and quotation marks of its own, and splitting on every dash
      // would cut it in the middle.
      const parts = line.split(DASH_RE);
      if (parts.length < 2) return { artist: "", title: line, seconds: null };
      return {
        artist: parts[0].trim(),
        title: parts.slice(1).join(" - ").trim(),
        seconds: null,
      };
    });
}

async function extract(url) {
  if (!match(url)) throw new Error("cashmere-adapter: URL does not match: " + url);

  const html = await fetchHtml(url);
  const mixcloudUrl = mixcloudUrlFrom(html);
  const title = titleFrom(html, url);

  if (!mixcloudUrl) {
    // A refusal that names the state. An episode page without a Mixcloud
    // embed is one whose recording has not been published yet -- the station
    // puts the page up with the description first and the mix follows.
    throw unsupported(
      "This Cashmere Radio episode carries no recording yet: the page has no " +
        "Mixcloud player. Cashmere publishes the page with its description first " +
        "and the mix a while later; try again in a day or two.",
      url
    );
  }

  const streamUrl = await extractMixcloudStream(mixcloudUrl);
  const tracklist = tracklistFrom(html);

  return {
    title: title,
    sourceType: "mixcloud",
    tracks: [{ title: title, streamUrl: streamUrl }],
    tracklist: tracklist.length
      ? tracklist
      : [{ artist: "", title: "No playlist on the Cashmere page", seconds: null }],
  };
}

module.exports = {
  match: match,
  extract: extract,
  // Exported for checks/cashmere-archive.test.js: the three rules that read the
  // page are what breaks when the site is rebuilt, and they are testable
  // without a network or a browser.
  mixcloudUrlFrom: mixcloudUrlFrom,
  titleFrom: titleFrom,
  tracklistFrom: tracklistFrom,
};
