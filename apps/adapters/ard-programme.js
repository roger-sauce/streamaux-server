"use strict";

// adapters/ard-programme.js -- from an ARD station's programme page to the
// recording in the ARD Audiothek.
//
// The konzert-guide stores the ANNOUNCEMENT: a programme page at the station.
// The recording lives in the Audiothek under a wholly unrelated address. In
// between sits the work done by hand until now -- read the title off the
// station page, search the Audiothek, copy the episode address.
//
// Measured on 17.08.2026 against 38 concerts from five ARD stations, and the
// findings shaped every decision below:
//
//   * The programme page does NOT link the episode. Checked on BR, WDR, SWR
//     and hr2, on past broadcasts too. Scraping a link out is not an option.
//   * Titles do not match. The guide knows the SLOT ("ARD Radiofestival 2026.
//     Jazz"), the Audiothek the EPISODE ("Rund um Tony Bennett"). What does
//     correspond is the slot against `programSet.title`, and only roughly --
//     full stop against colon, with and without the year.
//   * The publication timestamp is NOT the transmission time. Offsets for one
//     evening: 0, 14, 127 and 193 minutes. It coincided only for the
//     Radiofestival Jazz, which is fed in live -- and that one coincidence
//     made a broken rule look like a working one for a whole afternoon.
//   * What DOES carry the transmission is the episode's own title, in prose:
//     "Mittagskonzert vom 14.08. um 13:05 Uhr". 104 of 135 items in a week
//     carry it, and all 135 carry a duration.
//   * A plain item search is not enough. With `limit=40` over a series of 72
//     episodes the wanted one simply is not in the answer -- which showed up
//     as neighbours exactly one, two and three days off.
//
// Hence two steps. The search decides the SERIES; the full episode list of
// that series is then enumerated and every item WEIGHED -- see
// _archive-match.js, which holds the scoring and is shared with every other
// house. Deciding is not this file's business, only fetching is.
//
// A series turns out to cover exactly seven days (135 items, 11.08. to
// 18.08.), which is also the longest the Konzertfuehrer ever offers. Two pages
// of a hundred reach the whole window.
//
// Both the time and the title arrive in the URL fragment, and there is no
// fallback for their absence. That is not laziness but the shape of the two
// cases that exist, settled on 17.08.2026:
//
//   1. A concert is seen in the Konzertfuehrer and was missed. The app then
//      supplies both -- and never anything older than a week, because
//      schedule.json is rewritten every Monday and keeps no history.
//   2. A missed concert is heard of elsewhere and looked up in the archive by
//      hand. What is found there is the EPISODE address, which ard-audiothek
//      and its neighbours have always taken directly. This adapter is not
//      involved.
//
// So nothing here ever reads a station page. Which also removes the most
// fragile part: page structure changes, an API contract far less often.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const ardAudiothek = require("./ard-audiothek");
const weigh = require("./_archive-match");

const API = "https://api.ardaudiothek.de/";

// A series holds about a week. Three pages of a hundred are more than enough,
// and the walk stops early anyway once it is past the day in question.
const PAGE = 100;
const MAX_PAGES = 3;

// How far past the broadcast to keep reading before giving up. A day and a
// half, because a series is ordered by PUBLICATION and a recording posted
// three hours late sits among the next day's items.
const OVERSHOOT_SECONDS = 36 * 3600;

const STATIONS = [
  {
    id: "br-klassik",
    service: "BR Klassik",
    label: "BR-KLASSIK",
    matchRe: /^https?:\/\/(?:www\.)?br-klassik\.de\/programm\/[^?#]*\.html/i,
  },
  {
    id: "wdr3",
    service: "WDR 3",
    label: "WDR 3",
    matchRe: /^https?:\/\/(?:www\d?\.)?wdr\.de\/programmvorschau\/wdr3\//i,
  },
  {
    id: "swr-kultur",
    service: "SWR Kultur",
    label: "SWR Kultur",
    // Two paths, and the second one was found by counting rather than by
    // reading: of 265 concerts in the guide's week of 26.08.2026, exactly one
    // SWR entry did not point at the programme calendar but at an editorial
    // page -- "/kultur/musik/me-and-my-music-andreas-schaerer-jazz-...html".
    // The SWR had linked it that way, the guide passed it on faithfully, and
    // here it fell to the LIVE station adapter, whose match covers swr.de
    // broadly. The listener got "this is not the SWR Kultur livestream",
    // which is true and beside the point.
    //
    // The live page itself (swr.de/swrkultur, /swrkultur/index.html) matches
    // neither alternative, so it still reaches the station adapter.
    matchRe: /^https?:\/\/(?:www\.)?swr\.de\/(?:swrkultur\/programm\/|kultur\/musik\/)/i,
  },
  {
    id: "hr2",
    service: "hr2-kultur",
    label: "hr2-kultur",
    matchRe: /^https?:\/\/(?:www\.)?hr2\.de\/programm\//i,
  },
  /* The two rbb services, added 09.09.2026.
   *
   * They were missing for no reason anybody wrote down -- rbb only joined the
   * guide on 03.09.2026, and this list was not looked at again. The service
   * names are measured, not guessed: a search for "Odd Beholder" answers with
   * `publicationService.title` "radioeins", one for "Eine grosse Nachtmusik"
   * with "radio3". Both are exactly the strings this file filters on.
   *
   * What they are FOR is narrower than the four above. radiodrei.de and
   * radioeins.de programme pages go to rbb-archive.js first, because rbb shows
   * the file itself and taking it is deterministic where searching is not --
   * the Audiothek search is what produced 33 wrong recordings on 07.09.2026.
   * These entries exist so that rbb-archive can HAND OVER when the station's
   * own page carries nothing, which is the case for every ARD Radiofestival
   * takeover: rbb airs it, another house produced it and files it.
   *
   * "radio3" is already in FEEDS below, so the rolling feed was being walked
   * for these broadcasts all along -- there was simply no station entry to let
   * the adapter claim the address in the first place.
   */
  {
    id: "rbb3",
    service: "radio3",
    label: "radio3 (rbb)",
    matchRe: /^https?:\/\/(?:www\.)?(?:radiodrei|radio3)\.de\/programm\//i,
  },
  {
    id: "radioeins",
    service: "radioeins",
    label: "radioeins",
    matchRe: /^https?:\/\/(?:www\.)?radioeins\.de\/(?:programm|musik|themen)\//i,
  },
];

// The rolling feeds, always read, never searched for.
//
// A takeover carries the SLOT name of the airing station and nothing else --
// "WDR 3 Lunchkonzert" does not occur anywhere in the archive, because the
// recording is filed as "Mittagskonzert vom 17.08. um 13:05 Uhr" under SWR
// Kultur. No search for the slot name can find that, and on 18.08.2026 the
// attempt returned "WDR 2 Frag dich fit", having matched on the word "WDR".
//
// What does find it is the clock, and the clock can only be used against a
// LIST. Each of these services keeps one programSet named exactly like itself,
// holding about a week of everything it published -- which is also the longest
// the Konzertfuehrer ever offers. So they are all walked, every time,
// regardless of the title. Whichever house cut the recording, it is in one of
// them.
const FEEDS = ["BR Klassik", "WDR 3", "SWR Kultur", "hr2-kultur", "radio3", "ARD"];

// Found once per process. The ids do not change between two concerts.
const feedCache = Object.create(null);

const TIME_RE = /[#&]kg=([^&]+)/i;
const TITLE_RE = /[#&]kgt=([^&]+)/i;
const LENGTH_RE = /[#&]kgd=(\d+)/i;

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function stationFor(url) {
  const bare = withoutFragment(url);
  return STATIONS.find(function (station) { return station.matchRe.test(bare); }) || null;
}

function fragmentValue(url, pattern) {
  const hit = pattern.exec(String(url || ""));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit[1].replace(/\+/g, " "));
  } catch (e) {
    return hit[1];
  }
}

async function getJson(url) {
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("ard-programme-adapter: unreadable answer from " + url);
  }
}

// Which series to look in.
//
// Ranked by HOW MANY of the search's hits came from a series -- that is the
// relevance the search itself already expressed, and throwing it away was the
// mistake of 18.08.2026. Ranking by wording instead lost every takeover: a
// station's rolling feed is called "SWR Kultur" and shares no word with "ARD
// Radiofestival. Konzert", so it scored zero and was dropped -- while holding
// exactly the recording, because joint productions are filed under whichever
// house cut them.
//
// Wording and station stay on as tie-breakers, never as gates.
function collect(nodes, station, query, into) {
  for (const node of nodes || []) {
    const set = (node && node.programSet) || node;
    if (!set || !set.id) continue;
    const service = ((set.publicationService || {}).title) || "";
    const key = String(set.id);
    const seen = into[key];
    if (seen) {
      seen.hits += 1;
      seen.rank += 1;
      continue;
    }
    let rank = 1 + weigh.overlap(query, set.title || "");
    if (service === station.service) rank += 0.5;
    else if (service === "ARD") rank += 0.25;
    into[key] = { id: key, title: set.title || "", service: service, rank: rank, hits: 1 };
  }
}

// Stage one, one request. The search hits are candidates in their own right --
// often the answer is already among them -- and the series they belong to are
// noted on the way past, so the next stage needs no request to work out where
// to look.
async function searchItems(query, station, into) {
  const answer = await getJson(
    API + "search/items?query=" + encodeURIComponent(query) + "&limit=40"
  );
  const nodes = (((answer.data || {}).search || {}).items || {}).nodes || [];
  collect(nodes, station, query, into);
  return nodes.map(function (node) {
    const set = node.programSet || {};
    return asItem(node, {
      title: set.title || "",
      service: ((set.publicationService || {}).title) || "",
    });
  });
}

/* The same slot name, asked for a second time without its article.
 *
 * MEASURED, 08.09.2026, and it is the whole of the ARD Nachtkonzert fault. WDR
 * 3 calls the slot "Das ARD Nachtkonzert" and the guide passes that through as
 * `kgt=`. Against the Audiothek search the leading word costs everything:
 *
 *     "Das ARD Nachtkonzert"   ->   4 items, not one of them a Nachtkonzert
 *     "ARD Nachtkonzert"       ->  26 items, every segment of every night
 *
 * With the four, nothing scores, `weigh.similar()` takes over as designed, and
 * the only thing matching on wording is a four-minute SWR2 piece ABOUT the
 * series -- which then answered ten Nachtkonzerte of one week. The scorer and
 * the date rule were never at fault; they were never given anything to judge.
 *
 * Only the definite article, and only as a SECOND attempt. Trimming the query
 * up front would throw away a word that is part of some titles for real, and
 * asking twice costs one request on the entries that found nothing anyway --
 * before the two expensive stages below, not after.
 */
const LEADING_ARTICLE = /^\s*(das|der|die)\s+/i;

function withoutArticle(text) {
  return String(text || "").replace(LEADING_ARTICLE, "").trim();
}

/* Whole days between two "TT.MM." as the German archive writes them.
 *
 * The titles carry no year -- "vom 05.09. um 00:03 Uhr" -- so it comes from
 * the broadcast being asked about. A night that runs over New Year would
 * otherwise read as 364 days apart instead of one, hence the correction: a gap
 * of more than half a year is a year boundary, not a distance.
 */
function daysBetween(fromDay, toDay, when) {
  const parse = (text) => {
    const hit = /^(\d{1,2})\.(\d{1,2})\.$/.exec(String(text || ""));
    return hit ? { day: Number(hit[1]), month: Number(hit[2]) } : null;
  };
  const a = parse(fromDay);
  const b = parse(toDay);
  if (!a || !b) return null;
  const year = when.getUTCFullYear();
  const first = Date.UTC(year, a.month - 1, a.day);
  let other = Date.UTC(year, b.month - 1, b.day);
  const days = Math.round((other - first) / 86400000);
  if (days > 182) return days - 365;
  if (days < -182) return days + 365;
  return days;
}

/* Every episode that STARTS inside the broadcast that was asked about.
 *
 * WHY (Roger, 08.09.2026). The ARD Nachtkonzert is one entry in the guide and
 * four recordings in the archive: 00:03, 02:03, 04:03, 05:03, together 348
 * minutes of music and three minutes of news on each hour -- exactly the 357
 * the guide records. The scorer answers correctly and answers with ONE of the
 * four, because the other three are two, four and five hours off the requested
 * minute and the clock rule refuses them, rightly. Refusing them as THE
 * broadcast and collecting them as its PARTS are different questions.
 *
 * So: same day-and-clock arithmetic as the scorer, but asking whether the
 * episode begins inside [start, start + duration) rather than at the start.
 * The wording gate is the one the scorer already uses for its weak point --
 * without it a window six hours wide would sweep up whatever else the search
 * happened to return.
 *
 * Only where the request is long enough to hold more than one. A concert of an
 * hour has no parts, and a rule that fires there would turn one right answer
 * into two.
 */
function partsWithin(items, want, when) {
  if (!want.durationSeconds) return [];
  const windowMinutes = want.durationSeconds / 60;
  const found = [];
  // The wording, read off whichever of the two carries it. MEASURED,
  // 08.09.2026: `seriesTitle` is the publication service -- every Nachtkonzert
  // segment comes back with "SWR Kultur" there -- so `seriesTitle || title`
  // scored 0.00 against "Das ARD Nachtkonzert" and the gate kept out exactly
  // the parts it was meant to collect. The name of the broadcast is in the
  // episode title, "ARD-Nachtkonzert vom 05.09. um 00:03 Uhr".
  //
  // Without the article on our side as well: the whole reason this adapter
  // asks twice is that "Das" is ours and not the archive's.
  const slot = withoutArticle(want.slot) || want.slot;
  for (const item of items) {
    if (!item || !item.url) continue;
    const wording = Math.max(
      weigh.overlap(slot, item.title || ""),
      weigh.overlap(slot, item.seriesTitle || "")
    );
    if (wording < 0.5) continue;
    const named = weigh.dateInText(item.title) || weigh.dateInText(item.synopsis);
    if (!named) continue;
    const offset = daysBetween(want.day, named.day, when);
    if (offset === null) continue;
    const startsAt = offset * 1440 + named.minutes - want.minutes;
    if (startsAt < 0 || startsAt >= windowMinutes) continue;
    found.push({ at: startsAt, item: item });
  }
  found.sort((a, b) => a.at - b.at);
  // Two spellings of one episode can both come back from two searches.
  const seen = new Set();
  return found.filter((one) => {
    const key = String(one.item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankSeries(found) {
  return Object.keys(found)
    .map(function (key) { return found[key]; })
    .sort(function (a, b) { return b.rank - a.rank; });
}

// The programSet a service keeps under its own name. Recognised by both names
// being equal, which is what tells the rolling feed from an ordinary series
// that merely mentions the station.
async function feedSeries() {
  const out = [];
  for (const service of FEEDS) {
    if (feedCache[service] === undefined) {
      feedCache[service] = null;
      try {
        const answer = await getJson(
          API + "search/programsets?query=" + encodeURIComponent(service) + "&limit=10"
        );
        const nodes = (((answer.data || {}).search || {}).programSets || {}).nodes || [];
        const feed = nodes.find(function (set) {
          return (set.title || "") === service &&
                 (((set.publicationService || {}).title) || "") === service;
        });
        if (feed) feedCache[service] = { id: String(feed.id), title: feed.title, service: service, rank: 0 };
      } catch (e) {
        // A feed that cannot be looked up costs coverage, not correctness.
      }
    }
    if (feedCache[service]) out.push(feedCache[service]);
  }
  return out;
}

function asItem(node, series) {
  return {
    title: node.title || "",
    synopsis: node.synopsis || "",
    publishedAt: node.publicationStartDateAndTime ? new Date(node.publicationStartDateAndTime) : null,
    durationSeconds: Number(node.duration) || null,
    service: series.service,
    seriesTitle: series.title,
    url: node.sharingUrl || "",
  };
}

// Walks a series newest first and stops as soon as it is safely past the day
// in question -- usually after one page.
async function itemsAround(series, when) {
  const out = [];
  const floor = when.getTime() - OVERSHOOT_SECONDS * 1000;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await getJson(
      API + "programsets/" + series.id + "?limit=" + PAGE + "&offset=" + page * PAGE + "&order=desc"
    );
    const nodes = ((((answer.data || {}).programSet || {}).items) || {}).nodes || [];
    if (!nodes.length) break;
    for (const node of nodes) out.push(asItem(node, series));
    const last = nodes[nodes.length - 1].publicationStartDateAndTime;
    if (last && new Date(last).getTime() < floor) break;
  }
  return out;
}

function match(url) {
  return stationFor(url) !== null;
}

async function extract(url) {
  const station = stationFor(url);
  if (!station) throw new Error("ard-programme-adapter: URL does not match: " + url);

  const stamp = fragmentValue(url, TIME_RE);
  const when = stamp ? new Date(stamp) : null;
  if (!when || isNaN(when.getTime())) {
    throw new Error(
      "This is a programme page from " + station.label + ". Which broadcast is meant " +
      "is not in the address -- share the concert from the Konzertfuehrer, which knows " +
      "the time, or look the episode up in the ARD Audiothek (ardsounds.de) and share that."
    );
  }

  const query = fragmentValue(url, TITLE_RE);
  if (!query) {
    throw new Error(
      "This is a programme page from " + station.label + " and carries no title to " +
      "search the ARD Audiothek with. Share the concert from the Konzertfuehrer, which " +
      "sends one -- or look the episode up in the ARD Audiothek and share that address."
    );
  }

  const minutes = Number(fragmentValue(url, LENGTH_RE)) || 0;
  const want = weigh.target(when, "Europe/Berlin", {
    durationSeconds: minutes ? minutes * 60 : null,
    slot: query,
    service: station.service,
  });

  // Three stages, cheapest first, each stopping the moment it is sure.
  //
  // "Sure" means the winning item names the broadcast in its own title. An
  // episode calling itself "Mittagskonzert vom 17.08. um 13:05 Uhr" will not
  // be improved on by reading six more lists, and a concert is normally looked
  // up one at a time -- paying twenty requests for an answer the first one
  // already held is a bad trade.
  //
  //   1  the search itself                one request
//   1b the same, without the article      one more, and only where 1 failed
  //   2  the series behind those hits     a few more
  //   3  the rolling feeds                expensive, and the only way to find
  //                                       a slot name that exists nowhere in
  //                                       the archive -- see FEEDS
  const found = Object.create(null);
  let all = await searchItems(query, station, found);
  let winner = weigh.best(all, want);
  let series = rankSeries(found).slice(0, 3);

  // Stage 1b: the same question with the article dropped. See withoutArticle.
  const plain = withoutArticle(query);
  if ((!winner || !winner.verdict.strong) && plain && plain !== query) {
    all = all.concat(await searchItems(plain, station, found));
    winner = weigh.best(all, want);
    series = rankSeries(found).slice(0, 3);
  }

  if (!winner || !winner.verdict.strong) {
    for (const candidate of series) {
      all = all.concat(await itemsAround(candidate, when));
    }
    winner = weigh.best(all, want);
  }

  if (!winner || !winner.verdict.strong) {
    for (const feed of await feedSeries()) {
      if (found[feed.id]) continue;
      series = series.concat([feed]);
      all = all.concat(await itemsAround(feed, when));
    }
    winner = weigh.best(all, want);
  }

  if (winner) winner = await richerTwin(winner, want, station);

  if (winner && winner.item.url) {
    // A broadcast that the archive keeps in parts. See partsWithin: the winner
    // is one of them and the others are not wrong, they are the rest of the
    // night. Fetched in order and handed over as one answer, which is what a
    // track list is for -- Roon plays it through.
    const parts = partsWithin(all, want, when);
    if (parts.length > 1) {
      const pieces = [];
      let first = null;
      for (const part of parts) {
        const one = await ardAudiothek.extract(part.item.url);
        if (!first) first = { result: one, url: part.item.url };
        for (const track of (one && one.tracks) || []) pieces.push(track);
      }
      if (pieces.length) {
        return Object.assign({}, first.result, {
          tracks: pieces,
          // Named for the whole rather than for its first part. "vom 05.09. um
          // 00:03 Uhr" on a six-hour night would be true of one track and
          // wrong about the answer.
          title: want.slot + " vom " + want.day + " (" + parts.length + " Teile)",
          parts: parts.length,
          sourceUrl: first.url,
        });
      }
    }

    const result = await ardAudiothek.extract(winner.item.url);
    // Where the recording actually lives, which is never the address that was
    // shared. server.js keeps this as the source of what is playing, so the
    // app's link leads to the episode rather than back to the announcement --
    // and the history entry points at something that plays without resolving
    // again.
    return Object.assign({}, result, { sourceUrl: winner.item.url });
  }

  // Nothing for this transmission. Before giving up, ask the other question:
  // is the same CONTENT in there under another date? A festival concert aired
  // on hr2 in July can be a WDR recording from March, and for a listener who
  // wanted the music that is the right answer -- as long as he is told.
  const near = weigh.similar(all, want);
  if (near && near.item.url) {
    const result = await ardAudiothek.extract(near.item.url);
    return Object.assign({}, result, {
      title: (result.title || near.item.title) + labelFor(near.item),
      suggestion: true,
      sourceUrl: near.item.url,
    });
  }

  // A refusal that only says no is half an answer -- the same rule the live
  // adapters follow. What is offered here is deliberately NOT played: these
  // are the nearest things in the same series, named with their addresses so
  // they can be looked at and, if one of them is it, pasted straight in.
  const nearby = weigh.ranked(all, want, 3);
  if (nearby.length) {
    throw new Error(
      "No recording of this broadcast in the ARD Audiothek. Similar, but NOT this " +
      "concert: " +
      nearby.map(function (n) { return "\"" + n.item.title + "\" -> " + n.item.url; }).join("  |  ")
    );
  }

  // The count is worth keeping -- it separates "searched nothing" from
  // "searched a lot and it is not there". The series NAMES are not: they read
  // as recommendations and are none.
  throw new Error(
    "No recording of this broadcast in the ARD Audiothek, and nothing similar " +
    "either. " + all.length + " episodes weighed. Concert and opera broadcasts " +
    "are often kept out for rights reasons."
  );
}

// One more question, once a winner is known: is the same broadcast in there a
// second time, told better?
//
// It is, regularly. The Lex Korten portrait of 17.08.2026 sat in the series
// "ARD Radiofestival: Jazz" with 185 characters of text, and a SECOND time
// elsewhere with the full description and the setlist -- and the series listing
// held only the poorer one. Which of the two was found came down to the wording
// a station happened to announce with: hr2 names the episode and reached the
// rich entry through the search, BR names the slot and reached only the series.
//
// So the winner's own title is searched with. That is the wording hr2 got right
// by accident, used on purpose. It costs one request, runs only when there is
// already something to improve on, and can only swap in an entry that answers
// the same evidence with more to show -- ard-audiothek.js reads its tracklist
// out of exactly that text, so "more" means a running order the listener can
// tap instead of an empty list.
async function richerTwin(winner, want, station) {
  const title = winner.item.title;
  if (!title) return winner;
  let twins = [];
  try {
    twins = await searchItems(title, station, Object.create(null));
  } catch (e) {
    return winner;
  }
  return weigh.best(twins.concat([winner.item]), want) || winner;
}

// What the title says when a suggestion is handed back instead of the
// broadcast itself. The date goes in the title because that is the one field
// every screen in the chain already shows -- a listener who taps a Friday
// concert and gets a March recording must be able to see it without asking.
function labelFor(item) {
  if (!item.publishedAt) return " (andere Aufnahme)";
  const day = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(item.publishedAt);
  return " (Aufnahme vom " + day + ")";
}

module.exports = { match, extract };
module.exports.internals = {
  searchItems, itemsAround, feedSeries, STATIONS,
  // Pure, and checked in apps/checks/ard-programme.test.js. Exported
  // rather than read out of the source: this file is a module and has no
  // reason to make a checker work for it.
  withoutArticle, daysBetween, partsWithin,
};
