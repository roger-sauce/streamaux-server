"use strict";

// Which recording of a Deutschlandradio day page belongs to a broadcast -- on
// BOTH stations of the house, which is the whole point of this rewrite.
//
// Everything below is COPIED from the schedules of 15.09.2026, read on
// 16.09.2026: the clock fragments, the heading markup and the play buttons,
// shortened to the attributes the adapter reads and otherwise untouched. Only
// the clock of the 19:15 Feature is assembled by `clock()` below, from the
// shape the other four establish, because that slot was not captured.
//
// Two things could not have been invented and are the reason the file exists:
//
//   * deutschlandfunkkultur.de has NO `schedule-item-time`. The first version
//     of this adapter matched on it, claimed both stations, and answered ten
//     rows of the sister with "lists no broadcast at that time". Both stations
//     are in the fixture now.
//   * on 15.09.2026 at 19:15 the Deutschlandfunk broadcast a Feature whose file
//     was made on 04.11.2025. A repeat is an ordinary thing, and its recording
//     keeps the date it was made.

const test = require("node:test");
const assert = require("node:assert");

const dlp = require("../adapters/deutschlandradio-programme");

// ---------------------------------------------------------------- clocks ----
// Verbatim, including the HTML escaping the page sends them in.
const CLOCK_2005 = 's&quot;:false,&quot;startTime&quot;:&quot;20:05&quot;,&quot;startDateRaw&quot;'
  + ':&quot;2026-09-15T20:05:00.000+02:00&quot;,&quot;endDateRaw&quot;:&quot;2026-09-15T21:00:00.000+02:00&quot;,';
const CLOCK_2105 = 's&quot;:false,&quot;startTime&quot;:&quot;21:05&quot;,&quot;startDateRaw&quot;'
  + ':&quot;2026-09-15T21:05:00.000+02:00&quot;,&quot;endDateRaw&quot;:&quot;2026-09-15T22:00:00.000+02:00&quot;,';
const CLOCK_0005 = 's&quot;:false,&quot;startTime&quot;:&quot;00:05&quot;,&quot;startDateRaw&quot;'
  + ':&quot;2026-09-15T00:05:00.000+02:00&quot;,&quot;endDateRaw&quot;:&quot;2026-09-15T01:00:00.000+02:00&quot;,';
const CLOCK_2000 = 's&quot;:false,&quot;startTime&quot;:&quot;20:00&quot;,&quot;startDateRaw&quot;'
  + ':&quot;2026-09-15T20:00:00.000+02:00&quot;,&quot;endDateRaw&quot;:&quot;2026-09-15T22:00:00.000+02:00&quot;,';

// The same shape for a slot that was not captured. Used once, for the repeat.
function clock(iso) {
  return 's&quot;:false,&quot;startDateRaw&quot;:&quot;' + iso + '&quot;,';
}

function heading(title) {
  return '        <h3 class="schedule-item-heading-title">' + title + '</h3>';
}

// ------------------------------------------------------------ play buttons --
// 21:05 Jazz Live, Deutschlandfunk. HLS, so the stamp sits in a directory name.
const JAZZ = '<a alt="Anhören" href="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'nduduzo_makhathini_trio_@_jazzbaltica_2026_dlf_20260915_2105_67eadfb1/master.m3u8"'
  + ' data-audio-diraid="9E0D266EB04911F17CE2B883034C2FA0"'
  + ' data-audio-src="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'nduduzo_makhathini_trio_@_jazzbaltica_2026_dlf_20260915_2105_67eadfb1/master.m3u8"'
  + ' data-audiotitle="Nduduzu Makhathini Trio @ JazzBaltica 2026"'
  + ' data-audio-duration="3298" data-audio-series="Jazz Live">';
const JAZZ_BUTTON = '<button data-audio-diraid="9E0D266EB04911F17CE2B883034C2FA0"'
  + ' data-audio-src="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'nduduzo_makhathini_trio_@_jazzbaltica_2026_dlf_20260915_2105_67eadfb1/master.m3u8"'
  + ' data-audiotitle="Nduduzu Makhathini Trio @ JazzBaltica 2026">';

// 19:15 Feature, Deutschlandfunk. THE REPEAT: broadcast 15.09.2026, file made
// 04.11.2025.
const FEATURE = '<a href="https://ondemand-mp3.dradio.de/file/dradio/2025/11/04/'
  + 'sprachwanderungen_heimatsuche_in_einer_brandenburger_dlf_20251104_1915_71c767cd.mp3"'
  + ' data-audio-diraid="643B531EB06011F07AB9B883034C2FA0"'
  + ' data-audio-src="https://ondemand-mp3.dradio.de/file/dradio/2025/11/04/'
  + 'sprachwanderungen_heimatsuche_in_einer_brandenburger_dlf_20251104_1915_71c767cd.mp3"'
  + ' data-audio-title="Heimatsuche in einer Brandenburger Kleinstadt / Sprachwanderungen"'
  + ' data-audio-duration="2609" data-audio-series="Feature"'
  + ' data-link="https://www.hoerspielundfeature.de/sprachwanderungen-100.html">';

// 20:00 Konzert, Deutschlandfunk KULTUR -- one of the ten rows the first
// version of this adapter refused.
const KONZERT = '<a alt="Anhören" href="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'musikfest_berlin_werke_von_denisov_vieru_und_rachmaninow_drk_20260915_2000_e0e2fe93/master.m3u8"'
  + ' data-audio-diraid="CA69C912B13211F17D4F48DF3755BF60"'
  + ' data-audio-src="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'musikfest_berlin_werke_von_denisov_vieru_und_rachmaninow_drk_20260915_2000_e0e2fe93/master.m3u8"'
  + ' data-audiotitle="Musikfest Berlin: Werke von Denisov, Vieru und Rachmaninow"'
  + ' data-audioduration="6196" data-audio-producer="Deutschlandfunk Kultur">';

// 00:05 Neue Musik, Deutschlandfunk Kultur.
const NEUE_MUSIK = '<a alt="Anhören" href="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'zum_100_geburtstag_von_giuseppe_chiari_drk_20260915_0005_180337a9/master.m3u8"'
  + ' data-audio-diraid="04C9344EAF8A11F1761548DF3755BF60"'
  + ' data-audio-src="https://hls.deutschlandradio.de/hls/2026/09/15/'
  + 'zum_100_geburtstag_von_giuseppe_chiari_drk_20260915_0005_180337a9/master.m3u8"'
  + ' data-audio-title="Zum 100. Geburtstag von Giuseppe Chiari"'
  + ' data-audio-duration="3286" data-audio-series="Neue Musik">';

// The livestream players, in the page furniture ahead of the first clock --
// which is exactly where the cut throws them away. Kept so the test fails if
// that stops being true.
const LIVE = '<button data-audio-src="https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3'
  + '?aggregator=web" data-islive="1" data-audio-title="Deutschlandfunk Livestream">';

function page(parts) {
  return '<div class="header">' + LIVE + LIVE + "</div>" + parts.join("");
}

// deutschlandfunk.de: the printed clock is there too, and deliberately unused.
const DLF = page([
  clock("2026-09-15T19:15:00.000+02:00"), heading("Feature"), FEATURE,
  CLOCK_2005, heading("Hörspiel"),
  CLOCK_2105, heading("Jazz Live"), JAZZ, JAZZ_BUTTON,
]);

// deutschlandfunkkultur.de: no schedule-item-time anywhere on the real page,
// and none here either.
const DRK = page([
  CLOCK_0005, heading("Neue Musik"), NEUE_MUSIK,
  CLOCK_2000, heading("Konzert"), KONZERT,
]);

const FEATURE_AT = new Date("2026-09-15T17:15:00.000Z");
const HOERSPIEL_AT = new Date("2026-09-15T18:05:00.000Z");
const JAZZ_AT = new Date("2026-09-15T19:05:00.000Z");
const NEUE_MUSIK_AT = new Date("2026-09-14T22:05:00.000Z");
const KONZERT_AT = new Date("2026-09-15T18:00:00.000Z");

test("one block per clock, on both stations", () => {
  assert.deepEqual(dlp.blocksOf(DLF).map((b) => b.title),
    ["Feature", "Hörspiel", "Jazz Live"]);
  assert.deepEqual(dlp.blocksOf(DRK).map((b) => b.title),
    ["Neue Musik", "Konzert"]);
});

test("the block is found by the instant, not by a printed clock", () => {
  assert.equal(dlp.blockAt(DLF, JAZZ_AT).title, "Jazz Live");
  assert.equal(dlp.blockAt(DLF, HOERSPIEL_AT).title, "Hörspiel");
  // The sister, whose page has no printed clock at all. These two are the
  // shape of the ten rows refused on 16.09.2026.
  assert.equal(dlp.blockAt(DRK, KONZERT_AT).title, "Konzert");
  assert.equal(dlp.blockAt(DRK, NEUE_MUSIK_AT).title, "Neue Musik");
});

test("a slot no broadcast begins at is not forced onto a neighbour", () => {
  assert.equal(dlp.blockAt(DLF, new Date("2026-09-15T18:40:00.000Z")), null);
  assert.equal(dlp.blockAt(DRK, new Date("2026-09-15T15:00:00.000Z")), null);
});

test("a minute either way still meets", () => {
  assert.equal(dlp.blockAt(DLF, new Date("2026-09-15T19:04:00.000Z")).title, "Jazz Live");
  assert.equal(dlp.blockAt(DLF, new Date("2026-09-15T18:58:00.000Z")), null,
    "seven minutes is not a minute or two");
});

test("a recording listed twice is one recording", () => {
  assert.equal(dlp.audioTagsOf(dlp.blockAt(DLF, JAZZ_AT).chunk).length, 1,
    "the <a> and the <button> name the same file");
});

test("the livestream never reaches a block", () => {
  for (const [html, at] of [[DLF, FEATURE_AT], [DLF, JAZZ_AT], [DRK, KONZERT_AT]]) {
    for (const tag of dlp.audioTagsOf(dlp.blockAt(html, at).chunk)) {
      assert.ok(!/sslstream/.test(tag), "a livestream got into a slot");
    }
  }
});

test("a slot without a player has no recording, and that is an answer", () => {
  assert.deepEqual(dlp.audioTagsOf(dlp.blockAt(DLF, HOERSPIEL_AT).chunk), []);
});

/* THE ONE THAT MATTERS.
 *
 * deutschlandradio.pickAudioTagAt() would refuse this file: its stamp says
 * 20251104 and the broadcast is on 20260915. In the live adapter that rule is
 * right, because there "now" IS the identity. Here the slot is the identity and
 * the file keeps the date it was made.
 */
test("a repeat is taken, however old the recording is", () => {
  const tags = dlp.audioTagsOf(dlp.blockAt(DLF, FEATURE_AT).chunk);
  assert.equal(tags.length, 1);
  const chosen = dlp.pickInBlock(tags, FEATURE_AT);
  assert.ok(chosen, "the 2025 recording must not be refused for its age");
  assert.match(chosen, /dlf_20251104_1915/);
});

test("with several recordings in one slot, the stamp decides", () => {
  const both = [FEATURE, JAZZ];
  assert.match(dlp.pickInBlock(both, JAZZ_AT), /dlf_20260915_2105/);
  assert.match(dlp.pickInBlock(both, FEATURE_AT), /dlf_20251104_1915/);
  assert.equal(dlp.pickInBlock(both, new Date("2026-09-15T12:00:00.000Z")), null,
    "none on the slot's own minute: refuse rather than guess");
});

test("the start time is read even behind the schedule page's own fragment", () => {
  const url = "https://www.deutschlandfunk.de/programm?drsearch:date=2026-09-15"
    + "#:~:text=Jazz%20Live&kg=2026-09-15T19%3A05%3A00.000Z&kgt=Jazz%20Live&kgs=deutschlandfunk";
  assert.equal(dlp.slotOf(url).toISOString(), "2026-09-15T19:05:00.000Z");
  assert.equal(dlp.slotOf("https://www.deutschlandfunk.de/programm?drsearch:date=2026-09-15"), null);
});

test("the day page is the broadcast's own Berlin day, not the UTC one", () => {
  // The one place a timezone is still reconstructed: which day page to fetch.
  assert.equal(
    dlp.dayPageFor("https://www.deutschlandfunk.de/programm?drsearch:date=2026-09-15#x",
      new Date("2026-09-15T22:30:00.000Z")),
    "https://www.deutschlandfunk.de/programm?drsearch:date=2026-09-16");
  assert.equal(
    dlp.dayPageFor("https://www.deutschlandfunkkultur.de/programm?drsearch:date=2026-09-15#x",
      new Date("2026-09-15T19:05:00.000Z")),
    "https://www.deutschlandfunkkultur.de/programm?drsearch:date=2026-09-15");
});

test("the schedule pages of both houses, and of nobody else", () => {
  assert.ok(dlp.match("https://www.deutschlandfunk.de/programm?drsearch:date=2026-09-15#x"));
  assert.ok(dlp.match("https://www.deutschlandfunkkultur.de/programm?drsearch:date=2026-09-15#x"));
  assert.ok(!dlp.match("https://www.deutschlandfunk.de/jazz-live-100.html"));
  assert.ok(!dlp.match("https://share.deutschlandradio.de/dlf-audiothek-audio-teilen.html?audio_id=dira_9E0D"));
  assert.ok(!dlp.match("https://www.srf.ch/audio/srf-2-kultur"));
});
