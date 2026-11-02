"use strict";

const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
};

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  setInterval: "readonly",
  self: "readonly",
  caches: "readonly",
};

module.exports = [
  { ignores: ["**/node_modules/**"] },
  {
    files: ["apps/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { caughtErrors: "none" }],
      "no-undef": "error",
    },
  },
  {
    files: ["apps/autoplay-pi/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: browserGlobals,
    },
  },
];
