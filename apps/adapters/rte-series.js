"use strict";

// adapters/rte-series.js -- the series-page pattern (see
// _series-page-resolver.js), for RTE lyric fm.
//
// The konzert-guide stores the strand,
//
//   https://www.rte.ie/radio/lyricfm/lyric-live/
//
// not the night. Which is not an oversight but the only thing there is to
// store: konzert-guide/COMMANDS.md records the finding that RTE's episode
// slugs are editorial and cannot be worked out from a date -- they have to be
// looked up. That is exactly what this does.
//
// The strand page lists about twenty editions, each as
//
//   /radio/lyricfm/rte-lyric-live/episodes/<uuid>/
//
// with the date beside it in running text, "Fri 14 Aug", and no year. The year
// is inferred: an archive holds only recent things, so the most recent
// matching year that is not in the future is the right one.
//
// rte-archive.js takes the uuid address unchanged and asks
// rte.ie/rteavgen/getplaylist/ for it; nothing is rebuilt here.
//
// 2fm is covered by the same pattern, and deliberately so. konzert-guide's
// COMMANDS.md says its "Sessions" are DJ sets rather than gigs, which is true
// of that one strand and not of the station: Roger named
// /radio/2fm/rte-choice-music-prize/ and /radio/2fm/oasis-live-with-dan-hegarty/
// on 18.08.2026, both live rock and pop. Since the address shape is the
// house's and not one station's, writing the pattern for the house cost
// nothing and covers whatever strand the guide collects next.

const { createSeriesPageResolver } = require("./_series-page-resolver");
const rteArchive = require("./rte-archive");

// Exactly two segments under /radio/: station and strand. The live page has
// one (/radio/lyricfm/), an episode has four, and the editorial /info/ pages
// have five -- so this claims the strand and nothing else.
const SERIES_RE =
  /^https?:\/\/(?:www\.)?rte\.ie\/radio\/[^/?#]+\/[^/?#]+\/?(?:[?#]|$)/i;

const LINK_RE = /\/radio\/[^"'<>\s]+\/episodes?\/[0-9a-f-]{8,}[^"'<>\s]*/gi;

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// The date RTE writes INSIDE the link's own tag, in its tracking attribute:
//
//   data-ati-tracking='{… "url":"RTE lyric Live \u002D 7 August 2026" …}'
//
// Full month, full year, and -- the part that matters -- inside the same tag as
// the address. The date a reader sees, "Fri 07 Aug", carries no year and sits
// outside the tag, where it cannot be paired reliably: measured on 18.08.2026,
// the visible date 576 characters BEFORE a link belonged to the previous card
// and the one 364 characters after belonged to this one. A window reaching
// both ways would have mismatched every row by one, plausibly enough that
// nobody would have noticed.
const TRACKED_RE = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i;

// Only if the attribute ever goes away. Weekday required, because without it
// the pattern would also take the "3 Hr 5 Mins" beside it; year inferred,
// because this form has none.
const VISIBLE_RE =
  /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

function pad(n) {
  return String(n).padStart(2, "0");
}

// The year the visible form leaves out. An archive lists recent editions, so
// the answer is the most recent year in which this day and month have already
// passed. Two days of slack, because a page may be built slightly ahead.
function yearFor(month, day) {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const candidate = Date.UTC(thisYear, month - 1, day, 12);
  return candidate > now.getTime() + 2 * 86400000 ? thisYear - 1 : thisYear;
}

// Deliberately only AFTER the link and only a little way. The attribute begins
// immediately behind the address; anything further off belongs to the next
// card.
function dayAfter(html, from) {
  const tail = html.slice(from, from + 600).replace(/&nbsp;|\u00a0/g, " ");
  const tracked = TRACKED_RE.exec(tail);
  if (tracked) {
    const month = MONTHS[tracked[2].toLowerCase()];
    if (month) return tracked[3] + "-" + pad(month) + "-" + pad(tracked[1]);
  }
  const visible = VISIBLE_RE.exec(tail.replace(/<[^>]+>/g, " "));
  if (visible) {
    const month = MONTHS[visible[2].toLowerCase()];
    if (month) return yearFor(month, Number(visible[1])) + "-" + pad(month) + "-" + pad(visible[1]);
  }
  return null;
}

// A playable episode carries a uuid. The strand page also lists older ones
// under a plain number -- /episodes/11808663/ -- and those are dead: measured
// on 18.08.2026, rte.ie/rteavgen/getplaylist answers 200 for them and returns
// no audio at all, while the same call on a uuid hands back an Omny address.
//
// So they are dropped here rather than offered. Handing one on would produce a
// refusal from rte-archive, or worse a result with nothing in it, and both are
// harder to read than a plain "no edition for that day". In practice nothing is
// lost: the numbered ones are the older entries, and the guide never offers a
// concert more than a week old.
const PLAYABLE_RE = /\/episodes?\/[0-9a-fA-F-]{36}/;

function episodesOf(html, pageUrl) {
  const out = [];
  const seen = Object.create(null);
  let hit;
  LINK_RE.lastIndex = 0;
  while ((hit = LINK_RE.exec(html)) !== null) {
    if (!PLAYABLE_RE.test(hit[0])) continue;
    const day = dayAfter(html, hit.index + hit[0].length);
    if (!day) continue;
    const url = new URL(hit[0], pageUrl).href;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({ url: url, day: day });
  }
  return out;
}

module.exports = createSeriesPageResolver({
  id: "rte-series",
  label: "RTE",
  matchRe: SERIES_RE,
  timeZone: "Europe/Dublin",
  episodesOf: episodesOf,
  archive: rteArchive,
});

module.exports.episodesOf = episodesOf;
