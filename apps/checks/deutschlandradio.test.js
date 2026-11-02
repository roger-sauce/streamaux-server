"use strict";

// Which of a day's recordings is the broadcast that was asked about.
//
// The fixture below is COPIED from the real page, deutschlandfunkkultur.de's
// schedule for 31.08.2026, read out of the container on 08.09.2026. Attribute
// names, spelling and the file-name stamp are as the station writes them --
// including the livestream player, which is the trap: it is the first .mp3 on
// the page. A fixture invented rather than measured tests the author's idea of
// the archive, which is how a wording gate came to read the station name.

const test = require("node:test");
const assert = require("node:assert");

const { pickAudioTagAt, berlinStamp, stampOf, describe: describeTag } =
  require("../adapters/deutschlandradio");

const LIVE = '<button data-audio-src="https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3'
  + '?aggregator=web" data-islive="1" data-audio-title="Deutschlandfunk Kultur Livestream">';

const MORNING = '<a data-audioreference="https://ondemand-mp3.dradio.de/file/dradio/2026/08/31/'
  + 'ethischer_kompass_evangelische_kirche_drk_20260831_0621_c69fc8d3.mp3"'
  + ' data-audio-diraid="08323714A14A11F1788D48DF3755BF60"'
  + ' data-audio-src="https://ondemand-mp3.dradio.de/file/dradio/2026/08/31/'
  + 'ethischer_kompass_evangelische_kirche_drk_20260831_0621_c69fc8d3.mp3"'
  + ' data-audio-title="Ethischer Kompass. Evangelische Kirche"'
  + ' data-audio-duration="172" data-audio-series="Wort zum Tage">';

const REVIEW = '<a data-audio-diraid="ADD14F9CA51511F17ECD48DF3755BF60"'
  + ' data-audio-src="https://ondemand-mp3.dradio.de/file/dradio/2026/08/31/'
  + 'buchkritik_omar_kamil_muslimischer_antisemitismus_drk_20260831_0817_f87f903b.mp3"'
  + ' data-audio-title="Buchkritik - Omar Kamil: &quot;Muslimischer Antisemitismus&quot;"'
  + ' data-audio-duration="344" data-audio-series="Studio 9">';

// The concert, and the one Roger read off the browser's network panel: this
// delivery form is an HLS VOD, so the stamp sits in a directory and not in a
// file name. It has to be found just the same.
const CONCERT = '<a data-audio-src="https://hls.deutschlandradio.de/hls/2026/08/31/'
  + 'lea_gasser_5tet_beim_festival_suisse_diagonales_jazz_drk_20260831_2000_1474d03c/'
  + 'master.m3u8" data-audio-title="Lea Gasser 5tet beim Festival Suisse Diagonales Jazz"'
  + ' data-audio-duration="5401" data-audio-series="In Concert"'
  + ' data-audio-delivery-type="stream">';

const DAY = "<html><body>" + LIVE + MORNING + REVIEW + CONCERT + "</body></html>";

// 20:00 in Berlin on 31.08.2026 is 18:00 UTC -- the guide's `kg=` is UTC and
// the station's file name is local.
const CONCERT_AT = new Date("2026-08-31T18:00:00.000Z");

test("berlinStamp reads the station's clock, not ours", () => {
  assert.deepEqual(berlinStamp(CONCERT_AT), { day: "20260831", minutes: 20 * 60 });
  assert.deepEqual(berlinStamp(new Date("2026-08-31T04:21:00.000Z")),
    { day: "20260831", minutes: 6 * 60 + 21 });
  assert.deepEqual(berlinStamp(new Date("2026-01-15T23:30:00.000Z")),
    { day: "20260116", minutes: 30 }, "winter, and past midnight in Berlin");
});

test("stampOf reads both delivery forms", () => {
  assert.deepEqual(stampOf(REVIEW), { day: "20260831", minutes: 8 * 60 + 17 });
  assert.deepEqual(stampOf(CONCERT), { day: "20260831", minutes: 20 * 60 },
    "an HLS VOD carries the stamp in a directory");
  assert.equal(stampOf(LIVE), null, "the livestream address has no broadcast in it");
});

test("pickAudioTagAt takes the broadcast, not the first audio on the page", () => {
  const tag = pickAudioTagAt(DAY, CONCERT_AT);
  assert.notEqual(tag, null);
  const found = describeTag(tag);
  assert.equal(found.title, "Lea Gasser 5tet beim Festival Suisse Diagonales Jazz");
  assert.match(found.streamUrl, /_drk_20260831_2000_/);
  assert.equal(found.duration, 5401);
});

test("pickAudioTagAt never answers with the livestream", () => {
  // Nothing at 13:00, and the page's first .mp3 is the running programme.
  const tag = pickAudioTagAt(DAY, new Date("2026-08-31T11:00:00.000Z"));
  assert.equal(tag, null);
});

test("pickAudioTagAt allows a minute or two, and no more", () => {
  const near = pickAudioTagAt(DAY, new Date("2026-08-31T18:04:00.000Z"));
  assert.match(describeTag(near).streamUrl, /_2000_/, "20:04 against 20:00");
  assert.equal(pickAudioTagAt(DAY, new Date("2026-08-31T18:10:00.000Z")), null,
    "ten minutes is another broadcast");
});

test("pickAudioTagAt keeps the days apart", () => {
  assert.equal(pickAudioTagAt(DAY, new Date("2026-09-01T18:00:00.000Z")), null,
    "the same hour, the next day");
});

test("pickAudioTagAt: each broadcast finds its own recording", () => {
  // 04:19 UTC is 06:19 in Berlin. Written out because getting this wrong is
  // exactly what made the line above fail the first time it ran.
  assert.match(describeTag(pickAudioTagAt(DAY, new Date("2026-08-31T04:19:00.000Z"))).streamUrl,
    /_0621_/, "the morning piece");
  assert.match(describeTag(pickAudioTagAt(DAY, new Date("2026-08-31T06:17:00.000Z"))).streamUrl,
    /_0817_/, "the book review, two hours later");
  assert.match(describeTag(pickAudioTagAt(DAY, CONCERT_AT)).streamUrl,
    /_2000_/, "the concert in the evening");
});
