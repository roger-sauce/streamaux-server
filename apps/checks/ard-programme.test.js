"use strict";

// The three rules that decide what the ARD adapter asks for and what it hands
// back. Between them they turned ten Nachtkonzerte of one week from four
// minutes of background into the night itself.
//
// This one requires the adapter normally: it is a module, and the functions are
// on `internals` beside the ones that were already there.

const test = require("node:test");
const assert = require("node:assert");

const { withoutArticle, daysBetween, partsWithin } =
  require("../adapters/ard-programme").internals;
const weigh = require("../adapters/_archive-match");

test("withoutArticle: the word that cost the search everything", () => {
  // "Das ARD Nachtkonzert" answered with 4 items, none of them a Nachtkonzert.
  // "ARD Nachtkonzert" answered with 26, and the right segment scored STRONG.
  assert.equal(withoutArticle("Das ARD Nachtkonzert"), "ARD Nachtkonzert");
  assert.equal(withoutArticle("Der Abend"), "Abend");
  assert.equal(withoutArticle("Die Nacht"), "Nacht");
  assert.equal(withoutArticle("das ard nachtkonzert"), "ard nachtkonzert");
  assert.equal(withoutArticle("  Das  ARD Nachtkonzert "), "ARD Nachtkonzert");
  assert.equal(withoutArticle("Das Ö1 Konzert"), "Ö1 Konzert");

  assert.equal(withoutArticle("ARD Nachtkonzert"), "ARD Nachtkonzert",
    "already plain, and must not be touched twice");
  assert.equal(withoutArticle("Dasein"), "Dasein", "a word that begins with one");
  assert.equal(withoutArticle("Diebstahl im Konzert"), "Diebstahl im Konzert");
  assert.equal(withoutArticle("Der"), "Der", "nothing left to search with");
  assert.equal(withoutArticle(""), "");
  assert.equal(withoutArticle(null), "");
});

test("daysBetween: the titles carry no year", () => {
  const when = new Date("2026-09-05T22:03:00.000Z");
  assert.equal(daysBetween("06.09.", "06.09.", when), 0);
  assert.equal(daysBetween("06.09.", "07.09.", when), 1);
  assert.equal(daysBetween("06.09.", "05.09.", when), -1);
  assert.equal(daysBetween("31.12.", "01.01.", new Date("2026-12-31T23:00:00Z")), 1,
    "a night over New Year is one day apart, not 364");
  assert.equal(daysBetween("01.01.", "31.12.", new Date("2026-01-01T01:00:00Z")), -1);
  assert.equal(daysBetween("kaputt", "06.09.", when), null);
});

// The night of 06.09.2026, cut as SWR Kultur publishes it: 00:03, 02:03, 04:03,
// 05:03 -- 348 minutes of music and three minutes of news on each hour, which
// is the 357 the guide records for the block.
//
// `seriesTitle` is "SWR Kultur" on every one of them, and that is not a
// simplification -- it is what the API answers, read off a real search on
// 08.09.2026. An earlier version of this file invented "ARD Nachtkonzert"
// there, the checks passed, and the adapter collected nothing at all: the
// wording gate was reading the publication service. A fixture made up rather
// than measured tests the author's idea of the archive.
const segment = (day, clock, id) => ({
  url: id,
  seriesTitle: "SWR Kultur",
  title: "ARD-Nachtkonzert vom " + day + " um " + clock + " Uhr",
});

const night = [
  segment("06.09.", "00:03", "s1"),
  segment("06.09.", "02:03", "s2"),
  segment("06.09.", "04:03", "s3"),
  segment("06.09.", "05:03", "s4"),
  segment("07.09.", "00:03", "next"),
  { url: "morning", seriesTitle: "SWR Kultur",
    title: "SWR Kultur am Morgen vom 06.09. um 06:00 Uhr" },
  { url: "about", seriesTitle: "SWR Kultur",
    title: "02.03.1980: Das ARD-Nachtkonzert geht auf Sendung" },
];

function ask(startedAt, minutes, slot, service) {
  const when = new Date(startedAt);
  return {
    when: when,
    want: weigh.target(when, "Europe/Berlin",
      { durationSeconds: minutes * 60, slot: slot, service: service }),
  };
}

test("partsWithin: WDR 3 asks for the whole night and gets four parts", () => {
  // 22:03 UTC is 00:03 in Berlin. The times in the data are UTC, which is worth
  // saying out loud -- reading them as local is what made an earlier note here
  // claim hr2 was unsolved.
  const q = ask("2026-09-05T22:03:00.000Z", 357, "Das ARD Nachtkonzert", "WDR 3");
  assert.equal(q.want.day + " " + q.want.minutes, "06.09. 3");

  const parts = partsWithin(night, q.want, q.when);
  assert.deepEqual(parts.map((p) => p.item.url), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(parts.map((p) => p.at), [0, 120, 240, 300],
    "0, 2, 4 and 5 hours after the broadcast began");
});

test("partsWithin leaves alone what only touches the window", () => {
  const q = ask("2026-09-05T22:03:00.000Z", 357, "Das ARD Nachtkonzert", "WDR 3");
  const urls = partsWithin(night, q.want, q.when).map((p) => p.item.url);
  assert.equal(urls.includes("morning"), false,
    "06:00 is exactly the end of the window, and an end is not inside it");
  assert.equal(urls.includes("next"), false, "the following night");
  assert.equal(urls.includes("about"), false,
    "a piece about the series carries no date in the form the archive writes");
});

test("partsWithin: one part means the ordinary single-episode path", () => {
  // hr2 and br-klassik carry "Das ARD-Nachtkonzert (IV)" -- 03:03 UTC is 05:03
  // in Berlin, which is the fourth segment, and the numeral is its number.
  const q = ask("2026-09-06T03:03:00.000Z", 57, "Das ARD-Nachtkonzert (IV)", "hr2");
  assert.equal(q.want.day + " " + q.want.minutes, "06.09. 303");
  assert.deepEqual(partsWithin(night, q.want, q.when).map((p) => p.item.url), ["s4"]);
});

test("partsWithin: a window in which nothing begins", () => {
  const q = ask("2026-09-06T02:20:00.000Z", 40, "Das ARD Nachtkonzert", "hr2");
  assert.equal(partsWithin(night, q.want, q.when).length, 0);
});

test("partsWithin: no duration, nothing to collect", () => {
  const q = ask("2026-09-05T22:03:00.000Z", 357, "Das ARD Nachtkonzert", "WDR 3");
  const want = Object.assign({}, q.want, { durationSeconds: null });
  assert.equal(partsWithin(night, want, q.when).length, 0);
});

test("partsWithin: two searches may return one episode twice", () => {
  const q = ask("2026-09-05T22:03:00.000Z", 357, "Das ARD Nachtkonzert", "WDR 3");
  assert.equal(partsWithin(night.concat(night), q.want, q.when).length, 4);
});
