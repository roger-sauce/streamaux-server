"use strict";

// adapters/raiplaysound-series.js -- the series-page pattern (see
// _series-page-resolver.js).
//
// The konzert-guide stores
//
//   https://www.raiplaysound.it/programmi/radio3suite-ilcartellone
//
// which is the programme, not the edition. The editions carry the date in
// their file name, eight digits after "del":
//
//   /audio/2026/08/Radio3-Suite---Il-Cartellone-del06082026-587c553e-....html
//
// DDMMYYYY, and that address is exactly what raiplaysound-archive.js matches,
// so the link is passed on as found.
//
// The address form belongs to the platform rather than to a station, as with
// the archive adapter: the same file serves every Rai radio channel.

const { createSeriesPageResolver } = require("./_series-page-resolver");
const raiplaysoundArchive = require("./raiplaysound-archive");

const SERIES_RE = /^https?:\/\/(?:www\.)?raiplaysound\.it\/programmi\/[^/?#]+\/?(?:[?#]|$)/i;
const LINK_RE = /\/audio\/\d{4}\/\d{2}\/[^"'<>\s]+?\.html/g;

// Eight digits in a row, not preceded or followed by another. Scanned from
// the left on purpose: "del06082026" stands before the uuid, and a uuid can
// carry digit runs of its own. The ranges are checked rather than assumed --
// an unvalidated run out of the uuid would otherwise become a plausible and
// entirely wrong date.
const DAY_RE = /(?:^|[^0-9])(\d{2})(\d{2})(\d{4})(?:[^0-9]|$)/g;

function dayOf(href) {
  DAY_RE.lastIndex = 0;
  let hit;
  while ((hit = DAY_RE.exec(href)) !== null) {
    const day = Number(hit[1]);
    const month = Number(hit[2]);
    const year = Number(hit[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return hit[3] + "-" + hit[2] + "-" + hit[1];
    }
    // Overlapping runs: step back one so "1234567890" is examined from its
    // second digit too rather than skipped whole.
    DAY_RE.lastIndex = hit.index + 1;
  }
  return null;
}

function episodesOf(html, pageUrl) {
  const out = [];
  const seen = Object.create(null);
  let hit;
  LINK_RE.lastIndex = 0;
  while ((hit = LINK_RE.exec(html)) !== null) {
    const href = hit[0];
    const day = dayOf(href);
    if (!day) continue;
    const url = new URL(href, pageUrl).href;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({ url: url, day: day });
  }
  return out;
}

module.exports = createSeriesPageResolver({
  id: "raiplaysound-series",
  label: "Rai",
  matchRe: SERIES_RE,
  timeZone: "Europe/Rome",
  episodesOf: episodesOf,
  archive: raiplaysoundArchive,
});

module.exports.episodesOf = episodesOf;
