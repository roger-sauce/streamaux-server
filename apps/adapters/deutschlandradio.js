"use strict";

// adapters/deutschlandradio.js
//
// The archive route for Deutschlandfunk and Deutschlandfunk Kultur. Both
// belong to Deutschlandradio and NOT to the ARD, so they are missing from
// the ARD Audiothek and keep their own Dlf Audiothek. Its "share" button
// hands out exactly one kind of URL:
//
//   https://share.deutschlandradio.de/dlf-audiothek-audio-teilen.html?audio_id=dira_<hex>
//
// The page is rendered on the server and everything needed sits in the
// data-audio-* attributes of the play buttons -- no API call required.
//
// CAREFUL, and this is the whole reason for the care taken here: the same
// page also carries the station's LIVESTREAM, likewise in a
// data-audio-src. Take the first audio URL and you get the running
// programme instead of the broadcast -- the same mistake the station
// adapters made until 09.08.2026. Two safeguards against it:
// data-islive="1" is thrown out, and data-audio-diraid has to be the
// identifier from the URL.
//
// Two delivery forms occur and both are needed:
//   delivery-type="download" -> a finished MP3 (ondemand-mp3.dradio.de)
//   delivery-type="stream"   -> HLS VOD (hls.deutschlandradio.de/.../master.m3u8)
// Both have a length, both can be jumped into with ffmpeg -ss.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks: [{title, streamUrl}], tracklist? }>

const { fetchHtml, cleanText } = require("./_shared");

const SHARE_URL_RE = /^https?:\/\/share\.deutschlandradio\.de\//i;

function decodeEntities(text) {
  return String(text || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // &amp; last, otherwise &amp;quot; would turn into a quotation mark.
    .replace(/&amp;/gi, "&");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"', "i"));
  return m ? decodeEntities(m[1]) : null;
}

function audioIdFrom(url) {
  let raw = null;
  try {
    raw = new URL(url).searchParams.get("audio_id");
  } catch (e) {
    raw = null;
  }
  if (!raw) return null;
  // The URL says "dira_<hex>", the attribute only "<hex>".
  return raw.replace(/^dira_/i, "").trim();
}

// Picks the right play button out of the raw HTML. Kept apart from the
// fetch so that the sorting can be checked without a network.
function pickAudioTag(html, audioId) {
  const tags = (html.match(/<[^>]*data-audio-src=[^>]*>/gi) || []).filter(
    (t) => /data-islive="1"/i.test(t) === false
  );
  if (tags.length === 0) return null;
  if (audioId) {
    const exact = tags.find((t) => (attr(t, "data-audio-diraid") || "").toLowerCase() === audioId.toLowerCase());
    if (exact) return exact;
  }
  return tags[0];
}

/* The broadcast's own hour, as Deutschlandradio writes it into the file name.
 *
 *   ..._drk_20260831_0817_f87f903b.mp3
 *   ..._drk_20260831_2000_1474d03c/master.m3u8
 *
 * Local Berlin time, and generated from the recording rather than from the
 * request -- which is what makes it usable as an identity. Read off both
 * delivery forms, since the stamp sits in the path either way.
 */
const DRK_STAMP = /_(\d{8})_(\d{4})_/;

function stampOf(tag) {
  const src = attr(tag, "data-audio-src") || attr(tag, "data-audioreference") || "";
  const hit = DRK_STAMP.exec(src);
  if (!hit) return null;
  return {
    day: hit[1],
    minutes: Number(hit[2].slice(0, 2)) * 60 + Number(hit[2].slice(2)),
  };
}

// The same stamp, computed for a moment. Berlin, because that is the clock the
// station writes with; the guide's `kg=` is UTC and the two are two hours apart
// in summer -- reading one as the other is a mistake already made once today.
function berlinStamp(when) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(when);
  const value = (type) => (parts.find((p) => p.type === type) || {}).value;
  return {
    day: value("year") + value("month") + value("day"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

// Schedules and file names disagree by a minute or two often enough to be worth
// allowing, and never by more: the next broadcast is an hour away.
const CLOCK_SLACK_MINUTES = 6;

/* Which of a day page's recordings is the broadcast that was asked about.
 *
 * A schedule page carries the whole day -- 44 broadcasts on 31.08.2026, plus 4
 * livestream players -- and the FIRST .mp3 on it is the livestream. Choosing by
 * position or by wording would be guessing; the stamp in the file name is the
 * broadcast's own hour, so this is an identity and not a resemblance.
 *
 * `pickAudioTag` above answers a different question -- which recording a share
 * link names -- and its `return tags[0]` fallback is exactly wrong here.
 */
function pickAudioTagAt(html, when) {
  const want = berlinStamp(when);
  const tags = (String(html || "").match(/<[^>]*data-audio-src=[^>]*>/gi) || []).filter(
    (t) => /data-islive="1"/i.test(t) === false
  );
  let best = null;
  for (const tag of tags) {
    const stamp = stampOf(tag);
    if (!stamp || stamp.day !== want.day) continue;
    const off = Math.abs(stamp.minutes - want.minutes);
    if (off > CLOCK_SLACK_MINUTES) continue;
    if (!best || off < best.off) best = { off: off, tag: tag };
  }
  return best ? best.tag : null;
}

function describe(tag) {
  const src = attr(tag, "data-audio-src") || attr(tag, "data-audioreference");
  if (!src) return null;
  const seconds = parseFloat(attr(tag, "data-audio-duration") || attr(tag, "data-audioduration") || "");
  const title = cleanText(attr(tag, "data-audio-title") || attr(tag, "data-audiotitle")) || "Deutschlandradio";
  return {
    title: title,
    // The series ("Kalenderblatt", "Konzert") says more about what you are
    // hearing than the station name, which the source already carries.
    artist: cleanText(attr(tag, "data-audio-series")) || cleanText(attr(tag, "data-audio-producer")) || null,
    cover: attr(tag, "data-audioimage"),
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    streamUrl: src,
    // The page at the station itself, where the broadcast has a description.
    link: attr(tag, "data-link"),
  };
}

function match(url) {
  return SHARE_URL_RE.test(url) && audioIdFrom(url) !== null;
}

async function extract(url) {
  if (!match(url)) throw new Error("deutschlandradio-adapter: URL does not match: " + url);
  const audioId = audioIdFrom(url);
  const html = await fetchHtml(url);
  const tag = pickAudioTag(html, audioId);
  if (!tag) {
    throw new Error(
      "This share page holds no audio other than the livestream -- the broadcast " +
        "may no longer be available."
    );
  }
  const found = describe(tag);
  if (!found) throw new Error("deutschlandradio-adapter: no data-audio-src found");

  return {
    title: found.title,
    sourceType: "deutschlandradio",
    artist: found.artist,
    cover: found.cover,
    duration: found.duration,
    tracks: [{ title: found.title, streamUrl: found.streamUrl, cover: found.cover }],
    tracklist: [],
    link: found.link,
  };
}

module.exports = {
  match, extract, pickAudioTag, describe, audioIdFrom,
  // Read by deutschlandfunk-kultur.js for the day schedule, and checked in
  // apps/checks/deutschlandradio.test.js.
  pickAudioTagAt, berlinStamp, stampOf,
};
