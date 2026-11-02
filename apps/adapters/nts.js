#!/usr/bin/env node
/**
 * adapters/nts.js
 *
 * Extraction adapter for NTS archive episodes (nts.live/shows/<show>/episodes/<episode>).
 * Opens the episode headless, clicks play and catches the real audio stream
 * URL (currently the SoundCloud case, over a CloudFront-signed HLS
 * playlist). The Mixcloud case follows once we know its URL pattern.
 *
 * Contract (shared with the other planned adapters -- mk, Wire, Bandcamp,
 * SoundCloud directly):
 *   match(url) => boolean
 *   extract(url) => Promise<{ title, streamUrl, sourceType }>
 */

/* global document -- runs in a few places (page.evaluate callbacks) in the browser context, not in Node */

const { chromium } = require("playwright");
const { extractMixcloudStream } = require("./_mixcloud");

const NTS_URL_RE = /^https?:\/\/(www\.)?nts\.live\/shows\/.+\/episodes\/.+/i;

// The pattern of the one playlist URL we can hand straight to ffmpeg --
// confirmed on 2026-07-19 by recording it by hand in devtools.
const SOUNDCLOUD_PLAYLIST_RE = /cf-hls-media\.sndcdn\.com\/playlist\/[^"']+\.m3u8\?[^"'\s]+/i;

const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  'button:has-text("Allow All")',
  'button:has-text("ALLOW ALL")',
  'button:has-text("Accept All Cookies")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("Akzeptieren")',
  'button:has-text("I agree")',
];

const PLAY_SELECTORS = [
  ".profile__play-button",
  ".profile-image__play-button",
  ".soundcloud-player__play-button",
  ".soundcloud-player__thumbnail",
  ".mixcloud-player",
  'button[aria-label*="play" i]',
  'button[title*="play" i]',
  '[data-testid*="play" i]',
  ".playButton",
  ".play-button",
];

async function dismissConsent(page) {
  for (const sel of CONSENT_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 2000 });
        return true;
      }
    } catch (e) {}
  }
  // Nuclear fallback: hide anything cookie or consent shaped with JS
  try {
    await page.evaluate(() => {
      const sels = [
        "#onetrust-consent-sdk",
        ".onetrust-pc-dialog",
        '[id*="cookie" i][id*="consent" i]',
        '[class*="cookie" i][class*="consent" i]',
        '[class*="cookie" i][class*="banner" i]',
        '[class*="cookie" i][class*="modal" i]',
      ];
      sels.forEach((s) =>
        document.querySelectorAll(s).forEach((el) => (/** @type {HTMLElement} */ (el).style.display = "none"))
      );
    });
  } catch (e) {}
  return false;
}

async function tryClickPlay(frameOrPage) {
  for (const sel of PLAY_SELECTORS) {
    try {
      const el = frameOrPage.locator(sel).first();
      const count = await el.count();
      if (count > 0) {
        await el.click({ timeout: 3000 });
        console.log(`[nts]   click ok: ${sel} (count=${count})`);
        if (sel !== PLAY_SELECTORS[0]) {
          console.warn(
            `[nts][WARN][SELECTOR_DRIFT] play button did not react to the primary selector "${PLAY_SELECTORS[0]}", ` +
              `but only to the fallback "${sel}". NTS may have changed its markup -- check PLAY_SELECTORS.`
          );
        }
        return true;
      }
    } catch (e) {
      console.log(`[nts]   click failed: ${sel} ->\n${e.message}`);
    }
  }
  return false;
}

// Scraped from the static DOM (.tracklist__tracks li.track), independently
// of the play click -- artist, title and timestamp as they stand on the
// episode page itself (some timestamps are locked behind "NTS Supporter"
// and show only "--:--", in which case seconds stays null).
async function scrapeTracklist(page) {
  try {
    return await page.evaluate(() => {
      function parseTimestamp(text) {
        if (!text || text.trim() === "--:--") return null;
        var parts = text.trim().split(":").map(Number);
        if (parts.some((n) => Number.isNaN(n))) return null;
        return parts.reduce((acc, n) => acc * 60 + n, 0);
      }
      return Array.from(document.querySelectorAll(".tracklist__tracks li.track")).map((li) => {
        var artistEls = Array.from(li.querySelectorAll(".track__artist:not(.track__artist--mobile)"));
        var titleEl = li.querySelector(".track__title");
        var tsEl = li.querySelector(".track__timestamp");
        return {
          artist: artistEls.map((el) => el.textContent.trim()).join(", "),
          title: titleEl ? titleEl.textContent.trim() : "",
          seconds: tsEl ? parseTimestamp(tsEl.textContent) : null,
        };
      });
    });
  } catch (e) {
    return [];
  }
}

// NTS' own JSON API returns, among other things, a "mixcloud" field per
// episode holding the full Mixcloud URL where the episode is mirrored
// there, plus a tracklist endpoint of its own (confirmed with DevTools
// 2026-07-21: /api/v2/shows/<show>/episodes/<episode> and .../tracklist).
// Where "mixcloud" is set that saves the Playwright detour over the NTS
// page -- the Mixcloud widget loaded dynamically there stays empty even
// after the play click (see the recon notes), so there is nothing to catch
// anyway.
function parseNtsPath(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const show = parts[parts.indexOf("shows") + 1];
  const episode = parts[parts.indexOf("episodes") + 1];
  return show && episode ? { show, episode } : null;
}

async function fetchNtsMeta(show, episode) {
  try {
    const resp = await fetch(`https://www.nts.live/api/v2/shows/${show}/episodes/${episode}`, {
      headers: { accept: "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// Tracklist entries carry "offset" (seconds, often null for unconfirmed
// identifications) and "offset_estimate" as a fallback guess -- offset
// wins, otherwise the estimate, otherwise null, as with the other adapters.
async function fetchNtsTracklist(show, episode) {
  try {
    const resp = await fetch(`https://www.nts.live/api/v2/shows/${show}/episodes/${episode}/tracklist`, {
      headers: { accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((t) => ({
      artist: t.artist || "",
      title: t.title || "",
      seconds:
        typeof t.offset === "number" ? t.offset : typeof t.offset_estimate === "number" ? t.offset_estimate : null,
    }));
  } catch (e) {
    return [];
  }
}

function match(url) {
  return NTS_URL_RE.test(url);
}

async function extract(url, { timeoutMs = 20000 } = {}) {
  if (!match(url)) throw new Error(`nts-adapter: URL does not match: ${url}`);

  const ntsPath = parseNtsPath(url);
  const meta = ntsPath ? await fetchNtsMeta(ntsPath.show, ntsPath.episode) : null;
  if (meta && meta.mixcloud) {
    const streamUrl = await extractMixcloudStream(meta.mixcloud);
    const title = meta.name || (meta.episode_alias || "NTS Episode").replace(/-/g, " ");
    const tracklist = await fetchNtsTracklist(ntsPath.show, ntsPath.episode);
    return {
      title,
      sourceType: "mixcloud",
      tracks: [{ title, streamUrl }],
      tracklist: tracklist.length ? tracklist : [{ artist: "", title: "Tracklist on the NTS page", seconds: null }],
    };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  let streamUrl = null;
  let sourceType = null;
  /** @type {Promise<void>} */
  const streamFound = new Promise((resolve) => {
    page.on("response", (response) => {
      const u = response.url();
      if (!streamUrl && SOUNDCLOUD_PLAYLIST_RE.test(u)) {
        streamUrl = u;
        sourceType = "soundcloud";
        resolve();
      }
    });
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("[nts] page loaded");
    await dismissConsent(page);
    console.log("[nts] consent banner handled");
    await page.waitForTimeout(1000);

    let clicked = await tryClickPlay(page);
    if (!clicked) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (/soundcloud|mixcloud/i.test(frame.url())) {
          clicked = await tryClickPlay(frame);
          if (clicked) break;
        }
      }
    }
    console.log(`[nts] play click: ${clicked ? "succeeded" : "failed"}`);

    const title = await page.title();
    console.log(`[nts] title: ${title} - waiting for the stream (max ${timeoutMs}ms)...`);

    const tracklist = await scrapeTracklist(page);
    console.log(`[nts] tracklist: ${tracklist.length} entries found`);

    await Promise.race([streamFound, page.waitForTimeout(timeoutMs)]);

    if (!streamUrl) {
      console.error(
        `[nts][ERROR][NO_STREAM_FOUND] url=${url} time=${new Date().toISOString()} ` +
          `title="${title}" playClicked=${clicked}`
      );
      throw new Error(
        "nts-adapter: no stream found (possibly a Mixcloud episode, not supported yet, or the play click failed)"
      );
    }

    return { title, sourceType, tracks: [{ title, streamUrl }], tracklist };
  } finally {
    await browser.close();
  }
}

module.exports = { match, extract };
