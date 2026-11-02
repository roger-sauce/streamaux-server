"use strict";

// adapters/_archive-match.js
//
// Deciding whether an archive item IS a given broadcast.
//
// Written on 17.08.2026 after three attempts that each rested on ONE key and
// each failed on a different station. The lesson is in the failures:
//
//   * The publication timestamp is not the broadcast time. Measured offsets
//     for the same evening: 0, 14, 127 and 193 minutes. It coincided only for
//     the ARD Radiofestival Jazz, which is fed in live -- and that single
//     coincidence made a broken rule look like a working one.
//   * The title is not the broadcast either. The guide says
//     "Rheingau-Musik-Festival", the archive "ARD Radiofestival. Konzert".
//     Nothing in the words connects them.
//   * The station is not a filter. Takeovers are filed under the PRODUCING
//     house, so an hr2 broadcast sits under SWR Kultur.
//
// What does hold, across every station measured, is one inequality:
//
//     a recording cannot be published before it was broadcast
//
// That turns the useless timestamp into a usable ONE-SIDED window. Everything
// else here is a weak witness, and the point of this file is that several weak
// witnesses agreeing beat one strong one guessed at.
//
// So: no key. Points. A hit needs one STRONG signal or two MEDIUM ones, and
// contradiction disqualifies outright -- an item whose own title names a
// different day is not the broadcast, no matter what else fits.
//
// Adding a station costs two things and neither is in this file: a way to
// enumerate a series, and -- if it writes dates in a way not yet listed -- one
// more pattern in DATE_PATTERNS, which then serves every station at once.

const STRONG = 3;
const MEDIUM = 2;
const WEAK = 1;

// One strong witness, or two medium ones.
const THRESHOLD = 3;

// How late a recording may appear and still be this broadcast. Measured worst
// case was 193 minutes -- a concert cut and posted after it ended. Six hours
// leaves room without reaching the next day's edition of the same slot.
const PUBLISH_WINDOW_SECONDS = 6 * 3600;

// A few minutes of slack the other way: schedules and archives disagree by
// seconds, and a broadcast occasionally starts a moment early.
const PUBLISH_EARLY_SECONDS = 10 * 60;

// The guide says 20:00, the archive says 20:03. Slot times are rounded, real
// starts are not.
const CLOCK_TOLERANCE_MINUTES = 15;

// How the houses write a broadcast date into an item's own text. Shared on
// purpose: a pattern added for one station immediately serves all of them.
//
// Each must yield [, day, month, year?, hour, minute]. Deliberately strict --
// a looser pattern once matched "Kulturtipps: (Wiederholung von 11.57 Uhr)"
// and made a talk item look like a concert.
const DATE_PATTERNS = [
  // ARD: "Mittagskonzert vom 14.08. um 13:05 Uhr", with or without the year.
  /\bvom\s+(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?\s*(?:um\s+)?(\d{1,2})[:.](\d{2})/i,
];

function pad(n) {
  return String(n).padStart(2, "0");
}

/// The broadcast a piece of text names, or null when it names none.
function dateInText(text) {
  for (const pattern of DATE_PATTERNS) {
    const hit = pattern.exec(String(text || ""));
    if (hit) {
      return {
        day: pad(hit[1]) + "." + pad(hit[2]) + ".",
        minutes: Number(hit[4]) * 60 + Number(hit[5]),
      };
    }
  }
  return null;
}

/// What is being looked for, in the shape the scoring wants: the day and the
/// minute of the broadcast as the STATION's own country reads them, because
/// that is how the archive writes them down.
function target(startedAt, timeZone, options) {
  const opts = options || {};
  const day = new Intl.DateTimeFormat("de-DE", {
    timeZone: timeZone, day: "2-digit", month: "2-digit",
  }).format(startedAt).replace(/\.$/, "") + ".";
  const clock = new Intl.DateTimeFormat("de-DE", {
    timeZone: timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(startedAt);
  return {
    at: startedAt,
    day: day,
    minutes: Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5)),
    durationSeconds: opts.durationSeconds || null,
    slot: opts.slot || "",
    service: opts.service || "",
    timeZone: timeZone,
  };
}

/// Points for one candidate, or null when it is disqualified.
///
/// `item` is whatever the station's enumerator produced:
///   { title, synopsis?, publishedAt?, durationSeconds?, service?, seriesTitle? }
function score(item, want) {
  const reasons = [];
  let points = 0;
  // Counted apart from the rest, and the reason is a wrong answer on
  // 18.08.2026: an episode five days off won on "duration fits" plus "wording
  // fits" -- two witnesses, three points, and neither of them saying anything
  // whatever about WHEN. Length and wording may corroborate a time; they can
  // never establish one.
  let temporal = 0;

  // 1. A date in the item's own text. The strongest witness there is -- and
  //    the only one that can also say NO. An item announcing another day is
  //    not this broadcast, whatever else agrees.
  const named = dateInText(item.title) || dateInText(item.synopsis);
  if (named) {
    if (named.day !== want.day) return null;
    if (Math.abs(named.minutes - want.minutes) > CLOCK_TOLERANCE_MINUTES) return null;
    points += STRONG;
    temporal = STRONG;
    reasons.push("date in the title");
  }

  // 2. The one-sided publication window. Published before the broadcast means
  //    it cannot be the recording of it.
  if (item.publishedAt) {
    const offset = (item.publishedAt.getTime() - want.at.getTime()) / 1000;
    if (offset < -PUBLISH_EARLY_SECONDS) return null;
    if (offset <= PUBLISH_WINDOW_SECONDS) {
      points += MEDIUM;
      temporal = Math.max(temporal, MEDIUM);
      reasons.push("published " + Math.round(offset / 60) + " min later");
    } else {
      const sameDay = new Intl.DateTimeFormat("de-DE", {
        timeZone: want.timeZone, day: "2-digit", month: "2-digit",
      }).format(item.publishedAt).replace(/\.$/, "") + ".";
      if (sameDay === want.day) {
        points += WEAK;
        temporal = Math.max(temporal, WEAK);
        reasons.push("same day");
      }
    }
  }

  // 3. Length. Independent of everything above and the reason a three-minute
  //    trailer never passes for an hour of concert.
  if (want.durationSeconds && item.durationSeconds) {
    const slack = Math.max(120, want.durationSeconds * 0.1);
    if (Math.abs(item.durationSeconds - want.durationSeconds) <= slack) {
      points += MEDIUM;
      reasons.push("duration fits");
    }
  }

  // 4. Wording, and the station. Both weak, both only ever tipping a scale
  //    that two other witnesses have already brought close.
  if (want.slot && overlap(want.slot, item.seriesTitle || item.title) >= 0.5) {
    points += WEAK;
    reasons.push("word overlap");
  }
  if (want.service && item.service && item.service === want.service) {
    points += WEAK;
    reasons.push("station");
  }

  // Two gates, not one. The points say how much agrees; `temporal` says
  // whether any of it was about the moment in question.
  if (temporal < MEDIUM) return null;
  if (points < THRESHOLD) return null;
  // `strong` means the item named the broadcast itself, in its own text.
  // Nothing else needs checking after that, which is what lets a caller stop
  // early instead of walking every list it could walk.
  return { points: points, reasons: reasons, strong: temporal >= STRONG };
}

/// The second pass, and a different question: not "the recording of THIS
/// transmission" but "this music, wherever it sits".
///
/// A repeat is filed under the day it was first published -- an hr2 broadcast
/// in July can be a WDR recording from March. The strict pass rejects that,
/// rightly, because it was asked about the transmission. This is asked about
/// the content, and therefore ignores time entirely.
///
/// It runs only when the strict pass found nothing, and what it returns is a
/// SUGGESTION: a different date, possibly a different cut. The caller says so
/// on the way out, because a listener who is not told will believe it is what
/// was tapped.
function similar(items, want, minimum) {
  const floor = typeof minimum === "number" ? minimum : 0.75;
  let winner = null;
  for (const item of items) {
    const rank = overlap(want.slot, item.title);
    if (rank < floor) continue;
    if (!winner || rank > winner.rank) winner = { item: item, rank: rank };
  }
  return winner;
}

const NOISE = /[.,:;!?"'()\[\]{}–—-]+/g;

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(NOISE, " ")
    .split(/\s+/)
    .filter(function (w) { return w.length > 1 && !/^(19|20)\d{2}$/.test(w); });
}

/// How much of the searched wording the candidate covers, 0 to 1. Asymmetric:
/// a series called "Jazz" should score for "Jazz vor sechs", while a long
/// title should not be rewarded for its length.
function overlap(query, candidate) {
  const wanted = words(query);
  if (!wanted.length) return 0;
  const have = new Set(words(candidate));
  let shared = 0;
  for (const word of wanted) if (have.has(word)) shared++;
  return shared / wanted.length;
}

/// The best of several candidates, or null when none clears the threshold.
function best(items, want) {
  let winner = null;
  for (const item of items) {
    const verdict = score(item, want);
    if (!verdict) continue;
    if (!winner) {
      winner = { item: item, verdict: verdict };
      continue;
    }
    if (verdict.points > winner.verdict.points) {
      winner = { item: item, verdict: verdict };
      continue;
    }
    // Equal points, and one of them is still the better answer.
    //
    // The same broadcast is regularly filed twice: once in its series, once in
    // a station's rolling feed. Checked on 18.08.2026 -- the Lex Korten
    // portrait sat in both, and they were NOT equivalent. The feed entry said
    // "Mitschnitt aus dem Radio-Programm" and nothing else; the series entry
    // carried the full text and, inside it, the setlist. ard-audiothek.js
    // reads its tracklist out of exactly that field, so the choice decides
    // whether the listener gets an hour of silence on screen or a running
    // order he can tap.
    //
    // So: whichever says more. Publication distance only breaks the remaining
    // tie, and only so that four announcements of one concert cannot answer
    // differently depending on which station's wording was searched with.
    if (verdict.points === winner.verdict.points) {
      const richer = told(item) - told(winner.item);
      if (richer > 0 || (richer === 0 && distance(item, want) < distance(winner.item, want))) {
        winner = { item: item, verdict: verdict };
      }
    }
  }
  return winner;
}

/// How much an entry tells. The length of the text is a crude measure and the
/// right one here: it is the same field the tracklist is parsed out of, so
/// more of it is literally more for the listener.
function told(item) {
  return String(item.synopsis || "").length;
}

function distance(item, want) {
  if (!item.publishedAt) return Infinity;
  return Math.abs(item.publishedAt.getTime() - want.at.getTime());
}

/// The nearest few by wording, for a refusal that names alternatives instead
/// of only saying no. Sorted best first, never played by itself.
function ranked(items, want, count) {
  return items
    .map(function (item) { return { item: item, rank: overlap(want.slot, item.title) }; })
    .filter(function (entry) { return entry.rank > 0.3 && entry.item.url; })
    .sort(function (a, b) { return b.rank - a.rank; })
    .slice(0, count || 3);
}

module.exports = {
  target, score, best, similar, ranked, dateInText, overlap, words,
  constants: { STRONG, MEDIUM, WEAK, THRESHOLD, PUBLISH_WINDOW_SECONDS, CLOCK_TOLERANCE_MINUTES },
};
