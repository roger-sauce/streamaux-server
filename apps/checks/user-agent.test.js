"use strict";

// What this project calls itself when it fetches a page.
//
// A test for a single string looks like overkill until you know what the
// string cost. Until 03.11.2026 it read "Mozilla/5.0 (compatible;
// AutoplayPi/1.0)" and Bandcamp answered every one of its three hosts with a
// 200 and a stunted 3036-byte body -- the article adapter reported a missing
// selector, the album adapter fell back quietly, and nothing anywhere looked
// like an error. Measured that day: the same call with an honest product
// token got 371245 bytes; a bare "node" got the full page too. It was never
// automation that was refused, it was the half-hearted disguise.
//
// So this nails down the two properties that mattered, not the exact wording:
// no browser name, and a contact address. Both are the practice the project
// states in resolve-week.js -- "identifying yourself honestly is being a
// well-behaved client, pretending to be Chrome is defeating a measure someone
// put there on purpose" -- which the old value quietly broke.

const test = require("node:test");
const assert = require("node:assert");

const { USER_AGENT } = require("../adapters/_shared");

test("the agent does not pretend to be a browser", () => {
  for (const name of ["Mozilla", "Chrome", "Safari", "AppleWebKit", "Gecko"]) {
    assert.ok(
      !USER_AGENT.includes(name),
      "USER_AGENT carries \"" + name + "\": " + USER_AGENT
    );
  }
});

test("the agent says where to look up who is calling", () => {
  // The convention search engines use: a `+` and an address, so that an
  // administrator who sees the line in a log can find out what it was.
  assert.match(USER_AGENT, /\(\+https?:\/\/\S+\)/, USER_AGENT);
});

test("the agent names the product and a version", () => {
  assert.match(USER_AGENT, /^[a-z][a-z0-9-]*\/\d+\.\d+/, USER_AGENT);
});
