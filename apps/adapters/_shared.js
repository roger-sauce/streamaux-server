"use strict";

// Shared helpers for every adapters/*.js module -- so that fetchHtml and
// cleanText do not have to be copied into each new source (the
// konzert-guide stations to come, for instance).

const USER_AGENT = "Mozilla/5.0 (compatible; AutoplayPi/1.0)";

async function fetchHtml(url, opts = {}) {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: Object.assign({ "User-Agent": USER_AGENT }, opts.headers || {}),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " while loading " + url);
  return resp.text();
}

function cleanText(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

// For text taken out of a page rather than out of an API: the ORF writes
// the quotation marks of a title as &quot;, Concertzender writes
// "Phantasiestuecke" as "Phantasiest&uuml;cke", and undecoded both reach
// the tracklist and Roon as raw markup.
//
// The accented letters are built rather than tabulated: the entity name
// says which mark belongs on which letter, so the letter plus a combining
// mark, normalised, gives the character. That is the whole of Latin-1 in
// two lines instead of sixty, and a letter we never thought of works too.
// Only the few that do not decompose that way are listed by hand.
//
// All values as escapes on purpose: this file stays pure ASCII, and a
// combining accent written literally is invisible in an editor.
var COMBINING = {
  uml: "\u0308", acute: "\u0301", grave: "\u0300",
  circ: "\u0302", tilde: "\u0303", ring: "\u030a", cedil: "\u0327",
};
var STANDALONE = {
  szlig: "\u00df", oslash: "\u00f8", Oslash: "\u00d8", aelig: "\u00e6",
  AElig: "\u00c6", eth: "\u00f0", thorn: "\u00fe", iexcl: "\u00a1",
  laquo: "\u00ab", raquo: "\u00bb", ndash: "\u2013", mdash: "\u2014",
  hellip: "\u2026", euro: "\u20ac", deg: "\u00b0",
};

function unescapeHtml(text) {
  return String(text || "")
    .replace(/&([a-zA-Z])(uml|acute|grave|circ|tilde|ring|cedil);/g, function (m, letter, mark) {
      return (letter + COMBINING[mark]).normalize("NFC");
    })
    .replace(/&(szlig|oslash|Oslash|aelig|AElig|eth|thorn|iexcl|laquo|raquo|ndash|mdash|hellip|euro|deg);/g,
      function (m, name) { return STANDALONE[name]; })
    .replace(/&#(\d+);/g, function (m, code) {
      return String.fromCodePoint(Number(code));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (m, code) {
      return String.fromCodePoint(parseInt(code, 16));
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// "P0Y0M0DT3H4M3S", "PT1H" -- ISO 8601 durations, as Radio France and NRK
// both hand them out. The M before the T is months, the one after is
// minutes, which is why this is one expression and not two lookups.
function parseIsoDuration(text) {
  const hit = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    .exec(String(text || "").trim());
  if (!hit) return null;
  const days = (Number(hit[4]) || 0) + (Number(hit[3]) || 0) * 7;
  const seconds =
    days * 86400 +
    (Number(hit[5]) || 0) * 3600 +
    (Number(hit[6]) || 0) * 60 +
    (Number(hit[7]) || 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

// Turns a live HLS playlist -- which may be very long -- into a short,
// spec-conformant one holding only the last `keepSegments` segments.
// Background: some CDNs (ARD/BR among them) serve the entire day's history
// by default instead of a small sliding window, and the mechanism meant
// for that, "_HLS_skip=YES" delta updates, is refused by Safari and
// AVPlayer on the very first request (code 4,
// MEDIA_ERR_SRC_NOT_SUPPORTED) because a delta presupposes a full playlist
// fetched earlier. So this builds an ordinary small playlist itself --
// works everywhere, no special parameter.
function buildLiveManifest(rawManifestText, sourceUrl, keepSegments = 6) {
  const lines = rawManifestText.split("\n").map((l) => l.trim());
  const DROP_PREFIXES = ["#EXT-X-MEDIA-SEQUENCE", "#EXT-X-SERVER-CONTROL", "#EXT-X-SKIP"];
  const header = [];
  const entries = [];
  let pendingDateTime = null;
  let baseSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const seqMatch = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (seqMatch) {
      baseSeq = parseInt(seqMatch[1], 10);
      continue;
    }
    if (DROP_PREFIXES.some((p) => line.startsWith(p))) continue;

    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      pendingDateTime = line;
    } else if (line.startsWith("#EXTINF:")) {
      const segment = lines[i + 1];
      if (segment && !segment.startsWith("#")) {
        entries.push({ dateTime: pendingDateTime, extinf: line, segment });
        pendingDateTime = null;
        i++;
      }
    } else if (entries.length === 0 && line) {
      header.push(line); // lines before the first segment (version, targetduration, ...)
    }
  }

  const kept = entries.slice(-keepSegments);
  const newSeq = baseSeq + (entries.length - kept.length);

  const body = [];
  kept.forEach((e) => {
    if (e.dateTime) body.push(e.dateTime);
    body.push(e.extinf);
    body.push(new URL(e.segment, sourceUrl).href);
  });

  return [...header, "#EXT-X-MEDIA-SEQUENCE:" + newSeq, ...body, ""].join("\n");
}

// When a recording was published at its source, as an ISO 8601 string, or ""
// when the value cannot be read as a date. The app appends it to the title in
// the history list -- see publishedAt in docs/HANDOFF.md.
//
// EMPTY RATHER THAN A GUESS, and that matters more than it looks. Nothing in
// the chain needs this field: an adapter that says nothing gets a row without
// a date. So anything doubtful belongs here as "", never as a date that reads
// like a fact.
//
// Hence the insistence on a whole day. Sources write a bare year often enough
// -- the Internet Archive holds "1922" for a 78 -- and "1922" through Date()
// becomes the first of January, which the screen would then show as a day
// somebody broadcast on. A year is worth knowing and is not a date; until
// there is somewhere to put it, it is dropped.
function toIsoDate(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  // Epoch, in seconds or in milliseconds. Anything below 1e11 is read as
  // seconds; that boundary lies in 1973 read as milliseconds and in the year
  // 5138 read as seconds, so no real broadcast date falls on the wrong side.
  if (/^\d{9,14}$/.test(raw)) {
    const stamp = Number(raw);
    const when = new Date(stamp < 1e11 ? stamp * 1000 : stamp);
    return Number.isFinite(when.getTime()) ? when.toISOString() : "";
  }
  // A whole day, written either way round: "2026-08-17…" or "17 August 2026".
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) && !/\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(raw)) return "";
  const when = new Date(raw);
  return Number.isFinite(when.getTime()) ? when.toISOString() : "";
}

/* --- "not supported, and that is fine" -----------------------------------
 *
 * KONTEXT-RADIO-ADAPTER 5.6, deferred on 12.08.2026 and taken up on
 * 31.08.2026. An adapter could only ever `throw`, so a live page that has no
 * archive, a concert that sits on YouTube, and a genuinely broken parser all
 * arrived at the app as the same red error. Two of those three are the system
 * working correctly.
 *
 * The note that deferred this proposed a RETURN -- `{ unsupported: true,
 * reason }`. I have built it as a tagged THROW instead, and the reason is the
 * failure mode of each. A returned marker is silently mistaken for success by
 * any caller that forgets to check it: no tracks, no error, nothing played,
 * nothing said. A thrown one behaves exactly as before everywhere it is not
 * yet handled, and better everywhere it is. Where a change cannot be made in
 * all places at once, the version that degrades into today's behaviour is the
 * one to pick.
 *
 * The carried fields:
 *   reason     the same text as the message, for a caller that wants it
 *              without the surrounding prose
 *   sourceUrl  the page a person can open to look for themselves
 */
/* A refusal that is an ANSWER rather than a fault, with what the station said.
 *
 * `extra` is new on 16.09.2026 and it is the whole point of this change: a
 * station that declines often says WHY, and until now that survived only as
 * prose inside the message. SRF answers `blockReason: "GEOBLOCK"` with a
 * validity window; NRK answers a `playability` and a reason; rbb answers a
 * `_geoblocked` flag. Three houses, three spellings, one meaning -- and a
 * sentence cannot be read by the archive, while a field can.
 *
 * The names are ours and not each station's, the way `answerOf` already
 * normalises `expirationDate` and `geolocalizado` into `expiresAt` and
 * `geoRestricted`. So the second station to grow such a field needs no second
 * name:
 *
 *   geoRestricted   true where the station says the recording is not for us
 *   blockReason     the station's own word, kept verbatim for the record
 *   expiresAt       when it goes, ISO, where the station gives a window
 *   declined        OUR word for why, out of a closed set, beside the
 *                   station's own words in `blockReason`. Added 17.09.2026 at
 *                   Roger's prompting: "ich finde unsupported an dieser stelle
 *                   misvertaendlich, es muesste heissen no-archive." The status
 *                   cannot say it -- `unsupported` means "an answer, not a
 *                   fault" and carries five different answers -- so the reason
 *                   becomes a field, the way the station's did. The values in
 *                   use: not-yet, did-not-run, no-archive, unknown. See
 *                   declineOf() in _series-page-resolver.js.
 *   retryable       true where the refusal means NOT YET rather than never,
 *                   added 16.09.2026. `unsupported` was recorded as settled --
 *                   "the station has no archive, and it will say the same
 *                   tomorrow" -- and that stopped being what the word meant the
 *                   day day-lookups began using it. RNE's broadcast of 02:00
 *                   was asked at 09:46, once, and never again. Whoever throws
 *                   knows which of the two it is; nobody downstream can tell.
 */
function unsupported(reason, sourceUrl, extra) {
  const error = new Error(reason);
  error.unsupported = true;
  error.reason = reason;
  if (sourceUrl) error.sourceUrl = sourceUrl;
  if (extra && typeof extra === "object") Object.assign(error, extra);
  return error;
}

function isUnsupported(error) {
  return !!(error && error.unsupported);
}

module.exports = {
  USER_AGENT,
  fetchHtml,
  cleanText,
  unescapeHtml,
  parseIsoDuration,
  buildLiveManifest,
  toIsoDate,
  unsupported,
  isUnsupported,
};
