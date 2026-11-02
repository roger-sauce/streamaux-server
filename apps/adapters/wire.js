"use strict";

// adapters/wire.js
//
// The Wire's own audio pages (thewire.co.uk/audio/tracks/<name>). Three
// shapes, and they are tried in THIS ORDER, which is the whole point:
//
//   1. a playlist player -- one file per piece, with artist, title and
//      length. Office Ambience, Unlimited Editions and Global Ear all use
//      it; measured on 14.08.2026 with eleven, six and twelve pieces.
//   2. a single audio file.
//   3. an embedded Mixcloud player -- one continuous stream with nothing to
//      cut it into pieces.
//
// THE ORDER IS THE FIX. A playlist page carries an <audio> element as well,
// but it is only the player, loaded with the first piece. Until 14.08.2026
// the single-file branch stood first, won on those pages, and handed Roon
// exactly one track of eleven -- the stream "broke off after the first
// piece", which is precisely what it had been told to do.
//
// Every row of the playlist carries the file and its label on the SAME
// element, data-file and title. Reading the pair off one element is what
// makes it safe -- the same rule as Concertzender's play buttons, and for
// the same reason: matched up by position, a title would sooner or later
// sit over the wrong recording.
//
// Two traps in the markup:
//   - the paths are RELATIVE ("/2026/08/05/....mp3"), so a search for
//     "https://...mp3" finds nothing at all on these pages.
//   - not every piece is an mp3. Office Ambience 511 holds an .m4a, so the
//     file comes from data-file and never from a guess at the extension.
//
// And one in the page furniture: every Wire page carries a footer link to
// mixcloud.com/TheWireMagazine. The Mixcloud branch therefore looks for
// iframe[src*="player-widget.mixcloud.com"] and not merely for "mixcloud",
// which would make every page here a Mixcloud page.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { parse } = require("node-html-parser");
const { extractMixcloudStream } = require("./_mixcloud");
const { fetchHtml, cleanText, unescapeHtml } = require("./_shared");

const WIRE_URL_RE = /^https?:\/\/(www\.)?thewire\.co\.uk\//i;

function match(url) {
  return WIRE_URL_RE.test(url);
}

// "0:07:37" -- hours, minutes, seconds, and the hour is written out even
// when it is zero.
function parseClock(text) {
  const parts = cleanText(text).split(":").map(Number);
  if (!parts.length || parts.some(function (n) { return !Number.isFinite(n); })) return null;
  const seconds = parts.reduce(function (total, n) { return total * 60 + n; }, 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

// "A Tomb Full Of Stars “Repose”" -- the artist, then the work in
// typographic quotation marks. Where there are none the whole line is the
// title: a Global Ear field recording may carry nothing but a place, and
// making an artist out of that would be worse than leaving the field empty.
//
// The quotation marks in the expression as \u escapes: a typographic quote
// and a straight one look alike in some editors, and here that difference
// decides where the artist ends and the work begins.
const QUOTED_RE = /^(.*?)[\u201c"]([^\u201d"]*)[\u201d"]?\s*$/;

function splitArtistAndTitle(raw) {
  const text = cleanText(unescapeHtml(raw));
  const hit = QUOTED_RE.exec(text);
  if (!hit || !cleanText(hit[2])) return { artist: "", title: text };
  return { artist: cleanText(hit[1]), title: cleanText(hit[2]) };
}

function playlistPieces(root, pageUrl) {
  const out = [];
  const seen = new Set();
  root.querySelectorAll("table.playlist tr").forEach(function (row) {
    const link = row.querySelector("a[data-file]");
    const file = link && link.getAttribute("data-file");
    if (!file) return;
    let streamUrl;
    try {
      streamUrl = new URL(file, pageUrl).href;
    } catch (e) {
      return;
    }
    // The same file listed twice would play twice, which is a puzzling kind
    // of wrong.
    if (seen.has(streamUrl)) return;
    seen.add(streamUrl);
    const label = splitArtistAndTitle(link.getAttribute("title") || link.text);
    const cell = row.querySelector("td.duration");
    out.push({
      streamUrl: streamUrl,
      artist: label.artist,
      title: label.title,
      seconds: parseClock(cell ? cell.text : ""),
    });
  });
  return out;
}

function pageTitle(root) {
  const titleTag = root.querySelector("title");
  const h1 = root.querySelector("h1");
  const raw = (titleTag && cleanText(titleTag.text)) || (h1 && cleanText(h1.text)) || "";
  return unescapeHtml(raw.replace(/\s*[|\-–]\s*The Wire.*$/i, "").trim());
}

async function extract(url) {
  if (!match(url)) throw new Error("wire-adapter: URL does not match: " + url);
  const html = await fetchHtml(url);
  const root = parse(html, { lowerCaseTagName: false });
  const title = pageTitle(root);

  // Case 1: a playlist. First, for the reason at the top of this file.
  const pieces = playlistPieces(root, url);
  if (pieces.length) {
    return {
      title: title,
      sourceType: "wire",
      // The magazine, not the first piece's artist: on a selection of eleven
      // releases that would put one name over the other ten. The artists
      // stand with their own pieces.
      artist: "The Wire",
      // A queue has no overall length -- each piece starts at zero and the
      // server moves on by itself. The pieces do have one, and it is worth
      // showing.
      tracks: pieces.map(function (p) {
        return { title: p.title, streamUrl: p.streamUrl };
      }),
      tracklist: pieces.map(function (p) {
        return {
          artist: p.artist,
          title: p.title,
          // No offsets: separate files, each starting at zero.
          seconds: null,
          duration: p.seconds,
          link: url,
        };
      }),
    };
  }

  // Case 2: a single audio file, no Playwright needed -- quick.
  const audioEl = root.querySelector("audio[src]") || root.querySelector("audio source[src]");
  if (audioEl) {
    const src = new URL(audioEl.getAttribute("src"), url).href;
    return {
      title: title,
      sourceType: "wire",
      artist: "The Wire",
      tracks: [{ title: title, streamUrl: src }],
      tracklist: [{ artist: "", title: "Tracklist on Wire UK page", seconds: null }],
    };
  }

  // Case 3: an embedded Mixcloud player. The iframe's "feed" parameter gives
  // the path on the real mixcloud.com page. The pointer to the Wire page
  // instead of track data stands because the Wire article usually carries
  // the list and Mixcloud usually does not -- corrected on 14.08.2026:
  // Mixcloud DOES have a field for one ("sections" in its API), it was
  // simply empty on both shows measured. See adapters/mixcloud.js, which
  // reads it where it is filled.
  const iframe = root.querySelector('iframe[src*="player-widget.mixcloud.com"]');
  if (iframe) {
    const iframeSrc = new URL(iframe.getAttribute("src"), url);
    const feed = iframeSrc.searchParams.get("feed");
    if (!feed) throw new Error("wire-adapter: Mixcloud embed found without a feed parameter");
    const mixcloudUrl = "https://www.mixcloud.com" + feed;
    const streamUrl = await extractMixcloudStream(mixcloudUrl);
    return {
      title: title,
      sourceType: "mixcloud",
      artist: "The Wire",
      tracks: [{ title: title, streamUrl: streamUrl }],
      tracklist: [{ artist: "", title: "Tracklist on Wire UK page", seconds: null }],
    };
  }

  throw new Error(
    "This page of The Wire carries no recording -- neither a playlist, nor a " +
      "single file, nor an embedded Mixcloud player."
  );
}

module.exports = { match, extract };
