"use strict";

// adapters/rtve-series.js -- the series-page pattern (see
// _series-page-resolver.js), for RNE Radio 3 and RNE Radio Clasica alike.
//
// The konzert-guide stores addresses like
//
//   https://www.rtve.es/play/audios/noches-en-los-jardines/
//
// which is the series, not the night. This finds the night.
//
// HOW IT USED TO WORK, AND WHY IT DOES NOT ANY MORE (31.08.2026)
//
// Until today the editions were read out of the page's own links, and the
// date out of the link itself:
//
//   /play/audios/noches-en-los-jardines/abandono-30-07-26/17175147/
//                                                ^^^^^^^^
// DD-MM-YY, Spanish order. It worked for months and it was wrong all along,
// because that segment is typed by an editor. On 28.08.2026 RNE published
//
//   /play/audios/noches-en-los-jardines/conciliando-sueno-verano-28-07-26/17205563/
//
// -- July in the slug, August on the page. The July name had been copied from
// an earlier edition. Two consequences, and the second is the bad one:
//
//   * we did not find the broadcast, although it was there
//   * had the guide asked for the 28th of JULY, we would have handed over the
//     August recording without a murmur. A wrong concert plays perfectly, and
//     the mistake is only ever noticed by the sound.
//
// The proof needs no page: sort the twenty editions by their numeric id and
// the dates run in order, 17172485 (28.07.) through 17203155 (26.08.) -- with
// exactly one out of place, 17205563, which claims to precede all of them.
//
// Reading the date from the LIST instead is impossible: the browser renders it
// with JavaScript, and the string "28/08/2026" appears nowhere in the HTML
// that RTVE serves. That road leads back to a browser, which the collection
// spent a week getting rid of.
//
// WHAT IT DOES NOW
//
// The page names RTVE's own API, and the API answers properly:
//
//   https://www.rtve.es/api/programas/131354/audios
//
//   "dateOfEmission":  "28-08-2026 23:00:00"   the broadcast, to the minute
//   "qualities":       [{ "filePath": ".../ztnr/17205563.mp3", ... }]
//   "expirationDate":  null                    when it goes, if it goes
//   "geolocalizado":   false                   playable outside Spain
//
// So: one fetch of the series page to learn the programme id, then the API.
// The slug is not read at all any more.
//
// What is NOT done here, deliberately: taking the audio address straight from
// `qualities`. It is right there and it would save a request -- but then this
// file would be building results as well as finding editions, and rtve-archive
// would no longer be the one place that knows what an RNE recording looks
// like. The edition's own address is handed over as before.
//
// One house, two stations, as with rtve-archive: from a recording's address
// there is nothing to tell Radio 3 from Radio Clasica, and this does not try.

const { createSeriesPageResolver } = require("./_series-page-resolver");
const rtveArchive = require("./rtve-archive");

// A series page is ONE segment under /play/audios/ and nothing more. An
// edition has three, which is what keeps the two apart without a lookahead.
// "programa/..." is excluded because RTVE parks live pages there -- the trap
// rtve-archive.js documents at length.
const SERIES_RE =
  /^https?:\/\/(?:www\.)?rtve\.es\/play\/audios\/(?!programa(?:\/|$))[^/?#]+\/?(?:[?#]|$)/i;

// The programme's numeric id, as the page gives it away itself. It stands in
// several API links in the markup -- /api/programas/131354/audios, /temporadas,
// /videos -- and the first is as good as any.
const PROGRAMME_ID_RE = /\/api\/programas\/(\d+)/;

const API_BASE = "https://www.rtve.es/api/programas/";

// Twenty editions per page, newest first; a daily programme has some 380 in
// the archive, about a year and a half. Five pages is a hundred and far more
// than the guide ever asks for. The cap is there so that a date the archive
// does not hold walks off the end instead of paging through everything.
const MAX_PAGES = 5;

// "28-08-2026 23:00:00" -> "2026-08-28".
//
// Taken as written rather than through Date: the string is already the
// broadcast day in Madrid, which is exactly what the resolver compares
// against. Parsing it into an instant would invite a timezone back into a
// question that no longer has one.
function dayOfEmission(value) {
  const hit = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(value || ""));
  return hit ? hit[3] + "-" + hit[2] + "-" + hit[1] : null;
}

async function fetchJson(url) {
  const answer = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  if (!answer.ok) {
    throw new Error("RTVE answered " + answer.status + " for its own API: " + url);
  }
  return answer.json();
}

// What of an edition is worth carrying past the resolver.
//
// CORRECTED 13.09.2026. This comment used to say that `geolocalizado` "would
// have said so before the request was made at all" about two Fila cero
// recordings that answered 403. It would NOT have. Measured that day, every
// Fila cero edition carries geolocalizado FALSE and four of them an
// expirationDate weeks in the future -- and every one of them is refused.
//
// The refusal is geographic all the same, and it lives in the CDN rather than
// in the metadata. The same signed address, in the same minute:
//
//   x-served-by: cache-ber1080053-BER   403, content-length 0
//   x-served-by: cache-mad2200143-MAD   302 + download-token=...
//
// So `geolocalizado` describes an editorial decision and not what the edge
// enforces. Both fields stay -- an expiry is still worth carrying, and a
// geolocalizado TRUE is still a true statement -- but a FALSE says nothing,
// and no caller may read it as "this will play".
function extrasOf(item) {
  const extra = {};
  if (item.expirationDate) extra.expiresAt = item.expirationDate;
  if (item.geolocalizado) extra.geoRestricted = true;
  return Object.keys(extra).length ? extra : undefined;
}

function episodesFromPage(payload) {
  const items = (payload && payload.page && payload.page.items) || [];
  const out = [];
  for (const item of items) {
    const day = dayOfEmission(item.dateOfEmission || item.publicationDate);
    if (!day || !item.htmlUrl) continue;
    out.push({ url: item.htmlUrl, day: day, extra: extrasOf(item) });
  }
  return out;
}

async function episodesOf(html, pageUrl, wanted) {
  const hit = PROGRAMME_ID_RE.exec(String(html || ""));
  if (!hit) {
    throw new Error(
      "This RTVE page names no programme id, so its editions cannot be looked " +
      "up. Paste the address of the single edition instead. The page: " + pageUrl
    );
  }

  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await fetchJson(API_BASE + hit[1] + "/audios?page=" + page);
    const batch = episodesFromPage(payload);
    if (!batch.length) break;
    for (const entry of batch) out.push(entry);

    // Stop as soon as the day asked for is in hand, or once the page has
    // walked past it. Newest first, so an oldest entry older than `wanted`
    // means every later page is older still.
    if (batch.some((entry) => entry.day === wanted)) break;
    if (wanted && batch[batch.length - 1].day < wanted) break;
  }
  return out;
}

module.exports = createSeriesPageResolver({
  id: "rtve-series",
  label: "RNE",
  matchRe: SERIES_RE,
  timeZone: "Europe/Madrid",
  episodesOf: episodesOf,
  archive: rtveArchive,
});

module.exports.episodesOf = episodesOf;
module.exports.dayOfEmission = dayOfEmission;
module.exports.episodesFromPage = episodesFromPage;
