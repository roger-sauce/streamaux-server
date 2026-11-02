"use strict";

// adapters/radiostations/polskie-radio-2.js -- the fixed Icecast pattern
// (see _direct-stream-station.js).
//
// matchRe repaired on 13.08.2026: it knew only the old address form
// (polskieradio.pl/8,Dwojka), while today's player sits on a different host
// altogether. Pasting the address the site actually shows would have
// produced "No adapter fits this URL" -- a broken station rather than a
// wrong one, and nobody had noticed. The old form is kept for old links.
//
// Live is the player page and the station's own front page. Everything
// below /dwojka/ is programmes and episodes: episodes go to
// polskieradio-archive.js, which sits ahead of this adapter, the rest is
// refused with a pointer to it.

const { createDirectStreamStation } = require("../_direct-stream-station");

module.exports = createDirectStreamStation({
  id: "polskie-radio-2",
  title: "Polskie Radio 2 (Livestream)",
  matchRe:
    /^https?:\/\/((www\.)?polskieradio\.pl\/(8,Dwojka|dwojka)|player\.polskieradio\.pl\/anteny\/dwojka)/i,
  liveRe:
    /^https?:\/\/((www\.)?polskieradio\.pl\/(8,Dwojka|dwojka)|player\.polskieradio\.pl\/anteny\/dwojka)\/?(\?|#|$)/i,
  // Rewritten 02.09.2026, because it had started to say something untrue.
  //
  // It read: "Most of Dwojka's live concerts sit on YouTube... Building a
  // resolver here would therefore be work for the remaining five per cent."
  // That was the state on 18.08.2026 and it was the right call then. Since
  // 01.09.2026 the resolver exists: polskieradio-series.js finds the article of
  // a broadcast day and polskieradio-archive.js plays what is in it. A refusal
  // that tells a person there is nothing, while there is something, is worse
  // than no hint at all -- it stops them looking.
  //
  // What has NOT changed: YouTube stays out of scope (KONTEXT-RADIO-ADAPTER.md
  // 5.9, 14.08.2026, the same reason the UK VPN was refused). Where Dwojka
  // published a video instead of a recording, the answer now names the article
  // it sits in, which is one tap from watching it and needs no extractor.
  //
  // Kept short on purpose. This is read on a phone, in front of a refusal.
  archiveHint:
    "This is the livestream page, not a broadcast. A concert from the archive does play: " +
    "share it from the Konzertfuehrer, or paste the address of the article or the episode. " +
    "Where Dwojka published a video rather than a recording, the answer names the article.",
  streamUrl: "https://stream12.polskieradio.pl/pr2/pr2.sdp/playlist.m3u8",
});
