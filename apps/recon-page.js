#!/usr/bin/env node
"use strict";

/* Sounding out a page before an adapter is built for it.
 *
 *   cd apps
 *   node recon-page.js <url>
 *
 * Searches the raw HTML for what an adapter will later draw on: media URLs,
 * embedded JSON blocks (__NEXT_DATA__, ld+json, data-* attributes) and
 * references to APIs. Prints sizes and key names rather than the whole
 * content -- the question is "where does it say it", not "what does it
 * say".
 *
 * Written on 09.08.2026: the adapters for Bandcamp and the ARD archives
 * could only be built without guesswork because somebody had looked at how
 * the page is put together first.
 */

const url = process.argv[2];
if (!url) {
  console.error("Usage: node recon-page.js <url>");
  process.exit(1);
}

const MEDIA_RE = /https?:\/\/[^\s"'<>\\]+\.(?:mp3|m4a|aac|ogg|m3u8|mpd)(?:\?[^\s"'<>\\]*)?/gi;
const API_RE = /https?:\/\/[a-z0-9.-]+\/[^\s"'<>\\]*(?:graphql|\/api\/|\/items\/|playlist)[^\s"'<>\\]*/gi;

function uniq(list) {
  return [...new Set(list || [])];
}

function head(text, n) {
  return text.length > n ? text.slice(0, n) + " …" : text;
}

fetch(url, {
  headers: {
    // Without a plausible browser header some pages serve a different,
    // poorer version -- or nothing at all.
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "accept-language": "de-DE,de;q=0.9",
  },
})
  .then((r) => {
    console.log("HTTP        " + r.status + " " + r.statusText);
    console.log("Type        " + (r.headers.get("content-type") || "?"));
    return r.text();
  })
  .then((html) => {
    console.log("Size        " + html.length + " characters");
    console.log();

    const media = uniq(html.match(MEDIA_RE));
    console.log("--- media URLs in the HTML: " + media.length + " ---");
    media.slice(0, 8).forEach((u) => console.log("  " + head(u, 160)));
    if (!media.length) {
      console.log("  none. The page probably pulls the audio in with JavaScript only --");
      console.log("  then the way in is the API below, or Playwright.");
    }
    console.log();

    const apis = uniq(html.match(API_RE));
    console.log("--- references to APIs: " + apis.length + " ---");
    apis.slice(0, 8).forEach((u) => console.log("  " + head(u, 160)));
    console.log();

    console.log("--- embedded JSON blocks ---");
    const next = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (next) {
      console.log("__NEXT_DATA__: " + next[1].length + " characters");
      try {
        const data = JSON.parse(next[1]);
        const page = (data.props && data.props.pageProps) || {};
        console.log("  props.pageProps: " + Object.keys(page).join(", "));
      } catch (e) {
        console.log("  (not readable as JSON: " + e.message + ")");
      }
    } else {
      console.log("__NEXT_DATA__: not present");
    }

    const ld = uniq(html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi));
    console.log("ld+json:       " + ld.length + " block(s)");
    ld.slice(0, 2).forEach((block) => {
      const inner = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/, "");
      try {
        const parsed = JSON.parse(inner);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((it) => console.log("  @type " + (it["@type"] || "?") + ": " + Object.keys(it).join(", ")));
      } catch (e) {
        console.log("  (not readable)");
      }
    });

    const dataAttrs = uniq((html.match(/data-[a-z0-9-]*(?:player|audio|tralbum|media|episode)[a-z0-9-]*=/gi) || []));
    console.log("data attributes: " + (dataAttrs.length ? dataAttrs.join(" ") : "none of note"));
  })
  .catch((e) => {
    console.error("error: " + e.message);
    process.exit(2);
  });
