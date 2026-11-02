"use strict";

// adapters/concertzender-archive.js
//
// The recordings Concertzender puts on its own pages, in plain sight and
// without a lock: no rights window, no country check, no seven-day limit --
// the concert measured on 12.08.2026 was recorded in 1996 and still plays.
// Of all the archive routes here this is the least guarded one.
//
// SINCE 14.08.2026 THIS ALSO COVERS WORLD OF JAZZ (worldofjazz.nl). Not a
// sister site with similar technology -- the same installation under a
// different name. Its concert pages carry the identical play buttons and
// the files sit in the identical place, right down to the directory:
// streams.greenhost.nl/cz_rod/cp/E04590-01.mp3, "cz" for Concertzender. So
// this adapter gets a second host rather than a second adapter being
// written that would do the same thing again.
//
// Page shapes, and they differ in kind, not only in address:
//
//   /concertpodium/<name>/  a concert, one file per piece (five for
//                           E00685, fifteen for E04590). The first source
//                           here that yields a real queue instead of a
//                           single file. Both houses.
//   /programma/<id>/        one programme, one file. Even the page of the
//                           programme currently on air carries a recording
//                           rather than the live stream -- see the note in
//                           radiostations/concertzender.js.
//   /programma_woj/<name>_<id>/   the same place at World of Jazz, but the
//                           page measured on 14.08.2026 held NO recording
//                           at all, only the description. It is claimed
//                           here regardless: the site's own player carries
//                           the string "The audio file cannot (yet) be
//                           found on the server", so the page is built to
//                           hold one. Should a file appear, it plays with
//                           no further work; until then the refusal names
//                           the concert route, which is a better answer
//                           than the station adapter could give.
//
// Both keep their audio in the page source as plain streams.greenhost.nl
// URLs, so one fetch and a few regular expressions are enough -- no API, no
// Playwright.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, cleanText, unescapeHtml } = require("./_shared");
const { probeDuration } = require("./direct-audio");

// A programme address is /programma/<id>, and the id is not always bare: the
// station also writes /programma/concertzender_live_899808/, a slug with the
// number on the end. Both forms stood side by side in one week of the
// konzert-guide on 18.08.2026, and only the bare one was caught -- the other
// fell through to the live adapter, which refused it with a sentence about the
// livestream. Anything but the empty segment is taken now; the id is read off
// the address separately anyway.
const PROGRAMME_RE =
  /^https?:\/\/(?:www\.)?(?:concertzender\.nl\/programma\/[^/?#]+|worldofjazz\.nl\/programma_woj\/[^/?#]+)/i;
const CONCERT_RE =
  /^https?:\/\/(?:www\.)?(?:concertzender|worldofjazz)\.nl\/concertpodium\/[^/?#]+/i;
const WOJ_RE = /^https?:\/\/(?:www\.)?worldofjazz\.nl\//i;

// Everything playable sits on this one host, both for programmes
// (/cz/cz/rod/) and for concerts (/cz_rod/cp/), and for both houses.
// Matching the host rather than the path keeps this working if they move
// things around inside it.
const MEDIA_RE = /https?:\/\/streams\.greenhost\.nl\/[^\s"'<>]+?\.mp3/gi;

// On a concert page every piece has its own play button, and the button
// carries the file and its name together:
//
//   <button class="cz-play-button" data-cp="2"
//     data-stream="https://streams.greenhost.nl/cz_rod/cp/E00685-01-02.mp3"
//     data-title="Hongaarse Rhapsodie, nr 12 - Franz Liszt 1811-1886">
//
// Reading the pair off one element is what makes this safe. The work titles
// also stand further down the page in <div class="mp3-title">, but those sit
// in a sibling column and would have to be matched to the files by position
// -- and a piece attached to the wrong movement is worse than no name.
const PLAY_BUTTON_RE = /<button[^>]*\bdata-stream="([^"]+\.mp3)"[^>]*>/gi;
const DATA_TITLE_RE = /\bdata-title="([^"]*)"/i;

function match(url) {
  return PROGRAMME_RE.test(url) || CONCERT_RE.test(url);
}

// Which of the two houses the address belongs to. Only the labelling
// differs; the markup does not. The route is carried as a whole sentence
// rather than as a fragment to be glued together: assembled from pieces it
// read "carries no recording. concerts ... do" at World of Jazz, with the
// sentence beginning in lower case, which only showed up once the second
// house existed.
function houseOf(url) {
  return WOJ_RE.test(url)
    ? {
        name: "World of Jazz",
        routes: "Concerts (/concertpodium/<name>/) do.",
      }
    : {
        name: "Concertzender",
        routes:
          "Programme pages (/programma/<id>/) and concerts " +
          "(/concertpodium/<name>/) do.",
      };
}

function clean(fragment) {
  return unescapeHtml(cleanText(String(fragment || "").replace(/<[^>]*>/g, " ")));
}

// A dash left hanging at either end once the split has been made -- or
// where there was nothing to split. World of Jazz had a button reading
// "introductie -" with no name behind it, and the stray dash went straight
// into Roon as part of the title.
function trimDashes(text) {
  // All dash characters as \u escapes on purpose: this file stays pure ASCII.
  return String(text || "").replace(/^[\s\u2010-\u2015\u2212-]+|[\s\u2010-\u2015\u2212-]+$/g, "");
}

// "Hongaarse Rhapsodie, nr 12 - Franz Liszt 1811-1886" -- work and composer
// in one string, separated by a dash. Split at the LAST dash: a title may
// well contain one ("Sonate G-Dur - Allegro"), a composer's name at the end
// is the reliable part.
function splitWorkAndComposer(text) {
  const t = clean(text);
  const cut = t.lastIndexOf(" - ");
  if (cut < 0) return { title: trimDashes(t), artist: "" };
  return { title: trimDashes(t.slice(0, cut)), artist: trimDashes(t.slice(cut + 3)) };
}

function concertPieces(html) {
  const out = [];
  const seen = new Set();
  let hit;
  PLAY_BUTTON_RE.lastIndex = 0;
  while ((hit = PLAY_BUTTON_RE.exec(html)) !== null) {
    const streamUrl = hit[1];
    // The same piece can appear twice (a list and a player); playing it
    // twice in a queue would be a puzzling kind of wrong.
    if (seen.has(streamUrl)) continue;
    seen.add(streamUrl);
    const titleHit = DATA_TITLE_RE.exec(hit[0]);
    const parts = splitWorkAndComposer(titleHit ? titleHit[1] : "");
    out.push({ streamUrl: streamUrl, title: parts.title, artist: parts.artist });
  }
  return out;
}

// A programme page has one recording but often lists what was played, as a
// numbered paragraph each, the work on the first line and the performers
// after the <br>:
//
//   <p>1. Vioolsonate in d, opus 1 nr. 2 (1725).<br>Antoinette Lohman, viool.</p>
//
// There are no times to go with them -- one continuous file, and the site
// does not say where anything starts. They are listed all the same, with
// seconds null: the app then shows "--:--" instead of inventing a position
// to jump to. Paragraphs that do not begin with a number are skipped; the
// block also holds an empty one and the "Met dank aan" credit.
function programmePieces(html) {
  const block = /<span[^>]*class="[^"]*single-item-content[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (!block) return [];
  const out = [];
  const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let hit;
  while ((hit = paragraph.exec(block[1])) !== null) {
    const lines = hit[1].split(/<br\s*\/?>/i);
    const numbered = /^(\d+)\.\s*(.+)$/.exec(clean(lines[0]));
    if (!numbered) continue;
    out.push({
      // The trailing full stop belongs to the sentence, not to the title.
      title: numbered[2].replace(/\.\s*$/, ""),
      artist: lines.length > 1 ? clean(lines.slice(1).join(" ")) : "",
      seconds: null,
      link: null,
    });
  }
  return out;
}

function mediaUrls(html) {
  const seen = new Set();
  const out = [];
  let hit;
  MEDIA_RE.lastIndex = 0;
  while ((hit = MEDIA_RE.exec(html)) !== null) {
    if (!seen.has(hit[0])) {
      seen.add(hit[0]);
      out.push(hit[0]);
    }
  }
  return out;
}

// og:title first, and not out of habit: on a programme page the <title>
// carries the name of the site and nothing else ("Concertzender | Klassiek,
// Jazz, World en meer"), while og:title holds the programme
// ("Meesterpianisten"). On a concert page both work, so one rule covers
// both.
function pageTitle(html, house) {
  const og = /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
    /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html);
  const plain = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const raw = clean((og && og[1]) || (plain && plain[1]) || "");
  // Everything from the site's own name onwards goes: the suffix is
  // "| Concertzender | Klassiek, Jazz, World en meer", so cutting at the
  // end of the line would leave half of it standing.
  const text = raw.replace(/\s*[-|]\s*(Concertzender|World of Jazz)\b.*$/i, "").trim();
  return text || house.name;
}

function nothingHere(house) {
  return (
    "This page of " + house.name + " carries no recording. " + house.routes +
    " The guide and the news pages do not."
  );
}

async function extractConcert(url, html) {
  const house = houseOf(url);
  const title = pageTitle(html, house);
  let pieces = concertPieces(html);
  // Fallback for a page that keeps its files somewhere other than in a play
  // button: still playable, only nameless.
  if (!pieces.length) {
    pieces = mediaUrls(html).map(function (file, i) {
      return { streamUrl: file, title: title + " (" + (i + 1) + ")", artist: "" };
    });
  }
  if (!pieces.length) throw new Error(nothingHere(house));

  // A queue, built like a Bandcamp album: no overall length, because there
  // is none -- each piece starts at zero and the server moves on by itself
  // when ffmpeg reaches the end of one.
  return {
    title: title,
    sourceType: "concertzender-archive",
    // Deliberately not the first piece's composer: on a mixed recital that
    // would put Schumann over a programme that also holds Liszt and Chopin.
    // The composers stand with their own pieces.
    artist: house.name,
    tracks: pieces.map(function (p) {
      return { title: p.title || title, streamUrl: p.streamUrl };
    }),
    tracklist: pieces.map(function (p) {
      return { artist: p.artist, title: p.title || title, seconds: null, link: url };
    }),
  };
}

async function extractProgramme(url, html) {
  const house = houseOf(url);
  const files = mediaUrls(html);
  if (!files.length) throw new Error(nothingHere(house));
  const title = pageTitle(html, house);
  // A single recording can have a progress bar, so the length is worth the
  // ffprobe call (it stays quiet if ffprobe is missing, see direct-audio.js).
  const duration = await probeDuration(files[0]);

  return {
    title: title,
    sourceType: "concertzender-archive",
    artist: house.name,
    duration: duration,
    tracks: [{ title: title, streamUrl: files[0] }],
    tracklist: programmePieces(html),
  };
}

async function extract(url) {
  const html = await fetchHtml(url);
  if (CONCERT_RE.test(url)) return extractConcert(url, html);
  if (PROGRAMME_RE.test(url)) return extractProgramme(url, html);
  throw new Error("concertzender-archive-adapter: URL does not match: " + url);
}

module.exports = { match, extract };
