"use strict";
const { chromium } = require("playwright");

/* THE ADDRESS THE PLAYER FETCHES, and the host in it is not a constant.
 *
 * It read `aod.mixcloud.stream` until 09.11.2026 and Mixcloud has since moved
 * the same files to `aod.mixcloud.com`. Measured that day on a Wire show: the
 * click worked, the aria-label turned to "Click to pause", three manifests
 * came in with 200 -- and none of them matched, so the adapter sat out its
 * timeout and reported "the play click failed or the page has changed". It
 * had done neither. The only thing that had changed was a hostname.
 *
 * Both are accepted now rather than one being swapped for the other: the old
 * host may still serve older shows, and a rule that takes both cannot be
 * wrong about which era a recording comes from.
 *
 * What stays fixed is the shape -- /secure/hls/ and an index.m3u8 at the end.
 * That is what distinguishes the master playlist from the per-track manifest
 * (streamindex-a1.m3u8) that follows it, and taking the wrong one of those
 * hands ffmpeg a single rendition instead of the real entry point.
 */
const PLAYLIST_RE = /aod\.mixcloud\.(?:stream|com)\/secure\/hls\/.*\/index\.m3u8/i;

const CONSENT_SELECTORS = [
  'button:has-text("Ok")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Akzeptieren")',
];

async function dismissConsent(page) {
  for (const sel of CONSENT_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 2000 });
        return;
      }
    } catch (e) {}
  }
}

// Finds the real, standalone mixcloud.com page (not the embedded
// cross-origin iframe widget), which automates far more reliably --
// confirmed on 2026-07-20. The selector goes by aria-label rather than CSS
// classes, because Mixcloud uses generated, unstable class names (React
// atomic CSS).
async function extractMixcloudStream(mixcloudUrl, { timeoutMs = 20000 } = {}) {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[mixcloud][page-console][error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`[mixcloud][page-error] ${err.message}`);
  });

  let streamUrl = null;
  /** @type {Promise<void>} */
  const found = new Promise((resolve) => {
    page.on("response", (response) => {
      const u = response.url();
      if (/mixcloud\.(?:stream|com)\/secure\/hls|\.m3u8/i.test(u)) {
        console.log(`[mixcloud][net] ${response.status()} ${u}`);
      }
      if (!streamUrl && PLAYLIST_RE.test(u)) {
        streamUrl = u;
        resolve();
      }
    });
  });
  page.on("requestfailed", (request) => {
    const u = request.url();
    if (/mixcloud\.(?:stream|com)\/secure\/hls|\.m3u8/i.test(u)) {
      console.log(`[mixcloud][net-failed] ${request.failure()?.errorText} ${u}`);
    }
  });

  try {
    await page.goto(mixcloudUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(`[mixcloud][DEBUG] loaded: ${page.url()} - title: "${await page.title()}"`);
    await dismissConsent(page);
    await page.waitForTimeout(4000);

    // The click is sometimes without effect (presumably a React hydration
    // race -- see "Minified React error #418" in the logs, which turns up
    // in exactly that window). Try again up to three times, each time with
    // a freshly fetched button handle, before giving up.
    const CLICK_ATTEMPTS = 3;
    const CLICK_RETRY_WAIT_MS = 2500;
    for (let attempt = 1; attempt <= CLICK_ATTEMPTS && !streamUrl; attempt++) {
      const playBtn = page.locator('button[aria-label="Click to play"]').first();
      const playBtnCount = await playBtn.count();
      console.log(`[mixcloud][DEBUG] attempt ${attempt}/${CLICK_ATTEMPTS} - play buttons found: ${playBtnCount}`);
      try {
        const handle = await playBtn.elementHandle();
        if (!handle) throw new Error("play button handle not found");
        await handle.evaluate((el) => /** @type {HTMLElement} */ (el).click());
        await page.waitForTimeout(500);
        const ariaAfter = await handle.evaluate((el) => el.getAttribute("aria-label"));
        console.log(`[mixcloud][DEBUG] aria-label after the click: "${ariaAfter}"`);
      } catch (e) {
        console.log(`[mixcloud] play click failed (attempt ${attempt}):\n${e.message}`);
      }
      await Promise.race([found, page.waitForTimeout(CLICK_RETRY_WAIT_MS)]);
    }

    const remainingMs = Math.max(timeoutMs - CLICK_ATTEMPTS * CLICK_RETRY_WAIT_MS, 0);
    await Promise.race([found, page.waitForTimeout(remainingMs)]);
    if (!streamUrl) {
      // The screenshot is a diagnostic aid only -- it must not bury the
      // actual error message (EACCES on /app/debug did exactly that on
      // 2026-07-25: a root-owned bind mount folder).
      try {
        const screenshotPath = "/app/debug/mixcloud-debug-" + Date.now() + ".png";
        await page.screenshot({ path: screenshotPath });
        console.log(`[mixcloud][DEBUG] Screenshot: ${screenshotPath}`);
      } catch (e) {
        console.log(`[mixcloud][DEBUG] screenshot failed (ignored): ${e.message}`);
      }
      throw new Error("mixcloud: no stream found (the play click failed or the page has changed)");
    }
    return streamUrl;
  } finally {
    await browser.close();
  }
}

// PLAYLIST_RE is exported for checks/mixcloud-playlist.test.js: it is the
// rule that broke, it is pure, and a hostname is exactly the kind of thing
// that moves again.
module.exports = { extractMixcloudStream, PLAYLIST_RE };
