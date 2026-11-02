"use strict";

// adapters/direct-audio.js
//
// The last resort, and deliberately built as one: a URL that plainly
// points at an audio file gets played -- no page, no scraping, no claim to
// a title or a tracklist.
//
// The occasion was a download link from the rbb media library
// (rbbmediapmdp-a.akamaihd.net/.../..._mp3-256kd.mp3): a finished
// broadcast, cleanly playable, belonging to no station adapter. That is
// what this is for -- not a replacement for a proper adapter, but for the
// cases where the media library hands out the link itself.
//
// IMPORTANT: this adapter has to sit at the very end of the list in
// dispatch.js. It checks nothing but the file extension and would
// otherwise take the URL away from every station that happens to end in
// .mp3.

const { execFile } = require("child_process");

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|wma)$/i;
// File names no title can be made from: UUIDs, hashes, anything that looks
// like a database rather than a broadcast.
const OPAQUE_NAME_RE = /^[0-9a-f]{8}-?[0-9a-f-]{8,}$/i;

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (e) {
    return "";
  }
}

function match(url) {
  return AUDIO_EXT_RE.test(pathOf(url));
}

function titleFrom(url) {
  const parts = pathOf(url).split("/");
  let name = decodeURIComponent(parts[parts.length - 1] || "").replace(AUDIO_EXT_RE, "");
  // rbb appends the bitrate ("..._mp3-256kd"); that is plumbing, not a title.
  name = name.replace(/_(mp3|m4a|aac)-\d+k[a-z]?$/i, "");
  if (!name || OPAQUE_NAME_RE.test(name)) {
    try {
      return "Audio file from " + new URL(url).hostname.replace(/^www\./i, "");
    } catch (e) {
      return "Audio file";
    }
  }
  return name.replace(/[_+]+/g, " ").trim();
}

// The length is the difference between "it plays" and "it plays and can
// be searched through": without it the app shows no progress bar. ffprobe
// sits next to ffmpeg in the container anyway; where it is missing --
// testing on the Mac without Homebrew, say -- this falls back to null
// quietly instead of failing the whole request.
function probeDuration(url) {
  return new Promise(function (resolve) {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        "-user_agent", "Mozilla/5.0",
        url,
      ],
      { timeout: 20000 },
      function (err, stdout) {
        if (err) return resolve(null);
        const seconds = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
      }
    );
  });
}

async function extract(url) {
  if (!match(url)) throw new Error("direct-audio-adapter: URL does not match: " + url);
  const title = titleFrom(url);
  const duration = await probeDuration(url);
  return {
    title: title,
    sourceType: "direct-audio",
    duration: duration,
    tracks: [{ title: title, streamUrl: url }],
    tracklist: [],
  };
}

// probeDuration is exported for oe1-archive.js, which plays clips that
// carry their length neither in the page nor in an API -- rather than the
// same twenty lines of ffprobe a second time.
module.exports = { match, extract, probeDuration };
