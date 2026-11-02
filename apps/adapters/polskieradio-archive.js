"use strict";

// adapters/polskieradio-archive.js
//
// Broadcasts from Polskie Radio. One adapter for the whole house: Dwojka,
// Trojka, Czworka and the rest.
//
// TWO KINDS OF ADDRESS
//
// 1. An EPISODE on the modern site,
//    /<station>/audycje/<series>,<id>/odcinek/<title>,<uuid>
//    The uuid in the address IS the file name, so the audio is known without
//    asking anyone:
//
//      https://static.prsa.pl/9638f7cb-2479-4061-9373-abd989082a7f.mp3
//
// 2. An ARTICLE on the older site,
//    /<station>/<category>/Artykul/<id>,<slug>
//    This is where the concert archive actually points -- the collection page
//    "Koncerty w Dwojce" links articles, not episodes -- and it is what a
//    person copies out of the browser. Added 01.09.2026.
//
// WHAT AN ARTICLE CARRIES (measured 01.09.2026)
//
// Every player on the page is one span with a data-media attribute holding
// JSON, HTML-escaped:
//
//   {"id":3442038,"file":"//static.prsa.pl/c5edc83f-....mp3","provider":"audio",
//    "uid":"c5edc83f-...","length":7191,"autostart":true,"link":"",
//    "title":"2023_12_07%2023_00_04_PR2_Nocna_Strefa.mp3","desc":"..."}
//
// Three things in there are worth more than they look:
//
//   provider  "audio" for a recording. An article whose concert sits on
//             YouTube has NO data-media at all -- the video is a plain
//             iframe. So this is the audio/video decision, and it is the
//             station's own word rather than our guess. The obvious
//             alternative, the "[WIDEO]" marker some titles carry, is not
//             reliable: it does mean "no audio", but three articles WITHOUT
//             the marker had no audio either.
//   length    the duration in seconds, so ffprobe is not needed here.
//   title     the original file name, and it carries the broadcast date AND
//             time to the second, in the station's local time. That is what
//             makes several recordings in one article separable.
//
// The last point is not a nicety. Articles regularly bundle a whole run of
// broadcasts -- the piece on Claire Rousay and Martyna Basta holds three
// "Nocna Strefa" nights, 23.11., 30.11. and 07.12.2023. Playing "the first
// one" would be a coin toss, and a wrong concert plays perfectly.
//
// WHAT IS NOT WRONG HERE, THOUGH IT LOOKED LIKE IT (01.09.2026)
//
// Fetching a media URL from inside a browser page answers HTTP 500 with an
// ASP.NET "Specified cast is not valid" -- for every uuid, including ones
// known to work. From curl and from Node it answers 200 audio/mpeg with
// Accept-Ranges. The 500 is something about the browser's own request that
// their server cannot digest; it is not a signed URL, not a Referer check,
// and nothing this adapter has to work around. Noted here because it cost
// half a day and looks exactly like a dead media host.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unescapeHtml, unsupported } = require("./_shared");
const { probeDuration } = require("./direct-audio");

const EPISODE_RE =
  /^https?:\/\/(?:www\.)?polskieradio\.pl\/[^/]+\/audycje\/[^/]+\/odcinek\/[^,]*,([0-9a-fA-F-]{36})/;
const ARTICLE_RE =
  /^https?:\/\/(?:www\.)?polskieradio\.pl\/\d+\/\d+\/Artykul\/\d+/i;
const MEDIA_BASE = "https://static.prsa.pl/";

// Which night is asked of the URL, exactly as at RTVE and the ARD: the
// Konzertfuehrer app appends the start time as a fragment before sharing, and
// a fragment never reaches a server.
const FRAGMENT_RE = /[#&]kg=([^&]+)/i;
const TZ = "Europe/Warsaw";

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function match(url) {
  const bare = withoutFragment(url);
  return EPISODE_RE.test(bare) || ARTICLE_RE.test(bare);
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

// og:title packs four things into one line, separated by dashes:
//
//   Wybieram Dwojke - Dwojka - Program Drugi Polskiego Radia - Teatr PO KOLEI ...
//   \___ series __/   \_ station _/  \___ station, spelled out __/  \_ episode _/
//
// So the first part is the series and everything from the fourth on is the
// episode -- from the fourth, not the last, because an episode title may
// well carry a dash of its own.
function splitTitle(text) {
  const parts = String(text || "").split(" - ");
  if (parts.length >= 4) {
    return { series: cleanText(parts[0]), title: cleanText(parts.slice(3).join(" - ")) };
  }
  return { series: "", title: cleanText(text) };
}

// The values in data-media are URL-encoded on top of the HTML escaping.
function decodeValue(value) {
  const text = String(value || "");
  try {
    return cleanText(decodeURIComponent(text.replace(/\+/g, " ")));
  } catch (e) {
    return cleanText(text);
  }
}

// The broadcast date and time out of the original file name -> { day, minutes }
//
// Two spellings, both seen on 01.09.2026 and both from Dwojka:
//
//   2023_12_07 23_00_04_PR2_Nocna_Strefa.mp3     date first, time with _
//   _PR2 (mp3) 2025_04_04-18-00-12.mp3           date in the middle, time with -
//
// Hence the search anywhere in the name rather than an anchor at the front,
// and both separators. A name that fits neither yields null, and an entry
// without a date can then only be chosen when it is the only one -- which is
// the right outcome: guessing a night is worse than refusing one.
//
// Read as written, in Warsaw local time, and not through Date: the station
// named the day it broadcast on, and turning that into an instant only to turn
// it back would invite a timezone into a question that has none.
function stampOf(rawTitle) {
  const hit = /(\d{4})_(\d{2})_(\d{2})[\s_-](\d{2})[_-](\d{2})/.exec(decodeValue(rawTitle));
  if (!hit) return null;
  return {
    day: hit[1] + "-" + hit[2] + "-" + hit[3],
    minutes: Number(hit[4]) * 60 + Number(hit[5]),
  };
}

// The broadcast the fragment asks for, in the station's own local time.
function wantedFrom(url) {
  const hit = FRAGMENT_RE.exec(String(url || ""));
  if (!hit) return null;
  const when = new Date(decodeURIComponent(hit[1]));
  if (isNaN(when.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(when);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  return {
    day: p.year + "-" + p.month + "-" + p.day,
    minutes: hour * 60 + Number(p.minute),
  };
}

function absoluteMedia(file) {
  const text = String(file || "");
  if (text.startsWith("//")) return "https:" + text;
  if (/^https?:\/\//i.test(text)) return text;
  return MEDIA_BASE + text.replace(/^\/+/, "");
}

// Every recording on the page, in the order the page puts them.
function mediaItems(html) {
  // Two spellings of the same attribute, both live on 01.09.2026:
  //
  //   data-media="{&quot;id&quot;:3442038,...}"      escaped, quoted
  //   data-media={"id":3772133,...}                  raw, unquoted
  //
  // So the quote is optional and the payload is taken as everything up to the
  // first closing brace -- these objects are flat, no nesting to balance, and
  // their string values are URL-encoded, so no brace can appear inside one.
  //
  // Built here rather than at module level: a /g regular expression carries
  // its lastIndex between calls, and one throw in the middle would leave the
  // next article starting halfway down.
  const re = /data-media=["']?(\{[^{}]*\})/g;
  const seen = new Set();
  const out = [];
  let hit;
  while ((hit = re.exec(String(html || "")))) {
    let item;
    try {
      item = JSON.parse(hit[1].replace(/&quot;/g, '"'));
    } catch (e) {
      continue; // a player we do not understand is not a fault
    }
    if (!item || item.provider !== "audio" || !item.file) continue;
    const uid = String(item.uid || item.file);
    if (seen.has(uid)) continue; // each player is rendered twice, desktop and mobile
    seen.add(uid);
    out.push({
      streamUrl: absoluteMedia(item.file),
      seconds: Number(item.length) > 0 ? Number(item.length) : null,
      recordedAt: stampOf(item.title),
      label: decodeValue(item.desc),
    });
  }
  return out;
}

// Which of several recordings is meant. One is one; beyond that only the day
// decides, and a second recording on the same day is settled by the clock.
// Guessing between two nights would be the RTVE mistake again: a wrong concert
// plays perfectly and is only ever noticed by the sound.
//
// WHY "one is one" IS NOT LAZINESS. The date in the file name is the date of
// the RECORDING, not necessarily of the broadcast. For a live night programme
// the two coincide -- the three "Nocna Strefa" nights in the Claire Rousay
// article are named for the nights they went out. For a pre-produced session
// they do not: the Ava Trio recording is named 2025_04_04 and was broadcast on
// 30.06.2026, fifteen months later. Insisting on a match would refuse that
// article although it holds exactly the one recording it is about.
//
// So the day is used to TELL RECORDINGS APART, never to verify a single one.
// Where an article bundles several pre-produced recordings, none will match
// and this refuses -- which is the safe direction to be wrong in.
function pickRecording(items, wanted) {
  if (items.length === 1) return items[0];
  if (!wanted) return null;
  const sameDay = items.filter(function (item) {
    return item.recordedAt && item.recordedAt.day === wanted.day;
  });
  if (!sameDay.length) return null;
  return sameDay.reduce(function (best, item) {
    const a = Math.abs(item.recordedAt.minutes - wanted.minutes);
    const b = Math.abs(best.recordedAt.minutes - wanted.minutes);
    return a < b ? item : best;
  });
}

async function extractEpisode(url) {
  const hit = EPISODE_RE.exec(withoutFragment(url));
  const streamUrl = MEDIA_BASE + hit[1].toLowerCase() + ".mp3";

  // The page is fetched for the names alone, not for the audio -- that is
  // already known from the address. If it fails, playing still works.
  let named = { series: "", title: "" };
  let cover = null;
  try {
    const html = await fetchHtml(withoutFragment(url));
    named = splitTitle(metaContent(html, "og:title"));
    cover = metaContent(html, "og:image") || null;
  } catch (e) {
    // names are a comfort, the recording is the point
  }

  const title = named.title || "Polskie Radio";
  // No length in an episode page and none in an API: ffprobe is the only way
  // to the progress bar here, and it stays quiet when it is missing. An
  // article, below, states the length itself.
  const duration = await probeDuration(streamUrl);

  return {
    title: title,
    sourceType: "polskieradio-archive",
    artist: named.series || "Polskie Radio",
    cover: cover,
    duration: duration,
    tracks: [{ title: title, streamUrl: streamUrl, cover: cover }],
    tracklist: [],
  };
}

async function extractArticle(url) {
  const page = withoutFragment(url);
  const html = await fetchHtml(page);
  const items = mediaItems(html);
  const named = splitTitle(metaContent(html, "og:title"));
  const cover = metaContent(html, "og:image") || null;

  // Not a fault: plenty of Dwojka concerts are published as video and live on
  // YouTube. The article is the honest answer -- the video sits there in its
  // own context, with title and description, one tap from playing. Handing
  // over a YouTube address instead would be guesswork: these pages carry
  // several embeds and at least one of them is furniture.
  if (!items.length) {
    throw unsupported(
      "This Polskie Radio article holds no audio. What is published here is " +
        "a video, or nothing playable at all. Its article: " + page,
      page
    );
  }

  const wanted = wantedFrom(url);
  const chosen = pickRecording(items, wanted);

  if (!chosen) {
    const days = items
      .map(function (item) { return item.recordedAt ? item.recordedAt.day : "undated"; })
      .join(", ");
    throw unsupported(
      "This Polskie Radio article holds " + items.length + " recordings (" +
        days + ")" +
        (wanted ? ", none of them broadcast on " + wanted.day : "") +
        ". Share the concert from the Konzertfuehrer, which sends its date. " +
        "Its article: " + page,
      page
    );
  }

  // The article's own headline names the piece; where it bundles several
  // nights, the date is what tells them apart.
  const base = named.title || chosen.label || "Polskie Radio";
  const title =
    items.length > 1 && chosen.recordedAt ? base + " (" + chosen.recordedAt.day + ")" : base;

  return {
    title: title,
    sourceType: "polskieradio-archive",
    artist: named.series || "Polskie Radio",
    cover: cover,
    duration: chosen.seconds,
    tracks: [{ title: title, streamUrl: chosen.streamUrl, cover: cover }],
    tracklist: [],
    sourceUrl: page,
  };
}

async function extract(url) {
  const bare = withoutFragment(url);
  if (EPISODE_RE.test(bare)) return extractEpisode(url);
  if (ARTICLE_RE.test(bare)) return extractArticle(url);
  throw new Error("polskieradio-archive-adapter: URL does not match: " + url);
}

module.exports = { match, extract };
module.exports.mediaItems = mediaItems;
module.exports.pickRecording = pickRecording;
module.exports.stampOf = stampOf;
module.exports.wantedFrom = wantedFrom;
