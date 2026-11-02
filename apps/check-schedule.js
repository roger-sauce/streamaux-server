#!/usr/bin/env node
"use strict";

/* Going through the konzert-guide's own week, entry by entry -- no server,
 * no AUTOPLAY_KEY, no Roon.
 *
 *   cd apps
 *   node check-schedule.js ../../konzert-guide/snapshots/schedule-2026-08-18.json
 *   node check-schedule.js <file> --extract --station rne_radio3
 *   node check-schedule.js <file> --extract --limit 20
 *
 * Two stages, because they cost wildly different amounts.
 *
 * WHICH ADAPTER CLAIMS IT runs for every entry and needs no network at all:
 * match() is a regular expression. That alone answers the most useful
 * question -- is this station reachable from the guide's addresses -- and it
 * answers it for all of them in a second.
 *
 * WHAT THE ADAPTER ANSWERS runs only with --extract, one entry after another,
 * and does touch the network: it is the same work the server does on
 * /api/play-roon, minus ffmpeg. Sequential on purpose. Several of these
 * adapters start Playwright, and a fan-out would say more about the Mac than
 * about the stations.
 *
 * The address is assembled the way the KonzertGuide app assembles it before
 * sharing: the entry's own broadcastUrl plus the #kg fragment carrying start
 * time, title and length. Without that fragment a series resolver has nothing
 * to choose the night by and refuses -- correctly -- so a check without it
 * would measure the wrong thing.
 */

const fs = require("fs");
const path = require("path");
const { detectAdapter } = require("./autoplay-pi/dispatch");

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith("--")) {
  console.error("Usage: node check-schedule.js <schedule.json> [--extract] [--station <id>] [--limit <n>]");
  process.exit(1);
}

function flag(name) {
  return args.includes("--" + name);
}

function option(name, fallback) {
  const at = args.indexOf("--" + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

const doExtract = flag("extract");
const onlyStation = option("station", null);
const limit = Number(option("limit", 0)) || 0;

// A name for each adapter module, so the table says "rtve-series" rather than
// the anonymous object the dispatcher hands back. Built by requiring the same
// files the dispatcher requires: node caches modules, so the objects compare
// identical and no guessing by URL is needed.
function adapterNames() {
  const names = new Map();
  for (const dir of ["adapters", "adapters/radiostations"]) {
    const full = path.join(__dirname, dir);
    let entries = [];
    try {
      entries = fs.readdirSync(full);
    } catch (e) {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".js")) continue;
      try {
        const mod = require(path.join(full, name));
        const label = (dir.endsWith("radiostations") ? "station/" : "") + name.replace(/\.js$/, "");
        names.set(mod, label);
      } catch (e) {
        // A module that will not even load is a finding of its own, but not
        // this tool's business -- the dispatcher would have failed first.
      }
    }
  }
  return names;
}

// What the app shares. kg is the only part a series resolver reads; kgt and
// kgd are there because ard-programme uses them to tell two editions of the
// same evening apart.
function sharedUrl(concert) {
  const base = String(concert.broadcastUrl || "");
  if (!base) return "";
  const parts = ["kg=" + encodeURIComponent(concert.startTime || "")];
  if (concert.title) parts.push("kgt=" + encodeURIComponent(concert.title));
  if (concert.durationMin) parts.push("kgd=" + encodeURIComponent(String(concert.durationMin)));
  return base + (base.includes("#") ? "&" : "#") + parts.join("&");
}

function firstLine(text) {
  return String(text || "").split("\n")[0].trim();
}

async function extractWithTimeout(adapter, url, ms) {
  let timer;
  const timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(new Error("no answer within " + Math.round(ms / 1000) + "s"));
    }, ms);
  });
  try {
    return await Promise.race([adapter.extract(url), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const all = Array.isArray(raw.concerts) ? raw.concerts : [];
  const names = adapterNames();

  let concerts = all;
  if (onlyStation) concerts = concerts.filter((c) => c.stationId === onlyStation);

  console.log("Datei       " + file);
  console.log("Sammlung    " + (raw.generatedAt || "-"));
  console.log("Eintraege   " + concerts.length + " von " + all.length + (onlyStation ? " (" + onlyStation + ")" : ""));
  console.log("");

  const rows = concerts.map(function (c) {
    const url = sharedUrl(c);
    let adapter = null;
    let label = "KEIN ADAPTER";
    try {
      adapter = url && detectAdapter(url);
      if (adapter) label = names.get(adapter) || "unbekanntes Modul";
    } catch (e) {
      label = "FEHLER beim Zuordnen: " + firstLine(e.message);
    }
    return { concert: c, url: url, adapter: adapter, label: label };
  });

  const byStation = new Map();
  for (const row of rows) {
    const station = row.concert.stationId || "?";
    const counts = byStation.get(station) || new Map();
    counts.set(row.label, (counts.get(row.label) || 0) + 1);
    byStation.set(station, counts);
  }

  console.log("=== Welcher Adapter faengt die Adresse ===");
  for (const [station, counts] of [...byStation].sort()) {
    const parts = [...counts].map(([name, n]) => name + " x" + n).join(", ");
    console.log("  " + station.padEnd(18) + parts);
  }

  const orphans = rows.filter((r) => !r.adapter);
  if (orphans.length) {
    console.log("");
    console.log("=== Ohne Adapter (" + orphans.length + ") ===");
    const seen = new Set();
    for (const row of orphans) {
      const key = row.concert.stationId + " " + (row.concert.broadcastUrl || "(leere Adresse)");
      if (seen.has(key)) continue;
      seen.add(key);
      console.log("  " + key);
    }
  }

  if (!doExtract) {
    console.log("");
    console.log("Mit --extract laeuft zusaetzlich jede Adresse durch ihren Adapter.");
    return;
  }

  const todo = rows.filter((r) => r.adapter).slice(0, limit || undefined);
  console.log("");
  console.log("=== Was der Adapter antwortet (" + todo.length + ") ===");

  const tally = { ok: 0, leer: 0, abgelehnt: 0 };
  for (const [index, row] of todo.entries()) {
    const c = row.concert;
    const head = String(index + 1).padStart(3) + ". " + (c.stationId || "?").padEnd(16) +
      (c.dateKey || "") + " " + (c.time || "") + "  " + String(c.title || "").slice(0, 46);
    try {
      const result = await extractWithTimeout(row.adapter, row.url, 90000);
      const tracks = (result && result.tracks) || [];
      if (!tracks.length) {
        tally.leer += 1;
        console.log(head + "\n     LEER      " + row.label + " -- kein Stueck in der Antwort");
        continue;
      }
      tally.ok += 1;
      console.log(head + "\n     OK        " + row.label + " -- " + tracks.length +
        " Stueck, \"" + String(result.title || "").slice(0, 50) + "\"");
    } catch (e) {
      tally.abgelehnt += 1;
      // A refusal and a fault look the same from here, and telling them apart
      // is the reader's job: an adapter that says "this page carries no
      // recording" has worked correctly.
      console.log(head + "\n     ABGELEHNT " + row.label + " -- " + firstLine(e.message).slice(0, 150));
    }
  }

  console.log("");
  console.log("OK " + tally.ok + " | leer " + tally.leer + " | abgelehnt " + tally.abgelehnt);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
