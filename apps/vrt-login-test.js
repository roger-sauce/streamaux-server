"use strict";

// apps/vrt-login-test.js
//
// Tries the VRT sign-in on its own -- no server, no adapter, no Roon. Run
// it once after putting VRT_USERNAME and VRT_PASSWORD into
// apps/autoplay-pi/.env; it says which of the four steps works and which
// does not, and it prints no token, no cookie and no user name.
//
//   node vrt-login-test.js
//
// The first run opens a real Chromium and signs in, which takes a few
// seconds. Every run after that should be quick: the session is kept in
// apps/autoplay-pi/data/vrt-session.json and only refreshed.

const fs = require("fs");
const path = require("path");

// Read .env by hand: this script runs outside the container, where nothing
// has loaded it yet.
(function loadEnv() {
  const file = path.join(__dirname, "autoplay-pi", ".env");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    console.log("no .env at " + file + " -- relying on the environment");
    return;
  }
  text.split(/\r?\n/).forEach(function (line) {
    const hit = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!hit) return;
    const value = hit[2].replace(/^["']|["']$/g, "");
    if (!process.env[hit[1]]) process.env[hit[1]] = value;
  });
})();

const session = require("./adapters/_vrt-session");

const EPISODE =
  process.argv[2] ||
  "https://www.vrt.be/vrtmax/luister/radio/a/all-that-jazz~31-76/all-that-jazz~31-31868-0/";

function line(label, value) {
  console.log(label.padEnd(28) + value);
}

(async function () {
  const before = session.status();
  line("credentials found", before.hasCredentials ? "yes, in the environment or .env" : "NO -- set VRT_USERNAME and VRT_PASSWORD");
  line("stored session", before.hasStoredSession ? "yes" : "no, will sign in");
  console.log("");

  const started = Date.now();
  let identity;
  try {
    identity = await session.identityToken();
  } catch (e) {
    console.log("step 1, sign-in:      FAILED");
    console.log("  " + e.message);
    process.exit(1);
  }
  line("step 1, sign-in", "ok, " + Math.round((Date.now() - started) / 1000) + " s, token length " + identity.length);

  const tokenResp = await fetch(
    "https://media-services-public.vrt.be/vualto-video-aggregator-web/rest/external/v2/tokens",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityToken: identity }),
    }
  );
  const tokenJson = await tokenResp.json().catch(function () { return {}; });
  line("step 2, player token", tokenResp.status + ", authenticated: " + tokenJson.authenticated);
  if (!tokenJson.vrtPlayerToken || tokenJson.authenticated !== true) {
    console.log("  the sign-in produced no authenticated token -- wrong credentials, or VRT asked something new");
    process.exit(1);
  }

  const archive = require("./adapters/vrt-archive");
  if (!archive.match(EPISODE)) {
    console.log("step 3: the URL is not an episode page: " + EPISODE);
    process.exit(1);
  }
  try {
    const result = await archive.extract(EPISODE);
    line("step 3, the broadcast", result.title);
    line("  length", result.duration === null ? "unknown" : result.duration + " s");
    line("  stream", result.tracks[0].streamUrl.slice(0, 90) + "...");
    console.log("\nall four steps work.");
  } catch (e) {
    console.log("step 3, the broadcast: FAILED");
    console.log("  " + e.message);
    process.exit(1);
  }
})();
