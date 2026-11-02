#!/usr/bin/env node
"use strict";

/* Trying out a single adapter -- no server, no AUTOPLAY_KEY, no Roon.
 * Meant for working on the Mac when a station is being rebuilt and you want
 * to know what it answers to a particular URL.
 *
 *   cd apps
 *   npm install                       # once (Playwright, node-html-parser)
 *   node try-adapter.js <url>
 *
 * Prints which adapter caught the URL and what it returned, then checks the
 * first stream URL with a range request.
 *
 * That last part is the actual point: an archive broadcast has a length
 * (Content-Length), a livestream does not. So a single call answers whether
 * the broadcast really arrives or the running programme does -- exactly the
 * confusion the station adapters made in silence until 09.08.2026.
 */

const { detectAdapter } = require("./autoplay-pi/dispatch");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node try-adapter.js <url>");
  process.exit(1);
}

function line(key, value) {
  console.log(key.padEnd(12) + (value === null || value === undefined ? "-" : value));
}

async function probe(streamUrl) {
  // Fetch the first bytes only. Some CDNs ignore HEAD, hence a GET with a
  // Range -- and the abort right afterwards.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(streamUrl, {
      headers: { Range: "bytes=0-1023" },
      signal: controller.signal,
    });
    const type = resp.headers.get("content-type") || "?";
    const length = resp.headers.get("content-length");
    const range = resp.headers.get("content-range");
    line("HTTP", resp.status + " " + resp.statusText);
    line("Type", type);
    line("Length", range || length || "not stated");

    const looksLive = !range && !length;
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(streamUrl);
    console.log();
    if (isPlaylist) {
      console.log("=> An HLS playlist. Only its content says whether it is live or archive");
      console.log("   (#EXT-X-ENDLIST = a finished broadcast, otherwise still running).");
    } else if (looksLive) {
      console.log("=> Looks like a LIVESTREAM: no length given.");
    } else {
      console.log("=> Looks like a FINISHED FILE: it has a length.");
    }
    try {
      resp.body && resp.body.cancel && resp.body.cancel();
    } catch (e) {
      // never mind -- we only wanted the head
    }
  } catch (e) {
    line("Fetch", "failed: " + e.message);
  } finally {
    clearTimeout(timer);
  }
}

const adapter = detectAdapter(url);
if (!adapter) {
  console.error("No adapter fits this URL.");
  process.exit(2);
}

adapter
  .extract(url)
  .then(async (r) => {
    line("Source", r.sourceType);
    line("Title", r.title);
    // The field the progress bar in the app hangs on -- the Content-Length
    // further down says something else (bytes, not time).
    line("Duration", r.duration ? Math.floor(r.duration / 60) + ":" + String(Math.floor(r.duration % 60)).padStart(2, "0") : null);
    line("Artist", r.artist);
    line("Cover", r.cover);
    line("Tracks", (r.tracks || []).length);
    (r.tracks || []).slice(0, 5).forEach((t, i) => {
      console.log("  " + (i + 1) + ". " + (t.title || "?"));
      console.log("     " + t.streamUrl);
    });
    if ((r.tracks || []).length > 5) console.log("  … and " + (r.tracks.length - 5) + " more");

    line("Tracklist", r.tracklist ? r.tracklist.length + " entries" : "none");
    (r.tracklist || []).slice(0, 3).forEach((t) => {
      const stamp = t.seconds == null ? "--:--" : Math.floor(t.seconds / 60) + ":" + String(Math.floor(t.seconds % 60)).padStart(2, "0");
      console.log("  " + stamp + "  " + [t.artist, t.title].filter(Boolean).join(" - "));
    });

    const first = (r.tracks || [])[0];
    if (first && first.streamUrl && first.streamUrl.charAt(0) !== "/") {
      console.log();
      console.log("--- stream checked ---");
      await probe(first.streamUrl);
    } else if (first) {
      console.log();
      console.log("The stream sits behind /live/… and is only built by the server -- not checkable here.");
    }
  })
  .catch((e) => {
    console.error("error: " + e.message);
    process.exit(3);
  });
