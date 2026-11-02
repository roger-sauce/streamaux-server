"use strict";

// adapters/polskieradio-series.js
//
// The step the Konzertfuehrer leaves open for Dwojka, and the reason it has to
// be taken here rather than in the collection.
//
// Polskie Radio's schedule names no address per broadcast. It answers
// startTime, stopTime, title, lead, categoryId, hostPhoto, isOnAir -- and that
// is the whole of it. Since 01.09.2026 the collection therefore stores the
// address of the SERIES, which categoryId gives it for free:
//
//   https://www.polskieradio.pl/8/5343
//     -> https://www.polskieradio.pl/dwojka/audycje/letni-festiwal-muzyczny,5343
//
// What it cannot store is the recording, because at collection time there is
// none. Dwojka publishes its concerts as ARTICLES, and the article appears at
// broadcast time -- the collection runs on Monday for the week ahead, so it
// looks for something that will not exist for another six days. Tried on
// 01.09.2026 from inside the collector: two of twenty-five, both of them days
// already past.
//
// This adapter runs afterwards, when the article is there.
//
// WHAT IT DOES
//
// The series is READ from the address, never searched for: the collection
// already knew it and put it in the URL. Only the edition is looked up, by the
// day in the #kg= fragment, through the one route that lists a series'
// articles:
//
//   /v4/Article/GetListByCategoryId?categoryId=<id>&PageSize=50
//
// The article's datePublic is the broadcast to the minute -- an edition titled
// "godz. 05:00" is published at 04:59. From there polskieradio-archive.js takes
// over, which reads the recording out of the article page and knows what to do
// when an article holds several.
//
// WHAT IT NEEDS, AND WHAT IT DOES WITHOUT
//
// That route wants an x-api-key: six of six categories answered 401 without
// one (measured 01.09.2026). The key is not a personal credential -- it comes
// out of the polskieradio24.pl frontend bundle and sits in every visitor's
// browser -- but it is a second copy of a secret on a second machine, and it
// rotates. It lives in apps/autoplay-pi/.env as PR_API_KEY.
//
// Without it, and on 401, this does not fail: it refuses by name and hands
// back the series address, which is exactly the behaviour of the day before it
// was written. A missing key costs the recording, not the answer.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, unsupported } = require("./_shared");
const archive = require("./polskieradio-archive");
// The second route to an edition, added 16.09.2026: the episode list the
// series page carries for itself. See polskieradio-episodes.js for why the
// articles alone were not enough -- three series were written up as dead on
// the strength of one channel, and all three are on the air.
const episodes = require("./polskieradio-episodes");
/* The verdict, shared with RTVE, Rai and RTE since 17.09.2026.
 *
 * Roger: "polskie radio anschliessen." Dwojka is where the "airs, and no
 * archive" category was found -- Fantazja polska's editions stop on
 * 2024-04-19, Muzyczna Noc Euroradia has no episode page at all -- and it was
 * the one day-lookup still answering `retryable: true` to all of them, so
 * thirty-two hopeless rows a week were asked seven times each.
 *
 * The days come from BOTH channels here, which is the only difference from the
 * other three: a strand that publishes articles and one that publishes
 * episodes are equally alive, and a cadence read from one of them alone would
 * call the other one dead.
 */
const { declineOf, saysOf } = require("./_series-page-resolver");

// The short form the collection writes, /8/5343, and the canonical page it
// redirects to. Both end after the id -- without that the first would also
// swallow /8/8820/Artykul/3295254, which belongs to the archive adapter.
const SHORT_RE =
  /^https?:\/\/(?:www\.)?polskieradio\.pl\/\d+\/(\d+)\/?(?:[?#]|$)/i;
const PAGE_RE =
  /^https?:\/\/(?:www\.)?polskieradio\.pl\/[a-z0-9-]+\/audycje\/[^/]*,(\d+)\/?(?:[?#]|$)/i;

const API =
  "https://api-gateway.polskieradio.pl/v4/Article/GetListByCategoryId";
// Fifty is what one request returns, and all it can: the API takes PageSize
// but ignores Page. For a series that publishes daily that is seven weeks
// back, and the resolver run follows the collection by days.
//
// So the length of what comes back is NOT the size of the archive -- series
// 390 holds 7087 articles and answers fifty of them. Nothing here reports that
// number as a count of anything; a refusal names the newest article's date,
// which is the fact that matters and one this page really does establish.
const PAGE_SIZE = 50;

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

function fragmentOf(url) {
  const at = String(url || "").indexOf("#");
  return at < 0 ? "" : String(url).slice(at);
}

function categoryOf(url) {
  const bare = withoutFragment(url);
  const hit = SHORT_RE.exec(bare) || PAGE_RE.exec(bare);
  return hit ? hit[1] : null;
}

function match(url) {
  return categoryOf(url) !== null;
}

// The articles of one series, newest first -- or null when we cannot ask.
//
// null and [] are deliberately different answers: [] means the series has
// published nothing (Muzyczna Noc Euroradia has not since September 2022),
// null means the door was shut in our face and the reader deserves to be told
// which of the two it was.
async function articlesOf(categoryId) {
  const key = process.env.PR_API_KEY || "";
  if (!key) return null;

  const answer = await fetch(
    API + "?categoryId=" + categoryId + "&PageSize=" + PAGE_SIZE,
    {
      headers: {
        "x-api-key": key,
        Accept: "*/*",
        Origin: "https://polskieradio24.pl",
        Referer: "https://polskieradio24.pl/",
      },
    }
  );
  if (answer.status === 401 || answer.status === 403) return null;
  if (!answer.ok) {
    throw new Error(
      "polskieradio-series: the article list of series " + categoryId +
        " answered HTTP " + answer.status
    );
  }
  const payload = await answer.json();
  return Array.isArray(payload && payload.data) ? payload.data : [];
}

// Minutes since midnight out of "HH:MM". datePublic is Warsaw wall clock
// without a zone, and so is the broadcast time the fragment carries once
// wantedFrom() has put it into Warsaw -- so they are compared as written.
function minutesOf(hhmm) {
  const h = Number(String(hhmm).slice(0, 2));
  const m = Number(String(hhmm).slice(3, 5));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function articleFor(articles, wanted) {
  let best = null;
  let bestGap = Infinity;
  for (const article of articles) {
    const stamp = String(article && article.datePublic ? article.datePublic : "");
    if (stamp.slice(0, 10) !== wanted.day) continue;
    const gap = Math.abs(minutesOf(stamp.slice(11, 16)) - wanted.minutes);
    if (gap < bestGap) {
      best = article;
      bestGap = gap;
    }
  }
  return best;
}

async function extract(url) {
  const categoryId = categoryOf(url);
  if (!categoryId) {
    throw new Error("polskieradio-series: URL does not match: " + url);
  }
  const page = withoutFragment(url);

  const wanted = archive.wantedFrom(url);
  if (!wanted) {
    throw unsupported(
      "This is the series page of a Dwojka programme, not one broadcast, and " +
        "the address does not say which date is meant. Share the concert from " +
        "the Konzertfuehrer, which knows it. Its archive: " + page,
      page
    );
  }

  const articles = await articlesOf(categoryId);

  // A missing key used to end it here. It no longer does: the episode list is
  // read off the page and needs no key, so a machine without PR_API_KEY can
  // still answer. The refusal below says which of the two was unavailable.

  const found = articles ? articleFor(articles, wanted) : null;

  /* No article -- then the episode list, before anything is refused.
   *
   * A series can publish one, the other, or neither, and which it does is not
   * a property of the series that anybody could look up. Fantazja polska has
   * ten episodes and no article since April 2024; Filharmonia Dwojki has both.
   * So both are asked, and only the silence of both is a refusal.
   *
   * This route needs no API key, which is why it is tried even where
   * `articles` came back null.
   */
  if (!found || !found.url) {
    const html = await fetchHtml(page);
    const list = episodes.parseEpisodes(html);
    const episode = episodes.episodeFor(list, wanted);
    const sound = episodes.soundOf(episode);
    if (sound) {
      const title = (episode.title || "").trim() || "Polskie Radio";
      return {
        title: title,
        sourceType: "polskieradio",
        artist: (episode.station || "").trim() || null,
        tracks: [{ title: title, streamUrl: sound }],
        // Dwojka gives no marks inside a broadcast.
        tracklist: [],
        // The edition's own page where the markup names it, the series page
        // otherwise -- true rather than convenient. See episodePageFor.
        sourceUrl: episodes.episodePageFor(html, sound) || page,
      };
    }

    // Both channels' days, because both count as published. See the note on
    // the require of declineOf at the top of this file.
    const days = [
      ...(articles || []).map(function (a) { return String(a.datePublic || "").slice(0, 10); }),
      ...list.map(function (e) { return String(e.date || "").slice(0, 10); }),
    ].filter(function (day) { return /^\d{4}-\d{2}-\d{2}$/.test(day); });
    const verdict = declineOf(days, wanted.day);

    throw unsupported(
      "Polskie Radio has no edition of this programme for " + wanted.day + ". " +
        saysOf(verdict.declined) +
        ". Its articles: " +
        (articles
          ? (articles.length
              ? "newest " + String(articles[0].datePublic || "").slice(0, 10)
              : "none at all")
          : "could not be asked, no PR_API_KEY") +
        ". Its episodes: " +
        (list.length
          ? list.length + ", newest " + String((list[0] || {}).date || "").slice(0, 10)
          : "none") +
        ". Its archive: " + page,
      page,
      { declined: verdict.declined, retryable: verdict.retryable }
    );
  }

  // The fragment travels on. An article can hold several recordings -- three
  // "Nocna Strefa" nights in one piece is a real case -- and the archive
  // adapter needs the same date to tell them apart.
  const result = await archive.extract(found.url + fragmentOf(url));

  // The edition that was found, not the series page that was shared: this
  // becomes what the app links to and what the history stores, so a second
  // listen needs no lookup at all.
  return Object.assign({}, result, { sourceUrl: found.url });
}

module.exports = { match, extract };
module.exports.categoryOf = categoryOf;
module.exports.articleFor = articleFor;
