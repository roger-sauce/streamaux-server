"use strict";

// What a refusal tells the next reader.
//
// The three resolvers built on _series-page-resolver.js compare an edition's
// own date with the day asked for. Whether that is right depends on what a
// station does when it repeats an older programme -- DR asks its schedule and
// finds a repeat by construction; these ask a list of editions, and an edition
// filed under the date it was MADE is not in the list under the date it was
// AIRED. Nobody has measured which stations do that.
//
// So the refusal carries the days that were on offer, and the log collects the
// evidence without anybody starting a probe. These checks are about that
// sentence being readable and honest, nothing more.

const test = require("node:test");
const assert = require("node:assert");

const { offered, declineOf } = require("../adapters/_series-page-resolver");

test("the days on offer come newest first", () => {
  const text = offered([
    { day: "2026-09-01" }, { day: "2026-09-15" }, { day: "2026-09-08" },
  ]);
  assert.equal(text, ". The editions on offer are 2026-09-15, 2026-09-08, 2026-09-01");
});

test("three, and a count for the rest", () => {
  const text = offered([
    { day: "2026-09-15" }, { day: "2026-09-08" }, { day: "2026-09-01" },
    { day: "2026-08-25" }, { day: "2026-08-18" },
  ]);
  assert.match(text, /2026-09-15, 2026-09-08, 2026-09-01 and 2 older$/);
});

test("the same day twice is one day", () => {
  // Rai splits Il Cartellone into parts, so two editions of one evening is an
  // ordinary thing and must not read as two dates.
  assert.equal(offered([{ day: "2026-09-12" }, { day: "2026-09-12" }]),
    ". The editions on offer are 2026-09-12");
});

test("an empty page says so rather than trailing off", () => {
  assert.equal(offered([]), ", and its page lists no editions at all");
  assert.equal(offered(null), ", and its page lists no editions at all");
  assert.equal(offered([{ url: "x" }]), ", and its page lists no editions at all",
    "an entry without a day is not a day");
});

/* WHY a station has no edition for that day, out of the days it does have.
 *
 * Every case below is a real refusal from the resolver run of the morning of
 * 17.09.2026, with the days the station actually offered. The three verdicts
 * were all present in that one run, which is what turned "either the programme
 * did not run that day, or the recording was never put into the archive" from
 * a sentence into three different answers.
 */
test("a publisher one day behind is asked again", () => {
  // Rai, Radio3 Suite - Il Cartellone: daily, newest 09-15, asked 09-16.
  const verdict = declineOf(["2026-09-15", "2026-09-14", "2026-09-13"], "2026-09-16");
  assert.deepEqual(verdict, { declined: "not-yet", retryable: true });
});

test("a weekly strand seven days behind is NOT behind", () => {
  // La stanza della musica: Fridays. Seven days is its rhythm, not a delay --
  // which is why the gap is measured against the cadence and not against a
  // fixed number of days. Roger caught this the afternoon it was written.
  const fridays = ["2026-09-05", "2026-08-29", "2026-08-22", "2026-08-15"];
  assert.equal(declineOf(fridays, "2026-09-12").declined, "not-yet");
});

test("a Friday strand asked for a Tuesday did not run", () => {
  const fridays = ["2026-09-05", "2026-08-29", "2026-08-22", "2026-08-15"];
  const verdict = declineOf(fridays, "2026-09-16");
  assert.deepEqual(verdict, { declined: "did-not-run", retryable: false });
});

test("an edition after the day asked for settles it", () => {
  // Noches en los jardines: 09-15 exists, 09-10 does not. A day already
  // overtaken cannot be published late.
  const verdict = declineOf(["2026-09-15", "2026-09-11", "2026-09-09"], "2026-09-10");
  assert.deepEqual(verdict, { declined: "did-not-run", retryable: false });
});

test("two months behind, on a strand that airs four nights a week", () => {
  // Los conciertos de Radio 3: newest 2026-07-17, asked 2026-09-11. RTVE's own
  // schedule has it running Tuesday to Friday night. The archive has stopped.
  const july = ["2026-07-17", "2026-07-16", "2026-07-15", "2026-07-14"];
  const verdict = declineOf(july, "2026-09-11");
  assert.deepEqual(verdict, { declined: "no-archive", retryable: false });
});

test("a monthly strand three months behind is not called dead", () => {
  // Both conditions have to hold: over a month AND several cadences. Three
  // editions behind on a monthly programme is a slow publisher, not a stopped
  // archive, and calling it one would be the "compiled by" mistake again.
  const monthly = ["2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01"];
  assert.equal(declineOf(monthly, "2026-08-01").declined, "did-not-run");
});

test("an empty page claims nothing and keeps asking", () => {
  // A strand that publishes none and a parser that broke this morning look
  // exactly alike from here.
  assert.deepEqual(declineOf([], "2026-09-16"), { declined: "unknown", retryable: true });
});
