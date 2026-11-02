"use strict";

// checks/cashmere-archive.test.js
//
// The markup below is copied from a live episode page (astral-traveling-40-w-
// maxime-l, read 30.09.2026), shortened but not reworded. What is tested is
// the three rules that read the page; extract() itself needs Mixcloud and a
// browser and is not tested here.

const test = require("node:test");
const assert = require("node:assert");

const {
  match,
  mixcloudUrlFrom,
  titleFrom,
  tracklistFrom,
} = require("../adapters/cashmere-archive");

const IFRAME =
  '<iframe src="https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1' +
  "&light=1&feed=%2FCashmereRadio%2Fastral-traveling-40-w-maxime-l-28052024%2F\" " +
  'width="100%" height="120" frameborder="0"></iframe>';

const NEXT_DATA =
  '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":' +
  '{"episode":{"acf":{"episodeDate":"20240528","episodeMixcloudLink":' +
  '"https://mixcloud.com/CashmereRadio/astral-traveling-40-w-maxime-l-28052024/"' +
  "}}}}}</script>";

const PLAYLIST =
  '<h2 class="css-szaf2w">Playlist</h2><div class="css-1mosoun">' +
  "* Fatima Miranda - Canto Largo<br>" +
  " * Le Mystere Des Voix Bulgares - Kalimankou Denkou<br>" +
  " * Alice Coltrane - Journey In Satchidananda<br>" +
  "</div></article>";

const URL = "https://cashmereradio.com/episode/astral-traveling-40-w-maxime-l/";

test("match takes episode pages and leaves the rest", () => {
  assert.equal(match(URL), true);
  assert.equal(match("http://www.cashmereradio.com/episode/some-show/"), true);
  assert.equal(match("https://cashmereradio.com/"), false);
  assert.equal(match("https://cashmereradio.com/schedule/"), false);
  assert.equal(match("https://www.mixcloud.com/CashmereRadio/some-show/"), false);
});

// The delivered page has the JSON and no iframe: indexOf("widget/iframe")
// answered -1 against the live page on 30.09.2026, 159417 bytes. React builds
// the player afterwards. So the JSON is the case that must work, and it is
// also the one that must be preferred where both stand there.
test("the ACF field answers, normalised to the www host", () => {
  assert.equal(
    mixcloudUrlFrom("<html>" + NEXT_DATA + "</html>"),
    "https://www.mixcloud.com/CashmereRadio/astral-traveling-40-w-maxime-l-28052024/"
  );
});

test("with both present the JSON wins and nothing is logged", () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    assert.equal(
      mixcloudUrlFrom("<html>" + IFRAME + NEXT_DATA + "</html>"),
      "https://www.mixcloud.com/CashmereRadio/astral-traveling-40-w-maxime-l-28052024/"
    );
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, [], "a warning on the normal case trains the reader to ignore it");
});

test("without the JSON the iframe answers, and says so", () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    assert.equal(
      mixcloudUrlFrom("<html>" + IFRAME + "</html>"),
      "https://www.mixcloud.com/CashmereRadio/astral-traveling-40-w-maxime-l-28052024/"
    );
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SELECTOR_DRIFT/);
});

// An ampersand in an attribute arrives escaped, and then the character before
// `feed` is a semicolon. The first version of the rule read [?&] and would
// have missed a server-rendered player entirely.
test("the iframe is read with an escaped ampersand too", () => {
  const escaped = IFRAME.replace(/&/g, "&amp;");
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      mixcloudUrlFrom("<html>" + escaped + "</html>"),
      "https://www.mixcloud.com/CashmereRadio/astral-traveling-40-w-maxime-l-28052024/"
    );
  } finally {
    console.warn = warn;
  }
});

test("a page without either source returns null, not a guess", () => {
  assert.equal(mixcloudUrlFrom("<html><body>coming soon</body></html>"), null);
});

// The station name hangs on BOTH fields. The first version of titleFrom cut
// it off the title tag only, and og:title is the field actually used -- so
// "Astral Traveling #40, w/ Maxime L. - Cashmere Radio" went into the track
// name, which is what one reads in Roon.
test("the station name is cut off og:title, off the title tag, and the slug is last", () => {
  const og =
    '<meta property="og:title" content="Astral Traveling #40, w/ Maxime L. ' +
    "\u2013 Cashmere Radio\"/>";
  assert.equal(titleFrom("<html>" + og + "</html>", URL), "Astral Traveling #40, w/ Maxime L.");

  const tag = "<title>Astral Traveling #40 w/ Maxime L | Cashmere Radio</title>";
  assert.equal(titleFrom("<html>" + tag + "</html>", URL), "Astral Traveling #40 w/ Maxime L");

  assert.equal(
    titleFrom("<html><body>no metadata at all</body></html>", URL),
    "astral traveling 40 w maxime l"
  );
});

// A title that carries no station name must come through untouched -- the
// rule is anchored at the end and on the name, not on any dash.
test("a title without the station name is left alone", () => {
  const og = '<meta property="og:title" content="Past Forward #117 with Louis Largo"/>';
  assert.equal(titleFrom("<html>" + og + "</html>", URL), "Past Forward #117 with Louis Largo");
});

test("the playlist splits on the first dash and carries no timestamps", () => {
  const rows = tracklistFrom("<html>" + PLAYLIST + "</html>");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { artist: "Fatima Miranda", title: "Canto Largo", seconds: null });
  assert.deepEqual(rows[1], {
    artist: "Le Mystere Des Voix Bulgares",
    title: "Kalimankou Denkou",
    seconds: null,
  });
  assert.equal(rows[2].artist, "Alice Coltrane");
});

test("a line without a dash stays whole, in title", () => {
  const rows = tracklistFrom(
    '<h2>Playlist</h2><div>* unreleased dubplate<br></div></article>'
  );
  assert.deepEqual(rows, [{ artist: "", title: "unreleased dubplate", seconds: null }]);
});

test("no Playlist heading means no tracklist, not an exception", () => {
  assert.deepEqual(tracklistFrom("<html><body>just a description</body></html>"), []);
});
