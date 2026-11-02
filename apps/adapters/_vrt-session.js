"use strict";

// adapters/_vrt-session.js
//
// Keeps a VRT MAX session so the archive adapter can ask for a fresh
// identityToken without thinking about it.
//
// Why a real browser instead of a scripted login: VRT signs in through an
// OpenID Connect flow at login.vrt.be with PKCE, a CSRF marker, several
// redirects and a server-side session, and hands the site back only a
// short-lived cookie (measured 12.08.2026: vrtnu-site_profile_vt lives
// about an hour). Rebuilding that chain by hand would break the first time
// VRT rearranges a form. Chromium walks the real pages instead -- the same
// trick the BBC factory used against the mediaselector.
//
// The password is needed rarely, not hourly: after the first sign-in the
// browser's storage state (cookies and local storage, VRT's SESSION cookie
// among them) is kept in data/vrt-session.json, and a refresh is then a
// page visit with that state restored. Only when VRT has dropped the
// session does it sign in again.
//
// Nothing here is logged that could identify the account -- no token, no
// cookie, no user name. Failures name the step, not the value.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const COOKIE_NAME = "vrtnu-site_profile_vt";
// A page that is cheap to load and definitely behind the session.
const WARM_PAGE = "https://www.vrt.be/vrtmax/";
// The site's own entry into the sign-in: it answers 302 to
// login.vrt.be/authorize with a freshly minted state, nonce and PKCE
// challenge, so none of that has to be built here. Confirmed 12.08.2026.
const LOGIN_PAGE = "https://www.vrt.be/vrtmax/sso/login";
// Renew a little before the end rather than on it: an extraction that
// starts at 59 minutes must not run into a token that dies mid-request.
const RENEW_MARGIN_MS = 5 * 60 * 1000;
const STATE_FILE = path.join(__dirname, "..", "autoplay-pi", "data", "vrt-session.json");

// Held across calls so a burst of extractions does not start five browsers.
let cached = null;
let inFlight = null;

function credentials() {
  const user = process.env.VRT_USERNAME;
  const password = process.env.VRT_PASSWORD;
  if (!user || !password) {
    throw new Error(
      "VRT_USERNAME and VRT_PASSWORD are not set. Broadcasts on VRT MAX are only " +
        "released to signed-in accounts; add both to apps/autoplay-pi/.env."
    );
  }
  return { user: user, password: password };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
  } catch (e) {
    // Not being able to remember the session costs a sign-in, not the request.
  }
}

function tokenFrom(cookies) {
  const hit = (cookies || []).find(function (c) { return c.name === COOKIE_NAME; });
  if (!hit || !hit.value) return null;
  // Playwright reports expires in seconds, -1 for a session cookie.
  const expiresAt = hit.expires && hit.expires > 0 ? hit.expires * 1000 : Date.now() + 30 * 60 * 1000;
  return { token: hit.value, expiresAt: expiresAt };
}

function usable(entry) {
  return entry && entry.token && entry.expiresAt - RENEW_MARGIN_MS > Date.now();
}

// A consent dialog in front of the form would swallow every click. Tried
// in passing: if none is there, nothing happens and nothing is reported.
async function dismissConsent(page) {
  const labels = [
    "Alles aanvaarden", "Alles accepteren", "Ik ga akkoord", "Akkoord",
    "Accepteren", "Alle cookies aanvaarden", "Accept all",
  ];
  for (const label of labels) {
    const button = page.getByRole("button", { name: label, exact: false }).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        return;
      }
    } catch (e) {
      // next candidate
    }
  }
}

// Only on demand, and only into the temp directory: when a sign-in fails
// the one thing worth having is the page it failed on.
async function dumpForDiagnosis(page, tag) {
  if (!process.env.VRT_DEBUG) return "";
  const base = path.join(os.tmpdir(), "vrt-" + tag);
  try {
    await page.screenshot({ path: base + ".png", fullPage: true });
    fs.writeFileSync(base + ".txt", page.url() + "\n\n" + (await page.title()));
    return " (VRT_DEBUG: " + base + ".png)";
  } catch (e) {
    return "";
  }
}

// The form is walked defensively: VRT asks for the address first and the
// password on the next screen, and the field names have changed before.
// Each step says where the browser stopped when it gives up, so a failure
// reads as "no password field appeared, still at login.vrt.be/..." rather
// than as a bare timeout.
async function signIn(page, creds) {
  await page.goto(LOGIN_PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await dismissConsent(page);

  const userField = page
    .locator('input[type="email"], input[name="username"], input[name="email"], input[autocomplete="username"]')
    .first();
  try {
    await userField.waitFor({ state: "visible", timeout: 20000 });
  } catch (e) {
    throw new Error(
      "vrt-session: no field for the user name appeared, the browser stopped at " +
        page.url() + (await dumpForDiagnosis(page, "username"))
    );
  }
  await userField.fill(creds.user);
  await page.keyboard.press("Enter");

  const passwordField = page.locator('input[type="password"]').first();
  try {
    await passwordField.waitFor({ state: "visible", timeout: 20000 });
  } catch (e) {
    throw new Error(
      "vrt-session: no password field appeared after the user name, the browser stopped at " +
        page.url() + (await dumpForDiagnosis(page, "password"))
    );
  }
  await passwordField.fill(creds.password);
  await page.keyboard.press("Enter");

  // Back on vrt.be means the redirect chain has run through.
  try {
    await page.waitForURL(/www\.vrt\.be/, { timeout: 45000 });
  } catch (e) {
    throw new Error(
      "vrt-session: sign-in did not return to www.vrt.be, the browser stopped at " +
        page.url() + " -- wrong credentials, or VRT is asking something new (a second " +
        "factor, a consent screen)" + (await dumpForDiagnosis(page, "return"))
    );
  }
  await page.waitForTimeout(2000);
}

// VRT does not hand the cookie out at the moment of signing in but when a
// page asks for it, and a little client-side work runs first. So: load the
// page, look, wait, look again -- rather than deciding after one glance.
async function waitForToken(context, page, attempts) {
  let entry = tokenFrom(await context.cookies());
  for (let i = 0; i < attempts && !usable(entry); i++) {
    await page.goto(WARM_PAGE, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(function () {});
    await page.waitForTimeout(2500);
    entry = tokenFrom(await context.cookies());
  }
  return entry;
}

// Names only, never values: enough to see whether VRT renamed the cookie or
// left the session somewhere else entirely.
async function cookieNames(context) {
  const names = (await context.cookies())
    .map(function (c) { return c.name; })
    .filter(function (n) { return /vrt|session|profile/i.test(n); });
  return names.length ? names.join(", ") : "none";
}

async function obtain() {
  const stored = readState();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(
      stored && stored.storageState ? { storageState: stored.storageState } : {}
    );
    const page = await context.newPage();

    // First without the password: if the stored session still stands, a
    // page visit is enough and VRT hands out a fresh cookie by itself.
    await page.goto(WARM_PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
    let entry = await waitForToken(context, page, 2);

    if (!usable(entry)) {
      await signIn(page, credentials());
      entry = await waitForToken(context, page, 4);
    }
    if (!usable(entry)) {
      throw new Error(
        "vrt-session: signed in, but no usable " + COOKIE_NAME + " cookie. Cookies on vrt.be " +
          "after the sign-in: " + (await cookieNames(context)) +
          (await dumpForDiagnosis(page, "cookie"))
      );
    }

    writeState({ storageState: await context.storageState(), expiresAt: entry.expiresAt });
    return entry;
  } finally {
    await browser.close();
  }
}

// Returns the identityToken for POST .../vualto-video-aggregator-web/rest/external/v2/tokens.
async function identityToken() {
  if (usable(cached)) return cached.token;
  // A second caller waits for the first browser instead of starting its own.
  if (!inFlight) {
    inFlight = obtain()
      .then(function (entry) { cached = entry; return entry; })
      .finally(function () { inFlight = null; });
  }
  const entry = await inFlight;
  return entry.token;
}

// For the test script: says what is known without giving the token away.
function status() {
  const stored = readState();
  return {
    hasCredentials: Boolean(process.env.VRT_USERNAME && process.env.VRT_PASSWORD),
    hasStoredSession: Boolean(stored && stored.storageState),
    cachedUntil: cached ? new Date(cached.expiresAt).toISOString() : null,
    stateFile: STATE_FILE,
  };
}

module.exports = { identityToken: identityToken, status: status, COOKIE_NAME: COOKIE_NAME };
