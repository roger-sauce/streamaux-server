"use strict";

// adapters/polskieradio-episodes.js
//
// The SECOND way to an edition of a Dwojka programme: the series page's own
// episode list.
//
// WHY THERE HAD TO BE A SECOND WAY (16.09.2026). Until today the only lookup in
// the whole project was `Article/GetListByCategoryId` -- articles. Dwojka also
// publishes editions as ODCINKI, which live at
//
//   /dwojka/audycje/<series>,<id>/odcinek/<title>,<uuid>
//
// and those the archive adapter has been able to play since the beginning. What
// was missing was anything that could FIND one. So a series whose articles had
// stopped looked, from here, exactly like a series that had stopped -- and
// three of them were written up as dead on that reasoning. Roger checked and
// they are on the air: Koncert w porze lunchu Mon-Fri 14:00, Fantazja polska at
// 01:00 and 05:00, Muzyczna Noc Euroradia from 02:00 without a summer break.
// The reasoning was wrong because it rested on one channel of two.
//
// WHERE THE DATA IS. Not in the markup that draws the list, but in a JSON
// payload the page carries for its own hydration:
//
//   "showEpisodes":[{"articleId":3367189,
//                    "title":"Fantazja polska 19 kwietnia godz. 06:00",
//                    "station":"Dwójka",
//                    "date":"2024-04-19T06:00:00",
//                    "sounds":["https://static.prsa.pl/13a7f3b0-...mp3"]}, ...]
//
// `date` is the BROADCAST time, Warsaw wall clock -- which is the key the
// resolver asks with -- and `sounds` is the recording itself. No second fetch,
// no guessing an address from a slug.
//
// THE TRAP, and it is in the fixture so it stays caught: the key appears TWICE.
// The page renders once in a loading state, and that copy carries
// `"showEpisodes":[]`. Taking the first match yields nothing and reports "no
// episodes" for a series that has ten. So the LONGEST array wins, not the
// first.
//
// The payload sits inside a JavaScript string (`self.__next_f.push([1,"..."])`),
// so every quotation mark arrives as \" and the whole thing has to be
// unescaped one level before it is JSON at all.
//
// This module only reads and chooses. Fetching and refusing belong to
// polskieradio-series.js, which calls it after the articles come up empty --
// deliberately NOT a second adapter beside it. detectAdapter returns the first
// match, so a refusal by the first would end the question before the second was
// ever asked; that cost ten Deutschlandfunk Kultur rows earlier today.

const EPISODES_KEY = '"showEpisodes":';
const SOUND_RE = /^https?:\/\//i;

/* One level out of a JavaScript string literal.
 *
 * Left to right, so \\" becomes a backslash and then a quotation mark, rather
 * than the other way round. \/ and any other escape fall through to the
 * character itself, which is what JSON means by them too.
 */
function unescapeJsString(text) {
  return String(text || "").replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, function (whole, what) {
    if (what.charAt(0) === "u") return String.fromCharCode(parseInt(what.slice(1), 16));
    if (what === "n") return "\n";
    if (what === "r") return "\r";
    if (what === "t") return "\t";
    if (what === "b") return "\b";
    if (what === "f") return "\f";
    return what;
  });
}

// The array beginning at `start`, brackets counted, quotation marks respected.
// A title holding a bracket would otherwise end the array early, and Dwojka
// writes titles like "Kwartet [wersja koncertowa]".
function jsonArrayAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/* Every episode the series page lists.
 *
 * The LONGEST of the arrays found, for the loading-state trap described at the
 * top. An unparseable one is skipped rather than thrown on: one broken copy of
 * the key must not lose a good one.
 */
function parseEpisodes(html) {
  const text = unescapeJsString(html);
  let best = [];
  let at = text.indexOf(EPISODES_KEY);
  while (at !== -1) {
    const open = text.indexOf("[", at + EPISODES_KEY.length);
    if (open !== -1) {
      const raw = jsonArrayAt(text, open);
      if (raw) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length > best.length) best = list;
        } catch (e) {
          // Not this one.
        }
      }
    }
    at = text.indexOf(EPISODES_KEY, at + EPISODES_KEY.length);
  }
  return best;
}

// Minutes since midnight of "HH:MM". The same two lines as in
// polskieradio-series.js and for the same reason: `date` here and the broadcast
// time in the fragment are both Warsaw wall clock, so they compare as written.
function minutesOf(hhmm) {
  const h = Number(String(hhmm).slice(0, 2));
  const m = Number(String(hhmm).slice(3, 5));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/* The episode of the broadcast asked for: same day, nearest start.
 *
 * Nearest and not exact, because the station rounds: the edition of 18.04.2024
 * carries date 06:00:01 for a programme announced at 06:00. The day has to
 * agree exactly -- a neighbouring night is never the right answer, which is the
 * rule the live adapters were given on 09.08.2026.
 */
function episodeFor(episodes, wanted) {
  let best = null;
  let bestGap = Infinity;
  for (const episode of episodes || []) {
    const stamp = String((episode && episode.date) || "");
    if (stamp.slice(0, 10) !== wanted.day) continue;
    const gap = Math.abs(minutesOf(stamp.slice(11, 16)) - wanted.minutes);
    if (gap < bestGap) {
      best = episode;
      bestGap = gap;
    }
  }
  return best;
}

// The recording. `sounds` is an array and has held one entry everywhere it has
// been looked at; anything that is not an address is skipped rather than
// handed on as a stream.
function soundOf(episode) {
  const sounds = (episode && episode.sounds) || [];
  for (const sound of sounds) {
    if (typeof sound === "string" && SOUND_RE.test(sound)) return sound;
  }
  return null;
}

/* The page a person can open for this edition.
 *
 * Found in the markup rather than built from the parts: the address is
 * /odcinek/<title-slug>,<uuid>, and the slug is the station's own wording. The
 * uuid is the recording's file name, which is what makes the join possible at
 * all -- so this searches for the uuid it already has instead of guessing a
 * slug from the title.
 *
 * Null where the link is not on the page. The caller then keeps the series
 * page, which is true rather than convenient.
 */
function episodePageFor(html, soundUrl) {
  const uuid = /([0-9a-fA-F-]{36})\.mp3/.exec(String(soundUrl || ""));
  if (!uuid) return null;
  const hit = new RegExp(
    '(/[a-z0-9-]+/audycje/[^"\\\\]*?/odcinek/[^"\\\\,]*,' + uuid[1] + ')', "i"
  ).exec(String(html || ""));
  return hit ? "https://www.polskieradio.pl" + hit[1] : null;
}

module.exports = {
  parseEpisodes, episodeFor, soundOf, episodePageFor,
  // For apps/checks/polskieradio-episodes.test.js.
  unescapeJsString, jsonArrayAt,
};
