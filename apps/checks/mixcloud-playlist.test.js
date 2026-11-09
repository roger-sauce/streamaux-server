"use strict";

// The one rule that decides whether a Mixcloud show plays or not.
//
// WHAT IT COST, 09.11.2026. The rule pinned the host `aod.mixcloud.stream`,
// and Mixcloud moved the same files to `aod.mixcloud.com`. Everything else
// worked: the page loaded, the play button was found, the aria-label turned
// to "Click to pause", three master playlists came in with 200. None of them
// matched, so the adapter waited out its twenty seconds and reported "the
// play click failed or the page has changed" -- a message that sent the
// search in two wrong directions at once. Neither had happened. A hostname
// had moved.
//
// So the test asks two things. That both hosts are taken, because a host that
// moved once can move back or be served in parallel for older shows. And that
// the SHAPE still decides -- /secure/hls/ ending in index.m3u8 -- because the
// master playlist and the per-track manifest sit next to each other on the
// same host, and taking the wrong one hands ffmpeg a single rendition instead
// of the entry point.

const test = require("node:test");
const assert = require("node:assert");

const { PLAYLIST_RE } = require("../adapters/_mixcloud");

// Measured on a Wire show, 09.11.2026, copied out of the adapter's own log.
const NEW_HOST =
  "https://aod.mixcloud.com/secure/hls/,b/f/f/f/33ad-09a6-4b9c-9599-a1259aa89769," +
  "b/f/f/f/33ad-09a6-4b9c-9599-a1259aa89769-192K,.m4a.urlset/index.m3u8";

// Measured on a Cashmere Radio episode, 30.09.2026, same shape, old host.
const OLD_HOST =
  "https://aod.mixcloud.stream/secure/hls/,0/f/6/f/a9ea-3896-4b80-b078-71a624c6fc9d," +
  "0/f/6/f/a9ea-3896-4b80-b078-71a624c6fc9d-192K,.m4a.urlset/index.m3u8";

// What follows the master playlist and must NOT be taken for it.
const PER_TRACK =
  "https://aod.mixcloud.com/secure/hls/b/f/f/f/" +
  "33ad-09a6-4b9c-9599-a1259aa89769-192K.m4a/streamindex-a1.m3u8";

test("the new host is taken", () => {
  assert.ok(PLAYLIST_RE.test(NEW_HOST), NEW_HOST);
});

test("the old host is still taken", () => {
  assert.ok(PLAYLIST_RE.test(OLD_HOST), OLD_HOST);
});

test("the per-track manifest is not mistaken for the master playlist", () => {
  assert.ok(!PLAYLIST_RE.test(PER_TRACK), PER_TRACK);
});

test("some other m3u8 on the page is not taken", () => {
  for (const url of [
    "https://example.com/secure/hls/whatever/index.m3u8",
    "https://aod.mixcloud.com/something-else/index.m3u8",
    "https://www.mixcloud.com/TheWireMagazine/some-show/",
  ]) {
    assert.ok(!PLAYLIST_RE.test(url), url);
  }
});
