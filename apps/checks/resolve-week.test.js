"use strict";

// The rules the nightly run turns on: when a broadcast is over, when an entry
// is done with, which week a run belongs to, and what an adapter's answer is
// reduced to. All four decided a wrong record at least once, which is why they
// are checked here rather than by reading them again.

const test = require("node:test");
const assert = require("node:assert");
// Required, not lifted out of the source, since 10.09.2026: the helpers moved
// to apps/lib/rows.js and both scripts require them from there. What this
// replaces was `_load.js`, which read them out of resolve-week.js by counting
// braces -- see the header of lib/rows.js for why that was ever necessary and
// what it cost.
const api = require("../lib/rows");

const T = "2026-09-07T20:00:00.000Z";
const base = Date.parse(T);

test("endsAt: the length as the stations write it", () => {
  assert.equal(api.endsAt({ startTime: T, durationMin: 90 }), base + 90 * 60000);
  assert.equal(api.endsAt({ startTime: T, durationMin: "90 min" }), base + 90 * 60000,
    "a few stations send the unit along");
  assert.equal(api.endsAt({ startTime: T, durationMin: null }), base + 180 * 60000,
    "no length assumes three hours, the same number adapters/_on-air.js uses");
  assert.equal(api.endsAt({ startTime: T, durationMin: 0 }), base + 180 * 60000);
  assert.equal(api.endsAt({ startTime: "", durationMin: 90 }), null);
  assert.equal(api.endsAt({}), null);
});

test("unsupported() carries what the station said, retryable included", () => {
  const { unsupported, isUnsupported } = require("../adapters/_shared");
  const plain = unsupported("no archive here", "https://example.org/x");
  assert.equal(isUnsupported(plain), true);
  assert.equal(plain.retryable, undefined, "silence still means settled");

  const later = unsupported("not published yet", "https://example.org/x", { retryable: true });
  assert.equal(later.retryable, true);
  assert.equal(later.sourceUrl, "https://example.org/x");
  assert.equal(later.message, "not published yet");
});

test("isSettled: answered, or out of reach of asking again", () => {
  const reachable = { verdict: "reachable", live: false };
  assert.equal(api.isSettled({ status: "ok", probe: reachable }), true);
  assert.equal(api.isSettled({ status: "unsupported" }), true,
    "no archive at this station, and there will be none tomorrow");
  assert.equal(api.isSettled({ status: "unclaimed" }), true,
    "what changes an unclaimed address is a deployment, not a night");

  // 16.09.2026. A day-lookup that came up empty also arrives as "unsupported",
  // and it is not the same statement: RNE's broadcast of 02:00 was asked at
  // 09:46 and settled, with one attempt, about a recording the station might
  // put up that evening. The adapter that throws says which of the two it is.
  assert.equal(api.isSettled({ status: "unsupported", retryable: true }), false,
    "\"no edition on that day\" is not \"this station has no archive\"");
  assert.equal(api.isSettled({ status: "unsupported", retryable: false }), true,
    "the flag has to be true, not merely present");
  assert.equal(api.isSettled({ status: "unclaimed", retryable: true }), true,
    "an unclaimed address still needs a deployment, whatever an adapter says");

  assert.equal(api.isSettled({ status: "suggested", probe: reachable }), false,
    "an offer is not an answer, however reachable the audio behind it");
  assert.equal(
    api.isSettled({ status: "ok", probe: reachable, answer: { suggestion: true } }), false,
    "rows written before the status existed carry the flag in the answer");
  assert.equal(
    api.isSettled({ status: "ok", probe: { verdict: "reachable", live: true } }), false,
    "a livestream is always up: the probe would agree every night for ever");
  assert.equal(api.isSettled({ status: "refused" }), false);
  assert.equal(api.isSettled({ status: "ok", probe: { verdict: "gone" } }), false);
  assert.equal(api.isSettled(null), false);
});

test("isSettled: answered by adapters that are no longer these", () => {
  const reachable = { verdict: "reachable", live: false };
  const now = "aaaaaaaaaaaa";
  const then = "bbbbbbbbbbbb";

  assert.equal(api.isSettled({ status: "ok", probe: reachable, adapterVersion: now }, now),
    true, "same adapters: nothing to ask again");
  assert.equal(api.isSettled({ status: "ok", probe: reachable, adapterVersion: then }, now),
    false, "the answer came from a set that no longer exists");
  assert.equal(api.isSettled({ status: "unclaimed", adapterVersion: then }, now), false,
    "writing a BBC adapter must make the BBC rows worth asking again");
  assert.equal(api.isSettled({ status: "unsupported", adapterVersion: then }, now), false);

  assert.equal(api.isSettled({ status: "ok", probe: reachable }, now), true,
    "a row from before the field existed is left as it was");
  assert.equal(api.isSettled({ status: "ok", probe: reachable, adapterVersion: then }), true,
    "no version to compare against: the check does not fire");
});

test("isDone: settled, or given up on", () => {
  const v = "aaaaaaaaaaaa";
  assert.equal(api.isDone({ status: "refused", gaveUp: true, adapterVersion: v }, v), true);
  assert.equal(api.isDone({ status: "refused", adapterVersion: v }, v), false);
  assert.equal(
    api.isDone({ status: "refused", gaveUp: true, adapterVersion: "bbbbbbbbbbbb" }, v), true,
    "given up on stays given up: it is outside the window either way");
});

test("weekOf: the Monday of the collection, not the earliest entry", () => {
  // radioeins reports backwards out of an archive, and its August episodes
  // made a run over the week of 07.09. call itself the week of 24.08.
  assert.equal(api.weekOf([{ dateKey: "2026-08-24" }], "2026-09-07T00:01:46.388Z"),
    "2026-09-07");
  assert.equal(api.weekOf([{ dateKey: "2026-08-24" }], "2026-09-13T22:00:00.000Z"),
    "2026-09-07", "a Sunday belongs to its own Monday");
  assert.equal(api.weekOf([{ dateKey: "2026-08-24" }], null), "2026-08-24",
    "with no generatedAt the earliest day is all there is");
});

test("answerOf carries the flag that says this is not what was asked for", () => {
  assert.equal(api.answerOf({ title: "x", suggestion: true }).suggestion, true);
  assert.equal(api.answerOf({ title: "x" }).suggestion, false);
  assert.equal(api.answerOf(null).suggestion, false);
});

test("isoDate: one house format must not fail a whole file", () => {
  // RTVE writes "30-09-2026 23:59:00". As a Date field it took the archive
  // down on 07.09.2026 -- seven rows of 247 killed all 247.
  assert.equal(api.isoDate("30-09-2026 23:59:00"), "2026-09-30T23:59:00.000Z");
  assert.equal(api.isoDate("2026-09-30T23:59:00.000Z"), "2026-09-30T23:59:00.000Z");
  assert.equal(api.isoDate(null), null);
  assert.equal(api.isoDate("not a date"), "not a date",
    "kept as written rather than thrown away");
});
