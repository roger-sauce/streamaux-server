"use strict";

// adapters/radiostations/rne-radio-3.js -- the RNE pattern (see
// _rne-hls-station.js).
//
// matchRe rebuilt on 14.08.2026, and this one had two faults at once.
//
// It caught nothing: RTVE has moved the stations, the live page is now
// either "rtve.es/play/radio/radio-3/" or -- the form the player leaves in
// the address bar -- "rtve.es/play/audios/programa/rne-rne3-live/1712469/".
// Neither begins the way the old expression demanded, so pasting the
// station gave "no adapter" and Roon never saw RNE at all.
//
// And it caught too much: "radio-?3" without a boundary also matches
// "radio-3-extra", a station of its own that we do not carry. That page now
// falls through to nobody, which is the honest answer.
//
// Recordings live under /play/audios/<programme>/<title>/<id>/ and belong
// to rtve-archive.js, which covers the whole house and sits ahead of this
// adapter. Careful: the live address above has exactly that shape, which is
// why the archive adapter excludes "programa/<...>-live/" rather than this
// one excluding the archive.

const { createRneHlsStation } = require("../_rne-hls-station");

// NO broadcastRe here, and none in rne-radio-clasica.js either. This is the one
// station pair where the address cannot decide.
//
// Both publish their broadcasts at rtve.es/play/audios/<slug>, where the slug
// is the programme name and nothing in it marks the station -- measured over
// the weeks of 18. and 26.08.2026: 79 entries for Radio Clasica, 12 for
// Radio 3, one address shape. A regex given to either adapter would take the
// other's pages too, and the first in the list would win: on-air shares from
// one RNE station would play the other. Silently, which is the failure this
// whole path is built to avoid -- the stream plays, it is simply the wrong
// station.
//
// A list of the five known Clasica slugs would work today and break the day
// RTVE adds a programme, without a sound. So: kgs= decides for RNE, and where
// a share carries no kgs, RNE answers no livestream at all. Nothing is worse
// than it was; it is the one station pair that waits for the app.
module.exports = createRneHlsStation({
  id: "rne-radio-3",
  title: "RNE Radio 3 (Livestream)",
  matchRe:
    /^https?:\/\/(www\.)?rtve\.es\/(play\/radio\/|radio\/|play\/)?radio-?3(\/|\?|#|$)|^https?:\/\/(www\.)?rtve\.es\/play\/audios\/programa\/rne-rne3-live(\/|\?|#|$)/i,
  liveRe:
    /^https?:\/\/(www\.)?rtve\.es\/(play\/radio\/|radio\/|play\/)?radio-?3\/?(\?|#|$)|^https?:\/\/(www\.)?rtve\.es\/play\/audios\/programa\/rne-rne3-live\/[0-9]+\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (rtve.es/play/audios/<programme>/<title>/<id>/) or " +
    "its short link (rneaudio.rtve.es/a/<id>) plays its own recording; " +
    "paste one of those.",
  slug: "rne3",
});
