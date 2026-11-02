"use strict";

// adapters/deutschlandradio-programme.js
//
// The archive route for a Deutschlandfunk or Deutschlandfunk Kultur broadcast
// that the collection could only ever NAME, never address.
//
// WHY THIS EXISTS. The guide collects on Monday for the week ahead. The links
// on a Deutschlandradio schedule page are SERIES pages -- nachrichten-100,
// fazit-100, kalenderblatt-100, the same address on every day of the year --
// and the recordings appear only after the broadcast. Measured 16.09.2026 on
// deutschlandfunk.de:
//
//   20.09. (ahead)    0 audio ids on the page, 2 livestream players
//   16.09. (running) 227
//   15.09. (past)    763
//
// So the collection writes the dated schedule page, `programm?drsearch:date=`,
// and until today no adapter claimed that address. That, and nothing else, is
// why Deutschlandfunk stood at nought resolved recordings: not a broken parser,
// a missing step between naming a broadcast and finding it.
//
// WHAT IDENTIFIES THE BROADCAST is the SLOT -- station, day, start time. It
// arrives in the fragment the app appends (`#kg=`), and the day page carries
// one block per slot.
//
// AND NOT THE AGE OF THE RECORDING. This is the correction Roger made on
// 16.09.2026, and it is the reason this does not simply call
// deutschlandradio.pickAudioTagAt(). That helper picks by the stamp
// Deutschlandradio writes into every file name -- `_20260915_2105_` -- and
// discards anything whose DAY does not match. For the live adapter that is
// right: there, "now" is the identity. In an archive it is wrong, because a
// repeat is an ordinary thing and its file keeps the date it was made:
//
//   15.09.2026, 19:15, "Feature"
//   -> sprachwanderungen_heimatsuche_..._dlf_20251104_1915_71c767cd.mp3
//
// A recording from November 2025, sitting in the 19:15 block of a September
// 2026 schedule. pickAudioTagAt refuses it; the station plainly does not.
//
// The block was checked before being trusted, because the alternative reading
// -- a page that shows a series' newest edition regardless of the slot -- would
// have made it worthless. Over two whole days: 1 block of 32 on 15.09. and 0 of
// 33 on 09.09. carried a file stamped on another day. One repeat, not a habit.
//
// So the BLOCK says which broadcast, and the stamp is demoted to a tiebreaker
// for the magazines, which publish one file per contribution (8 of 49 blocks on
// 09.09.2026, up to twenty files in one slot). The concert strands -- Jazz
// Live, Musikszene, Atelier neuer Musik -- carry exactly one and are never
// ambiguous.
//
// Three answers, and two of them are refusals that are ANSWERS:
//   no audio in the block   -> the slot exists, the recording does not. Radio
//                              plays and concerts taped by others. 17 of 49
//                              blocks on both days measured.
//   several, none on slot   -> a magazine. Refused rather than guessed: the
//                              third contribution of ten is worse than nothing.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unsupported } = require("./_shared");
const dradio = require("./deutschlandradio");

/* Both houses again, since 16.09.2026 -- and the way back in is the measurement
 * that should have been made the first time.
 *
 * This adapter claimed deutschlandfunkkultur.de for a few hours on the
 * assumption that two stations of one house publish one page, found nothing on
 * the sister, and answered ten rows with "lists no broadcast at that time".
 * They were rows radiostations/deutschlandfunk-kultur.js could still answer,
 * and this one stands ahead of it, so its refusal ended the question.
 *
 * What the pages do NOT share is the printed clock: `schedule-item-time` occurs
 * 49 times on deutschlandfunk.de and NOT ONCE on the sister. What they do share
 * is better than the printed clock ever was:
 *
 *                            sections   startDateRaw   schedule-item-time
 *   deutschlandfunk.de          49           49                49
 *   deutschlandfunkkultur.de    31           31                 0
 *
 * One `startDateRaw` per broadcast on both, and it is a whole instant with its
 * offset -- "2026-09-15T20:00:00.000+02:00". So the comparison is a
 * subtraction, and the Berlin day, the midnight edge and the slack around a
 * printed "HH:MM" all go away with it.
 */
const PAGE_RE =
  /^https?:\/\/(?:www\.)?(?:deutschlandfunk|deutschlandfunkkultur)\.de\/programm(?:[/?]|$)/i;

// The start time as the app writes it. A base address may already carry a
// fragment -- the guide's schedule pages end in `#:~:text=` -- in which case
// the app appends with "&", so this looks for either separator. See kg-url.js.
const START_RE = /[#&]kg=([^&]+)/i;

/* The broadcast's own start, out of the JSON the page carries for itself.
 *
 * It sits in a `<script class="js-client-queries" data-json="...">` BEFORE its
 * section -- measured: the marks alternate CLOCK, SECTION, CLOCK, SECTION down
 * the whole page -- which is why the blocks below are cut at the clock and not
 * at the section. Everything before the first clock is page furniture, and that
 * is where the four livestream players sit; cutting here throws them away
 * without a rule about them.
 *
 * The attribute is HTML-escaped, so the quotation marks arrive as &quot;. Both
 * spellings are read: the escaped one is what the page sends today, the plain
 * one is what it would send if that ever changed.
 *
 * The nested `lines` objects inside a block -- the news bulletin within a long
 * music strand -- carry a `startTime` but no `startDateRaw`, which is what
 * makes this one per broadcast: 49 clocks for 49 sections, 31 for 31.
 */
const CLOCK_RE =
  /(?:&quot;|")startDateRaw(?:&quot;|")\s*:\s*(?:&quot;|")(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))(?:&quot;|")/g;
const TITLE_RE = /schedule-item-heading-title[^>]*>\s*([^<]{1,160})/;
const AUDIO_TAG_RE = /<[^>]*data-audio-src=[^>]*>/gi;
const SRC_RE = /data-audio-src="([^"]*)"/i;
const DIRAID_RE = /data-audio-diraid="([^"]+)"/i;

// Schedules and file names disagree by a minute or two often enough to be worth
// allowing, and never by more -- the same figure and the same reason as
// CLOCK_SLACK_MINUTES in deutschlandradio.js. Since the page's clock is now a
// whole instant, this is used as a span of time and no longer as a difference
// between two minute-of-day numbers.
const SLACK_MINUTES = 6;
const SLACK_MS = SLACK_MINUTES * 60000;

const SHARE_BASE =
  "https://share.deutschlandradio.de/dlf-audiothek-audio-teilen.html?audio_id=dira_";

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function match(url) {
  return PAGE_RE.test(withoutFragment(url));
}

function slotOf(url) {
  const hit = START_RE.exec(String(url || ""));
  if (!hit) return null;
  const when = new Date(decodeURIComponent(hit[1]));
  return Number.isFinite(when.getTime()) ? when : null;
}

/* The day page of the broadcast's OWN Berlin day.
 *
 * Deliberately rebuilt rather than taken from the `drsearch:date=` already in
 * the address. The two agree today; if they ever stop agreeing, the station's
 * clock is the one that decides which day a 00:05 broadcast belongs to, and
 * that clock is what berlinStamp() reads.
 */
function dayPageFor(url, when) {
  const stamp = dradio.berlinStamp(when);
  const ymd =
    stamp.day.slice(0, 4) + "-" + stamp.day.slice(4, 6) + "-" + stamp.day.slice(6, 8);
  return new URL(withoutFragment(url)).origin + "/programm?drsearch:date=" + ymd;
}

/* The day's broadcasts: one per clock, each running to the next.
 *
 * `at` is the broadcast's own start with its own offset, so no timezone is
 * reconstructed anywhere in this file except when the day page's ADDRESS has to
 * be built -- see dayPageFor.
 */
function blocksOf(html) {
  const text = String(html || "");
  const marks = [];
  let hit;
  CLOCK_RE.lastIndex = 0;
  while ((hit = CLOCK_RE.exec(text)) !== null) {
    const when = new Date(hit[1]);
    if (Number.isFinite(when.getTime())) marks.push({ at: when, from: hit.index });
  }
  return marks.map(function (mark, i) {
    const to = i + 1 < marks.length ? marks[i + 1].from : text.length;
    const chunk = text.slice(mark.from, to);
    return {
      at: mark.at,
      chunk: chunk,
      title: cleanText((TITLE_RE.exec(chunk) || [])[1] || ""),
    };
  });
}

/* The distinct play buttons inside ONE block.
 *
 * Distinct by file, because every recording appears twice in the markup -- once
 * on the play button and once on the share button. Counting the tags instead of
 * the files reads "one recording" as two and sends every ordinary broadcast
 * into the ambiguous branch below.
 *
 * The livestream is thrown out here as well as by the block boundary. It sits
 * in the page furniture rather than in a slot, so it should never appear -- and
 * the one thing worse than refusing a broadcast is playing the running
 * programme instead of it, so the guard is kept anyway.
 */
function audioTagsOf(chunk) {
  const tags = (String(chunk || "").match(AUDIO_TAG_RE) || []).filter(function (tag) {
    return !/data-islive="1"/i.test(tag);
  });
  const seen = [];
  const out = [];
  for (const tag of tags) {
    const src = (SRC_RE.exec(tag) || [])[1];
    if (!src || seen.indexOf(src) !== -1) continue;
    seen.push(src);
    out.push(tag);
  }
  return out;
}

// The broadcast that begins when the share says. Nearest within the slack, so a
// schedule that says 21:05 and a share that says 21:04 still meet.
function blockAt(html, when) {
  const want = when.getTime();
  let best = null;
  for (const block of blocksOf(html)) {
    const off = Math.abs(block.at.getTime() - want);
    if (off > SLACK_MS) continue;
    if (!best || off < best.off) best = Object.assign({ off: off }, block);
  }
  return best;
}

/* Which recording of a block is the broadcast.
 *
 * One file: that one, whatever its stamp says. This is the repeat, and it is
 * the whole point of this adapter.
 *
 * Several: the magazines. The stamp decides, and only when it decides cleanly
 * -- exactly one file carrying the slot's own minute. Two candidates or none
 * means refuse, which the caller turns into a sentence.
 */
function pickInBlock(tags, when) {
  if (tags.length <= 1) return tags[0] || null;
  const want = dradio.berlinStamp(when);
  const onSlot = tags.filter(function (tag) {
    const stamp = dradio.stampOf(tag);
    return !!stamp && Math.abs(stamp.minutes - want.minutes) <= SLACK_MINUTES;
  });
  return onSlot.length === 1 ? onSlot[0] : null;
}

async function extract(url) {
  if (!match(url)) {
    throw new Error("deutschlandradio-programme-adapter: URL does not match: " + url);
  }
  const page = withoutFragment(url);

  const when = slotOf(url);
  if (!when) {
    throw unsupported(
      "This is a Deutschlandradio schedule for a whole day, not one broadcast, " +
        "and the address does not say which start time is meant. Share the " +
        "concert from the Konzertfuehrer, which knows it. The schedule: " + page,
      page
    );
  }

  const dayUrl = dayPageFor(url, when);
  const html = await fetchHtml(dayUrl);

  const block = blockAt(html, when);
  if (!block) {
    throw unsupported(
      "The Deutschlandradio schedule for that day lists no broadcast at that " +
        "time. The schedule: " + dayUrl,
      dayUrl
    );
  }

  const tags = audioTagsOf(block.chunk);
  if (!tags.length) {
    throw unsupported(
      "Deutschlandradio publishes no recording of \"" +
        (block.title || "this broadcast") +
        "\": the slot is in the schedule, a player is not. Radio plays and " +
        "concerts taped by others are the usual reason. The schedule: " + dayUrl,
      dayUrl,
      // Not settled: the day page fills as the day runs -- 227 recordings at
      // midday against 763 the next morning, measured 16.09.2026.
      { retryable: true }
    );
  }

  const tag = pickInBlock(tags, when);
  if (!tag) {
    throw unsupported(
      "\"" + (block.title || "This broadcast") + "\" publishes " + tags.length +
        " recordings in one slot -- a magazine with its contributions apart -- " +
        "and none of them carries the slot's own start time, so which one is " +
        "the broadcast cannot be decided from here. The schedule: " + dayUrl,
      dayUrl
    );
  }

  const found = dradio.describe(tag);
  if (!found) {
    throw new Error("deutschlandradio-programme-adapter: the chosen tag has no audio source");
  }

  const diraid = (DIRAID_RE.exec(tag) || [])[1];

  return {
    title: found.title,
    // The same source type the share-page adapter answers with: what plays is
    // a Deutschlandradio file either way, and a second name here would mean a
    // second case in everything downstream.
    sourceType: "deutschlandradio",
    artist: found.artist,
    cover: found.cover,
    duration: found.duration,
    tracks: [{ title: found.title, streamUrl: found.streamUrl, cover: found.cover }],
    // Deutschlandradio gives no marks inside a broadcast.
    tracklist: [],
    link: found.link,
    // The share address of exactly this recording, so a second listen needs no
    // day page at all -- the same reason _series-page-resolver.js returns the
    // edition it found rather than the series it was given.
    sourceUrl: diraid ? SHARE_BASE + diraid : dayUrl,
  };
}

module.exports = {
  match, extract,
  // Read by apps/checks/deutschlandradio-programme.test.js.
  blocksOf, blockAt, audioTagsOf, pickInBlock, slotOf, dayPageFor,
};
