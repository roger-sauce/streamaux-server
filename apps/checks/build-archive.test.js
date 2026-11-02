"use strict";

// What gets into playable.json, and under which of the three states. Each of
// these was wrong in the file the app reads at some point in the week of
// 07.09.2026.

const test = require("node:test");
const assert = require("node:assert");
// See resolve-week.test.js: the helpers live in apps/lib/rows.js since
// 10.09.2026, and `isoDate` no longer exists twice.
const api = require("../lib/rows");

const reachable = { verdict: "reachable", live: false };

test("isPlayable: reachable, ours, and actually the broadcast asked for", () => {
  assert.equal(api.isPlayable({ status: "ok", probe: reachable }), true);
  assert.equal(api.isPlayable({ status: "ok", probe: { verdict: "reachable", live: true } }),
    false, "a livestream is always up and says nothing about an archive");
  assert.equal(api.isPlayable({ status: "ok", probe: { verdict: "gone" } }), false);
  assert.equal(api.isPlayable({ status: "suggested", probe: reachable }), false,
    "a suggestion is reachable audio and the wrong broadcast");
  assert.equal(
    api.isPlayable({ status: "ok", probe: reachable, answer: { suggestion: true } }), false);
});

test("isPageOnly: a page and no audio, which is a state and not a failure", () => {
  assert.equal(api.isPageOnly({ status: "unclaimed", broadcastUrl: "https://bbc/x" }), true,
    "BBC Radio 3, BBC 6 Music, Yle Radio 1");
  assert.equal(api.isPageOnly({ status: "unclaimed", broadcastUrl: null }), false,
    "no page either: nothing to archive");
  assert.equal(api.isPageOnly({ status: "refused", broadcastUrl: "https://x/y" }), false,
    "an adapter TRIED and something is wrong at our end -- that belongs in the "
    + "resolver's file, not on a shelf a person browses");
  assert.equal(api.isPageOnly({ status: "empty", broadcastUrl: "https://x/y" }), false);
});

test("isoDate normalises the same way the resolver does", () => {
  assert.equal(api.isoDate("30-09-2026 23:59:00"), "2026-09-30T23:59:00.000Z");
  assert.equal(api.isoDate(null), null);
});
