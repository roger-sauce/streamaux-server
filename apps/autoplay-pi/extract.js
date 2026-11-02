#!/usr/bin/env node
const { detectAdapter } = require("./dispatch");

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node extract.js <episode-url>");
    process.exit(1);
  }
  const adapter = detectAdapter(url);
  if (!adapter) {
    console.error("No adapter fits this URL.");
    process.exit(1);
  }
  console.log("[extract] adapter found, extracting...");
  const result = await adapter.extract(url);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error("[extract] error:", e.message);
  process.exit(1);
});
