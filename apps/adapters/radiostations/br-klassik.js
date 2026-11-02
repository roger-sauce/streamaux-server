"use strict";

// adapters/radiostations/br-klassik.js -- the ARD HLS pattern (see
// _ard-hls-station.js). For the _HLS_skip=YES trap and how the master
// playlist is resolved, see the comments there.
//
// BR is the most awkward of the ARD stations when it comes to telling live
// from archive: the player writes the currently running broadcast into the
// address, like this
//
//   /radio/live/br-klassik/programm/2026-08-12/3719677/#t=09:05:00
//
// and Monday's archive page looks character for character the same, only
// with an older date. A regular expression cannot decide that; a glance at
// the calendar can. Hence liveTest instead of liveRe (see
// _ard-hls-station.js).

const { createArdHlsStation } = require("../_ard-hls-station");

// The two doors that manage without a date: BR's own live page, and the
// front page of br-klassik.de together with /radio/.
const LIVE_DOOR_RE =
  /^https?:\/\/(www\.)?(br-klassik\.de(\/radio)?\/?(index\.html)?|br\.de\/radio\/live\/br-klassik\/?(index\.html)?)(\?|#|$)/i;

// /radio/live/br-klassik/programm/<YYYY-MM-DD>/<id>/
const PROGRAMME_RE =
  /^https?:\/\/(www\.)?br\.de\/radio\/live\/br-klassik\/programm\/(\d{4}-\d{2}-\d{2})\//i;

// Not UTC, and not the container's clock: the broadcast day stands in the
// URL in German local time, so "today" has to be read the same way. en-CA
// is merely the shortest route to YYYY-MM-DD.
function todayInGermany() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isLive(url) {
  if (LIVE_DOOR_RE.test(url)) return true;

  const m = url.match(PROGRAMME_RE);
  if (!m) return false;

  const day = m[2];
  const today = todayInGermany();
  if (day === today) return true;

  // The point of the whole exercise, and here the error gets specific:
  // whoever puts on Monday's concert on Wednesday should read the date
  // rather than work it out from the sound of the running programme.
  if (day < today) {
    return (
      "This is the BR-KLASSIK broadcast of " + day + ", not the livestream. " +
      "BR's own listen-back (#t=...) is not rebuilt here -- look the broadcast up " +
      "in the ARD Audiothek (ardsounds.de) and share the episode from there."
    );
  }
  return (
    "This is the BR-KLASSIK programme preview for " + day + " -- that broadcast " +
    "has not happened yet."
  );
}

module.exports = createArdHlsStation({
  id: "br-klassik",
  title: "BR-KLASSIK (Livestream)",
  matchRe: /^https?:\/\/(www\.)?(br-klassik\.de|br\.de\/radio\/live\/br-klassik)/i,
  liveTest: isLive,
  archiveHint:
    "Broadcasts to listen back to -- the #t= links on br.de included -- run through the ARD Audiothek (ardsounds.de).",
  broadcaster: "br",
  stationSlug: "brklassik",
});
