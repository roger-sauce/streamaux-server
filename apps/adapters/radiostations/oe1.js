"use strict";

// adapters/radiostations/oe1.js
//
// OE1 (ORF) -- a direct MP3 livestream (Shoutcast), no HLS, no query
// parameters or tokens. The same simple pattern as radio3.js.
//
// Kept over the HLS variant the ORF Sound player uses
// (orf-live-oe1.mdn.ors.at/.../oe1-audio_50101_DEU_equal_50000.m3u8): that
// one is a single low-bitrate variant, and HLS would need the /live/ proxy
// on top. The Shoutcast URL plays as it stands.

// The refusal below is a decline, not a failure: the adapter worked, the
// address is simply a programme page and not the livestream, and the answer
// says where to look instead. Converted on 02.09.2026 -- four sites 5.6 missed,
// found when a run over a real week counted them as faults. The page travels
// as sourceUrl so the app can offer it as a button.
const { unsupported } = require("../_shared");

const OE1_URL_RE = /^https?:\/\/(sound\.orf\.at|(www\.)?oe1\.orf\.at)/i;

// Which URLs really are the live page. sound.orf.at is the shared front
// page of every ORF radio station and shows no station in the address bar
// -- it counts as OE1 here because that is the only ORF station this
// server supports. Everything else on oe1.orf.at is a programme page, an
// article or an ORF Sound collection, and until today every one of them
// was quietly answered with the running programme: putting on Monday's
// concert on Wednesday meant listening to the current broadcast and
// noticing only by the sound of it.
const OE1_LIVE_RE =
  /^https?:\/\/(sound\.orf\.at(\/|\/radio\/oe1\/?(live\/?)?)?|(www\.)?oe1\.orf\.at\/?)(\?|#|$)/i;

const STREAM_URL = "https://orf-live.ors-shoutcast.at/oe1-q2a";
const TITLE = "Ö1 (ORF) - Livestream";

function match(url) {
  return OE1_URL_RE.test(url);
}

async function extract(url) {
  if (!match(url)) throw new Error("oe1-adapter: URL does not match: " + url);
  if (!OE1_LIVE_RE.test(url)) {
    throw unsupported(
      "This is not the OE1 livestream but a page from the programme or the archive. " +
        "Broadcasts to listen " +
        "back to sit under oe1.orf.at/programm/<date>/<id> and stay there for seven " +
        "days; paste that address here.",
      url
    );
  }
  return live();
}

// The same answer as above, without the gate. detectAdapter() reaches for this
// when the shared address says the broadcast is on air right now: the address
// is then a programme page, extract() refuses it correctly, and the livestream
// is nonetheless what was asked for. See adapters/_on-air.js.
function live() {
  return {
    title: TITLE,
    sourceType: "oe1",
    tracks: [{ title: TITLE, streamUrl: STREAM_URL }],
    tracklist: [{ artist: "", title: "Livestream - no fixed tracklist", seconds: null }],
  };
}

module.exports = { match, extract, live };
