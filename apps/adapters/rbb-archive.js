"use strict";

// adapters/rbb-archive.js
//
// Broadcasts that an rbb station keeps on its OWN pages, beside what the ARD
// Audiothek carries. An archive page such as
//
//   radiodrei.de/programm/schema/sendungen/neue_musik/archiv/20260701_2200.html
//
// holds the recording in plain sight as an mp3 on the rbb media library:
// rbbmediapmdp-a.akamaihd.net/.../..._mp3-256kd.mp3. That host is the one
// direct-audio.js was built for -- the file has always been playable once
// found. What was missing was the way from the page to it, which is all
// this adapter does.
//
// The ARD Audiothek stays the richer route where it has the broadcast: it
// brings a tracklist. This one wins where the Audiothek has nothing, and it
// takes the address the station itself shows.
//
// TWO STATIONS SINCE 09.09.2026, and radioeins was added out of necessity
// rather than tidiness. Until that day the guide stored radioeins broadcasts
// as ARD Sounds episode addresses, which ard-audiothek.js resolved -- eight of
// eight in the week of 07.09. The collector was rebuilt to look FORWARDS that
// day and now stores the station's own programme pages, so without this the
// station would have lost its archive entirely.
//
// AND THE TWO STATIONS HIDE THE FILE DIFFERENTLY. radiodrei writes the mp3
// into the page. radioeins does not: it carries a `"media":"..."` path to a
// `mediajsn.jsn` player configuration, and the file is in there --
// measured 09.09.2026 on the Parkfest Sondersendung of 29.08., which answers
//
//   "rbbtitle":"Radio Pop Off live vom Parkfest"
//   "_isLive":false  "_geoblocked":false  "_duration":6556
//   "_stream":"https://rbbmediapmdp-a.akamaihd.net/content/fe/34/..._mp3-256k.mp3"
//
// Both routes end at the same host, so the second is a detour and not a
// different mechanism. It is tried only where the first finds nothing, which
// leaves radiodrei's behaviour exactly as it was.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unescapeHtml, unsupported, isUnsupported } = require("./_shared");
const { probeDuration } = require("./direct-audio");
// Where a page with no file of its own is handed on. See handOver() below.
const ardProgramme = require("./ard-programme");

// Programme pages of either station, archive or not. A page without a
// recording says so; the front pages and the livestream pages carry no
// ".html" under /programm/ and stay with radio3.js and radioeins.js.
const PAGE_RE =
  /^https?:\/\/(?:www\.)?(?:radiodrei|radio3|radioeins)\.de\/programm\/[^?#]*\.html/i;
const MEDIA_RE = /https?:\/\/[^\s"'<>]*rbbmediapmdp[^\s"'<>]*\.mp3/i;

// The player configuration, radioeins' way of not writing the file into the
// page. A path, relative to the page.
const CONFIG_RE = /"media":"([^"]+)"/i;

function stationOf(url) {
  return /radioeins\.de/i.test(String(url || "")) ? "radioeins" : "radio3 (rbb)";
}

/* The file behind the player configuration.
 *
 * Returns null rather than throwing wherever the configuration is missing,
 * unreadable, live, or geoblocked -- every one of those is "this page has no
 * recording for us", which the caller already knows how to say. `_geoblocked`
 * is worth the separate test: rbb states it, most houses do not, and handing
 * over an address that will answer 403 is worse than saying no.
 */
async function fileFromConfig(html, pageUrl) {
  const hit = CONFIG_RE.exec(html);
  if (!hit) return null;
  let config;
  try {
    const address = new URL(unescapeHtml(hit[1]), pageUrl).href;
    config = JSON.parse(await fetchHtml(address));
  } catch (e) {
    return null;
  }
  /* NOT converted into a declared block on 16.09.2026, and the reason is worth
   * more than the change would have been.
   *
   * The plan was to answer `_geoblocked` the way SRF's blockReason is now
   * answered. Two things stopped it, both found by reading the caller rather
   * than this function:
   *
   *   1. `null` here does not mean "refuse". It means "no file of rbb's own",
   *      and the caller then hands the broadcast to the ARD Audiothek
   *      (handOver). A throw would skip a road that may well lead somewhere.
   *
   *   2. rbb's `_geoblocked` most likely means "Germany only" -- and the
   *      resolver runs in Berlin. So the flag may not be about us at all, and
   *      this line may be refusing recordings that would play. Unmeasured
   *      either way.
   *
   * Left exactly as it was until somebody looks. See OPEN-TASKS.
   */
  if (config._isLive || config._geoblocked) return null;

  const streams = [];
  for (const media of config._mediaArray || []) {
    for (const one of media._mediaStreamArray || []) {
      if (one && typeof one._stream === "string" && one._stream) streams.push(one._stream);
    }
  }
  if (!streams.length) return null;

  // By the bitrate in the FILE NAME, not by `_quality`. The Parkfest entry
  // carries `_quality: 2` beside `_mp3-256k.mp3`: the number in the name is a
  // statement about the file, the field is a sorting hint whose scale is rbb's
  // business.
  streams.sort(function (a, b) {
    const rate = function (url) {
      const found = /[-_](\d{2,3})k\b/i.exec(url);
      return found ? Number(found[1]) : 0;
    };
    return rate(b) - rate(a);
  });

  return {
    streamUrl: streams[0],
    title: cleanText(config.rbbtitle || ""),
    duration: typeof config._duration === "number" && config._duration > 0
      ? config._duration
      : null,
  };
}

function match(url) {
  return PAGE_RE.test(url);
}

function metaContent(html, property) {
  const patterns = [
    new RegExp('<meta[^>]*property=["\']' + property + '["\'][^>]*content=["\']([^"\']*)["\']', "i"),
    new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*property=["\']' + property + '["\']', "i"),
  ];
  for (const re of patterns) {
    const hit = re.exec(html);
    if (hit) return unescapeHtml(cleanText(hit[1]));
  }
  return "";
}

// The <title> carries the fuller line -- "Komponist der Nachkriegsmoderne -
// Hans Werner Henze zum 100. Geburtstag | radio3" -- where og:title has
// only the second half. So the station suffix goes and the rest stays.
function pageTitle(html) {
  const hit = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const full = hit
    ? unescapeHtml(cleanText(hit[1])).replace(/\s*\|\s*(radio\s*3|radioeins)\s*$/i, "")
    : "";
  return full || metaContent(html, "og:title") || "";
}

async function extract(url) {
  if (!match(url)) throw new Error("rbb-archive-adapter: URL does not match: " + url);

  const station = stationOf(url);
  const html = await fetchHtml(url);

  // In the page first, in the player configuration second. The order is the
  // measurement: radiodrei writes the file into the page, radioeins does not,
  // and trying the cheap way first leaves the station that never needed the
  // detour untouched by it.
  const plain = MEDIA_RE.exec(html);
  const behind = plain ? null : await fileFromConfig(html, url);

  if (!plain && !behind) {
    /* A DECLINE, NOT A FAILURE -- corrected 09.09.2026.
     *
     * This threw a plain Error until then, so `resolve-week.js` filed it as
     * `refused` and the monitor counted it under `failed`: four correct
     * refusals of radio3 looked like four faults in the station table. The
     * same conversion was made for five other adapters on 31.08. and 02.09.
     * and this one was missed.
     *
     * And the reason it gave was worse than the classification. It said
     * archive pages of the form .../archiv/<date>_<time>.html DO carry a
     * recording -- while refusing a page of exactly that form. Roger read the
     * second sentence on 09.09.2026 and asked; the page turned out to hold no
     * player, no configuration and no mp3 at all, 39 KB of description.
     *
     * What it really means is narrower and can be said: an ARD Radiofestival
     * broadcast is produced by another house. rbb airs it and does not file
     * it, so its own page has nothing to give however the address is shaped.
     */
    /* HANDED ON RATHER THAN REFUSED -- 09.09.2026, and the order is the point.
     *
     * rbb is an ARD house, so its broadcasts are in the Audiothek like every
     * other one's; `ard-programme.js` gained the two service entries the same
     * day. What it does NOT do is go first. It searches the Audiothek by title
     * and time, and that search answered 33 rows with the wrong recording on
     * 07.09.2026. Where rbb shows the file on its own page, taking it is a
     * fact; searching for it is a judgement. So: the fact first, the search
     * where there is no fact.
     *
     * This is also why rbbArchive stands BEFORE ardProgramme in dispatch.js
     * since today. detectAdapter picks one adapter by match() and does not
     * chain, so "the station's file first, the Audiothek second" cannot be had
     * by ordering alone -- somebody has to hand over, and it has to be the one
     * that knows whether it found anything.
     */
    return handOver(url, station);
  }

  const streamUrl = plain ? plain[0] : behind.streamUrl;
  // The page's own headline wins. `rbbtitle` in the configuration is the
  // audio's name and is sometimes the shorter of the two -- "Radio Pop Off
  // live vom Parkfest" against the page's "Radio POP OFF live aus dem Park am
  // Gleisdreieck" -- and the page is what the listener followed.
  const title = pageTitle(html) || (behind && behind.title) || station;
  const cover = metaContent(html, "og:image") || null;
  // The configuration states the length; where it does not, ffprobe is the
  // only way to the progress bar, and it stays quiet when it is missing.
  const duration = (behind && behind.duration) || (await probeDuration(streamUrl));

  return {
    title: title,
    sourceType: "rbb-archive",
    artist: station,
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    // The page names the pieces in prose, without times. Nothing invented.
    tracklist: [],
  };
}

/* The Audiothek, for a page that carries nothing.
 *
 * Every ARD Radiofestival takeover lands here: rbb airs it, another house
 * produced it and files it, and rbb's own page is 39 KB of description with no
 * player, no configuration and no mp3 -- measured 09.09.2026 on
 * radiodrei.de/programm/schema/sendungen/ard_radiofestival/archiv/20260907_2000.html.
 *
 * The refusal it falls back to says what is true of this page rather than what
 * is usually true of pages like it. The old wording asserted that archive
 * pages of the form .../archiv/<date>_<time>.html DO carry a recording, while
 * refusing a page of exactly that form -- Roger read the second sentence and
 * asked, which is how the measurement above came to be made.
 */
async function handOver(url, station) {
  if (ardProgramme.match(url)) {
    try {
      return await ardProgramme.extract(url);
    } catch (e) {
      // Its refusal is the better answer -- it knows whether the Audiothek was
      // asked and came back empty, or whether the address carried no time to
      // ask with. Only a genuine fault is swallowed in favour of ours.
      if (isUnsupported(e)) throw e;
    }
  }
  throw unsupported(
    "This page of " + station + " carries no recording, and the ARD Audiothek has " +
      "nothing for this broadcast either. Some broadcasts are kept on the station's " +
      "own pages and some are not -- a takeover such as the ARD Radiofestival is " +
      "produced by another ARD house, and rbb airs it without filing it.",
    url
  );
}

module.exports = { match, extract };
