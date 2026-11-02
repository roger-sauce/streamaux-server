"use strict";

/* How long a broadcaster keeps a recording available.
 *
 * This table starts with ONE entry, and that is deliberate. Twenty-seven
 * plausible numbers would look like knowledge and be guesswork: retention is
 * not a property of a station but of the rights on a particular strand, and
 * the same broadcaster keeps its own production for a year and a relayed
 * concert for a month. A table full of guesses is worse than an empty one,
 * because a wrong expectation turns a correct measurement into a false alarm.
 *
 * It grows two ways. Either a rule is found in writing -- then it goes in with
 * its source, as below. Or resolve-week.js --reprobe measures it: an address
 * that still answers on day 40 has told us more than any terms of service.
 *
 * What the numbers are FOR: they turn a status code into a statement.
 *
 *   reachable on day 12, documented 30   expected, nothing to see
 *   gone on day 12, documented 30        a finding -- either the address was
 *                                        signed after all, or the rule does
 *                                        not cover this item
 *   reachable on day 40, documented 30   also a finding, a pleasant one
 *
 * Without the table all three are just "200" or "404".
 *
 * Counted from the day of broadcast, not from the day of collection: that is
 * how the broadcasters word it, and a collection can be days late.
 */

const RETENTION = [
  {
    stationId: "france-musique",
    // The rule is for the strand, not for the station. France Musique keeps
    // other things far longer and some things not at all.
    match: /\/podcasts\/le-concert-du-soir\//i,
    days: 30,
    source:
      "Radio France, reecoute for 'Le concert du soir': 30 days from the day " +
      "of broadcast, under the standard agreements with the music unions and " +
      "the EBU (relayed concerts, here the BBC Proms). Noted 31.08.2026.",
  },
];

// The first rule that fits, or null. A rule without `match` covers the whole
// station; one with `match` is tried against the broadcast address.
function retentionFor(stationId, broadcastUrl) {
  for (const rule of RETENTION) {
    if (rule.stationId !== stationId) continue;
    if (rule.match && !rule.match.test(String(broadcastUrl || ""))) continue;
    return { days: rule.days, source: rule.source };
  }
  return null;
}

// A date out of whatever a station chooses to call a date. RTVE writes
// "30-09-2026 00:00:00", others will write ISO, and the answer here is always
// the plain day.
function dayOf(value) {
  const text = String(value || "").trim();
  const spanish = /^(\d{2})-(\d{2})-(\d{4})/.exec(text);
  if (spanish) return spanish[3] + "-" + spanish[2] + "-" + spanish[1];
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return iso ? iso[1] : null;
}

// The day a recording is expected to go, as a DATE and not a timestamp.
//
// The rules are worded in days from the day of broadcast, so an hour in the
// answer would be invented precision -- and a countdown that says "23 days,
// 4 hours" invites someone to believe the four hours.
//
// dateKey is the broadcast day as the collector saw it, in the station's own
// local time. Deriving the day from startTime instead would be wrong by one
// for everything after midnight: an ARD Nachtkonzert at 01:30 Berlin time is
// still the previous day in UTC.
function expiryFrom(dateKey, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!m || !days) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/* What can honestly be said about how long this one entry will last.
 *
 * Five states, because "is a rule set" has four answers too few:
 *
 *   stated        the station named an expiry date for this very recording.
 *                 The best answer there is, and it outranks the rest: a rule
 *                 generalises about a strand, this is about one broadcast.
 *                 RTVE answers an expirationDate; more will follow.
 *   documented    a rule fits, and nothing has contradicted it. A countdown
 *                 to `expiresOn` is warranted.
 *   observed      no rule, but a re-probe found the entry alive on day N.
 *                 That is a floor, not a countdown: at least N days. Showing
 *                 it as a countdown would be inventing the other end.
 *   contradicted  a rule fits and the entry was gone INSIDE it. The rule does
 *                 not cover this item -- an exception, a signed address, a
 *                 depublication. Whatever it is, the countdown would lie.
 *   unknown       nothing is known. The UI shows no number at all, which is
 *                 the only honest thing it can show.
 *
 * `checks` is the entry's own history of probes, oldest first.
 */
function retentionState(entry, rule) {
  const checks = Array.isArray(entry && entry.checks) ? entry.checks : [];
  const alive = checks.filter((c) => c.verdict === "reachable" && c.ageDays !== null);
  const observedAliveDays = alive.length
    ? Math.max(...alive.map((c) => c.ageDays))
    : null;

  // Only "gone" -- a 404 or a 410 -- may contradict a rule.
  //
  // "blocked" is a geo-block or a rights restriction: the recording is sitting
  // there intact and we are not allowed at it. "error" is a dropped connection and
  // means nothing at all. Counting either as an expiry would write "gone after
  // six days" into the record for something that never went anywhere, and the
  // measurement would be poisoned permanently -- a contradicted rule never
  // recovers, because a countdown once withdrawn stays withdrawn.
  //
  // Nine RTVE entries came back as connection failures and 403s on 31.08.2026.
  // Under the earlier two-verdict scheme every one of them would have been
  // filed as expired.
  const contradiction = rule
    ? checks.find(
        (c) =>
          c.verdict === "gone" &&
          typeof c.ageDays === "number" &&
          c.ageDays <= rule.days
      )
    : null;

  // What the station itself said about THIS recording, where the adapter
  // passed it on. It outranks everything below: a rule is a generalisation
  // about a strand, this is an answer about one broadcast.
  const stated = dayOf(entry.answer && entry.answer.expiresAt);

  let state = "unknown";
  if (stated) state = "stated";
  else if (rule && contradiction) state = "contradicted";
  else if (rule) state = "documented";
  else if (observedAliveDays !== null) state = "observed";

  return {
    state: state,
    days: rule ? rule.days : null,
    source: stated ? "the station's own expiry date" : rule ? rule.source : null,
    expiresOn:
      state === "stated" ? stated
        : state === "documented" ? expiryFrom(entry.dateKey, rule.days)
        : null,
    observedAliveDays: observedAliveDays,
    goneOnDay: contradiction ? contradiction.ageDays : null,
    // Not an expiry, but the other reason a countdown would mislead: the
    // recording is there and stays there, and we still cannot play it.
    geoRestricted: !!(entry.answer && entry.answer.geoRestricted),
  };
}

module.exports = { RETENTION, retentionFor, expiryFrom, dayOf, retentionState };
