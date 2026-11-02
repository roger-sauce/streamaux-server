"use strict";

// adapters/radiostations/rne-radio-clasica.js -- the RNE pattern (see
// _rne-hls-station.js).
//
// matchRe rebuilt on 14.08.2026 for the same reason as its neighbour
// rne-radio-3.js: RTVE has moved the stations and the old expression caught
// none of the addresses the site now hands out. Measured live page:
// "rtve.es/play/radio/radio-clasica/".
//
// Radio 3 additionally answers under
// "play/audios/programa/rne-rne3-live/<id>/". Whether Clasica has that
// second form was not measured, so it is deliberately not guessed here --
// a wrong alternative would claim addresses that belong to someone else.
// If it turns up, it goes in beside the first, exactly as in rne-radio-3.js.
//
// Recordings live under /play/audios/<programme>/<title>/<id>/ and belong
// to rtve-archive.js, which covers the whole house and sits ahead of this
// adapter. "Solo jazz", the broadcast measured on 14.08.2026, is one of
// this station's -- channelPermalink says "radio-clasica".

const { createRneHlsStation } = require("../_rne-hls-station");

// No broadcastRe -- see the note in rne-radio-3.js.
module.exports = createRneHlsStation({
  id: "rne-radio-clasica",
  title: "RNE Radio Clásica (Livestream)",
  matchRe:
    /^https?:\/\/(www\.)?rtve\.es\/(play\/radio\/|radio\/|play\/)?radio-?clasica(\/|\?|#|$)/i,
  liveRe:
    /^https?:\/\/(www\.)?rtve\.es\/(play\/radio\/|radio\/|play\/)?radio-?clasica\/?(\?|#|$)/i,
  archiveHint:
    "A broadcast page (rtve.es/play/audios/<programme>/<title>/<id>/) or " +
    "its short link (rneaudio.rtve.es/a/<id>) plays its own recording; " +
    "paste one of those.",
  slug: "rnerc",
});
