"use strict";

// adapters/dr-lyd-series.js
//
// The step the Konzertfuehrer cannot take for DR, and why it cannot.
//
// DR's schedule answers a `presentationUrl` per broadcast, and the collection
// stores it. For a broadcast that has ALREADY AIRED that is the episode:
//
//   /lyd/p8jazz/paa-scenen/paa-scenen-2026/dr-big-band-ivan-lins-...-18452627355
//
// For one still to come it is the series:
//
//   /lyd/p8jazz/paa-scenen-2600754375000
//
// Measured 02.09.2026 across four days: the 28.08. carried episode addresses,
// the 04.09. carried series addresses. The collection runs on Monday for the
// week ahead and therefore sees nothing but series addresses -- it CANNOT know
// the episode, because DR has not made one yet.
//
// So this adapter does afterwards what the collection could not do before: it
// asks DR's own schedule for the broadcast day named in the #kg= fragment and
// reads the episode address out of it. Then dr-lyd-archive.js plays it.
//
// THE SEVEN-DAY WINDOW
//
// DR's schedule does not reach back indefinitely. Measured on 02.09.2026, day
// by day: the 26.08. answered eleven broadcasts and the 25.08. answered none.
// Seven days, sharp.
//
// That is a deadline, and it is not ours: after a week the episode address
// cannot be looked up any more, however long the recording itself stays on
// DR's servers. The weekly resolver run has to happen inside it -- a Sunday
// run reaches Monday's broadcast with a day to spare, and a run that slips by
// two days loses the beginning of the week for good.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { unsupported } = require("./_shared");
const archive = require("./dr-lyd-archive");

// Exactly two segments under /lyd/, ending after the id. The episode form has
// four, so it stays with dr-lyd-archive.js -- whose own pattern would take
// both, which is why this adapter has to sit ahead of it in dispatch.js.
const SERIES_RE =
  /^https?:\/\/(?:www\.)?dr\.dk\/lyd\/([^/?#]+)\/([^/?#]+)-(\d{6,})\/?(?:[?#]|$)/i;

const DR_BASE = "https://www.dr.dk";
const FRAGMENT_RE = /[#&]kg=([^&]+)/i;
const TZ = "Europe/Copenhagen";

// The schedule is fetched per calendar day, so a broadcast is looked for
// around its own start and not in a window. Two hours of slack covers a
// programme that DR moved a little after the collection saw it; beyond that
// it is a different broadcast and handing it over would be the RTVE mistake.
const SLACK_MS = 2 * 60 * 60 * 1000;

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function match(url) {
  return SERIES_RE.test(withoutFragment(url));
}

function wantedFrom(url) {
  const hit = FRAGMENT_RE.exec(String(url || ""));
  if (!hit) return null;
  const when = new Date(decodeURIComponent(hit[1]));
  return isNaN(when.getTime()) ? null : when;
}

// The calendar day in Copenhagen, because that is the day DR files a broadcast
// under -- a concert starting at 00:30 local belongs to that date and not to
// the one UTC would name.
function copenhagenDay(when) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

// DR's build id, scraped because it changes with every deploy of theirs. Held
// for the length of one resolver run; a week of broadcasts is one run.
let buildIdCache = null;

async function buildId() {
  if (buildIdCache) return buildIdCache;
  const answer = await fetch(DR_BASE + "/lyd/oversigt");
  const html = await answer.text();
  const hit = /"buildId":"([^"]+)"/.exec(html);
  if (!hit) {
    throw new Error(
      "dr-lyd-series: no buildId in /lyd/oversigt -- DR LYD has changed its build"
    );
  }
  buildIdCache = hit[1];
  return buildIdCache;
}

// One day of one channel. The plain document URL answers 404; as an XHR with
// x-nextjs-data it answers JSON. The /da/ locale segment and both query
// parameters are required -- worked out for the collection and carried over
// here unchanged, because guessing at it again would be a second chance to get
// it wrong.
async function scheduleFor(day, channelSlug) {
  const url =
    DR_BASE + "/lyd/_next/data/" + (await buildId()) + "/da/oversigt/" + day +
    ".json?channelSlug=oversigt&seriesSlug=" + day;
  const answer = await fetch(url, { headers: { "x-nextjs-data": "1" } });
  if (!answer.ok) return [];
  const payload = await answer.json();
  const schedules =
    (payload && payload.pageProps && payload.pageProps.schedules) || [];
  const channel = schedules.find(function (entry) {
    return entry && entry.channel && entry.channel.slug === channelSlug;
  });
  return (channel && channel.items) || [];
}

// How many segments a /lyd/ address has. Two is a series, four an episode.
function segmentsOf(url) {
  const tail = String(url || "").split("/lyd/")[1];
  return tail ? tail.replace(/\/$/, "").split("/").length : 0;
}

function nearest(items, when) {
  let best = null;
  let bestGap = Infinity;
  for (const item of items) {
    const start = new Date(item && item.startTime);
    if (isNaN(start.getTime())) continue;
    const gap = Math.abs(start.getTime() - when.getTime());
    if (gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  }
  return bestGap <= SLACK_MS ? best : null;
}

async function extract(url) {
  const hit = SERIES_RE.exec(withoutFragment(url));
  if (!hit) throw new Error("dr-lyd-series: URL does not match: " + url);

  const channelSlug = hit[1];
  const page = withoutFragment(url);

  const when = wantedFrom(url);
  if (!when) {
    throw unsupported(
      "This is a programme of DR LYD, not one broadcast, and the address does " +
        "not say which date is meant. Share the concert from the " +
        "Konzertfuehrer, which knows it. Its archive: " + page,
      page
    );
  }

  const day = copenhagenDay(when);
  const items = await scheduleFor(day, channelSlug);

  if (!items.length) {
    throw unsupported(
      "DR's schedule holds no broadcasts for " + day + " on " + channelSlug +
        ". It reaches about seven days back, so a broadcast older than that " +
        "cannot be looked up any more even when the recording is still there. " +
        "Its archive: " + page,
      page
    );
  }

  const found = nearest(items, when);
  if (!found) {
    throw unsupported(
      "DR broadcast nothing at this time on " + day + ". Either the programme " +
        "did not run, or it was moved. Its archive: " + page,
      page
    );
  }

  if (segmentsOf(found.presentationUrl) < 3) {
    throw unsupported(
      "DR has not published a recording of this broadcast. Its schedule still " +
        "points at the programme rather than at an episode, which is what it " +
        "does before a broadcast and where nothing is released afterwards. " +
        "Its archive: " + page,
      page,
      // Not settled: the sentence above says so itself -- "before a
      // broadcast" is a state that ends. See isSettled in lib/rows.js.
      { retryable: true }
    );
  }

  const result = await archive.extract(found.presentationUrl);
  // The episode that was found, not the programme that was shared -- so a
  // second listen needs no lookup, which matters here more than elsewhere:
  // after seven days there is no lookup left to do.
  return Object.assign({}, result, { sourceUrl: found.presentationUrl });
}

module.exports = { match, extract };
module.exports.segmentsOf = segmentsOf;
module.exports.copenhagenDay = copenhagenDay;
