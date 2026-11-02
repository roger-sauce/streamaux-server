/* Autoplay (Pi) -- the multi-source engine.
 * Takes an episode URL, finds the fitting adapter through dispatch.js (only
 * NTS at the time of writing), extracts the real stream URL and plays it
 * straight on the Pi with ffmpeg into an ALSA loopback device that the Roon
 * Audio Entrypoint extension picks up (the same pattern as mk-autoplay-pi,
 * see its server.js).
 *
 * /api/extract hands the extracted stream URL to a client that plays it
 * itself -- formerly the web UI shipped alongside, in Safari, and since
 * 2026-08-09 the native iOS app StreamAux (ios/StreamAux). That is the
 * confirmation that the extracted URL really carries sound, and it runs
 * independently of, and alongside, the Roon playback.
 *
 * Everything under /api has since required a bearer key (AUTOPLAY_KEY, see
 * below) -- the same pattern as CRATE_KEY in discogs-roon. The web UI in
 * public/ is therefore no longer served: a browser cannot send a header
 * while loading the page, and a second way in would be a second way to get
 * it wrong. The files stay where they are.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { detectAdapter } = require("./dispatch");
const { isUnsupported } = require("../adapters/_shared");
const brKlassik = require("../adapters/radiostations/br-klassik");
const wdr3 = require("../adapters/radiostations/wdr3");
const swrKultur = require("../adapters/radiostations/swr-kultur");
const hr2 = require("../adapters/radiostations/hr2");
const srf2 = require("../adapters/radiostations/srf2");
const nrkP2 = require("../adapters/radiostations/nrk-p2");
const rneRadio3 = require("../adapters/radiostations/rne-radio-3");
const rneRadioClasica = require("../adapters/radiostations/rne-radio-clasica");
const raiRadio3Classica = require("../adapters/radiostations/rai-radio3-classica");

// Adapters that offer a live playlist of their own, built on demand under
// /live/<slug>.m3u8 (see fetchLiveManifest in _ard-hls-station.js and
// _generic-hls-live-station.js -- the reason being that some CDNs do not
// serve a small sliding window playlist, see the comment there). radio3
// (rbb), France Musique and Inter, BBC Radio 3 and oe1 do NOT need it: they
// serve either a small playlist directly or a plain MP3 stream.
const LIVE_MANIFEST_SOURCES = {
  "br-klassik": brKlassik,
  wdr3: wdr3,
  "swr-kultur": swrKultur,
  hr2: hr2,
  srf2: srf2,
  "nrk-p2": nrkP2,
  "rne-radio-3": rneRadio3,
  "rne-radio-clasica": rneRadioClasica,
  "rai-radio3-classica": raiRadio3Classica,
};

const PORT = process.env.PORT || 3001;

// The shared secret between the server and the StreamAux app. The server
// deliberately does NOT start without it -- if it refuses to come back up
// after a rebuild, that is the first suspicion (docker compose logs
// autoplay-pi). The lower bound of 20 characters keeps an accidental "test"
// from passing for protection. To make a new one: openssl rand -base64 32
const API_KEY = process.env.AUTOPLAY_KEY || "";
if (API_KEY.length < 20) {
  console.error(
    "[autoplay-pi] AUTOPLAY_KEY missing or shorter than 20 characters -- start aborted. " +
      "See .env.example."
  );
  process.exit(1);
}
const API_KEY_BUFFER = Buffer.from(API_KEY, "utf8");

// The ALSA loopback device for the Roon Audio Entrypoint extension -- the
// same pattern as mk-autoplay-pi, overridable through the environment.
const ALSA_DEVICE = process.env.ALSA_DEVICE || "hw:3,1";

/* What the ALSA loopback accepts -- asked of the device, not configured.
 *
 * Until 05.09.2026 this was 44100, hard-coded and undocumented, so EVERY
 * stream that did not already run at 44.1 kHz was resampled on the way to
 * Roon, and AAC and HLS mostly do not. Nobody decided that; it was written
 * once and never questioned.
 *
 * What replaced it first -- a rate switch in the app with a "source" option,
 * meant to leave the conversion to Roon -- rested on a wrong picture of the
 * chain, and the same day measured it away. Roon never sees the station's
 * rate. The Audio Entrypoint extension holds the CAPTURE side of the loopback
 * open in one fixed format (its Format dropdown offers 44.1 / 48 / 88.2 / 96 /
 * 176.4 / 192 kHz at 16 or 24 bit, and no "follow input"), and snd-aloop binds
 * the playback side to whatever the capture side chose. So everything between
 * the station and the loopback falls to ffmpeg: ALSA_DEVICE is a raw hw:
 * device without the plug layer, and there is nothing else in the path.
 *
 * Asking for anything else does not resample, it fails before the first
 * sample:
 *
 *   Could not write header for output file #0 (incorrect codec parameters ?):
 *   Input/output error
 *
 * There is therefore nothing here to choose. There is one truth about the
 * format, it lives in that dropdown, and this reads it back:
 *
 *   RATE: 44100          a single value -- the pair is pinned
 *   FORMAT: S16_LE
 *   CHANNELS: 2
 *
 * A RANGE instead of a single value means the capture side is closed and the
 * card would take many things. That is not an answer, so it counts as none.
 *
 * Why aplay and not /proc/asound: the container has its own /proc and only
 * /dev/snd is mapped, so /proc/asound/Loopback is not there. aplay goes
 * through /dev/snd, needs no mount and no privilege, and alsa-utils is in the
 * image already (see Dockerfile).
 */
var loopback = null;

/* ffmpeg has no 24-bit sample format of its own, so an extension set to
 * 24 bit shows up here as S32_LE (or S24_3LE, which has no answer below).
 * Anything unmapped means ffmpeg picks for itself, which is what it did
 * before this function existed -- s16, and right for the 16-bit case.
 */
const ALSA_TO_FFMPEG_FMT = { S16_LE: "s16", S32_LE: "s32" };

function parseHwParams(text) {
  // Single values only. "RATE: [8000 192000]" and "FORMAT: S16_LE S32_LE"
  // deliberately fail to match: a card that would take many things tells us
  // nothing about what the extension picked.
  var rate = /^RATE:\s*(\d+)\s*$/m.exec(text);
  var format = /^FORMAT:\s*(\S+)\s*$/m.exec(text);
  if (!rate || !format) return null;
  var channels = /^CHANNELS:\s*(\d+)\s*$/m.exec(text);
  var bits = /^SAMPLE_BITS:\s*(\d+)\s*$/m.exec(text);
  return {
    rate: Number(rate[1]),
    format: format[1],
    channels: channels ? Number(channels[1]) : 2,
    bits: bits ? Number(bits[1]) : null,
  };
}

/* Reads the device and keeps the last answer.
 *
 * The probe opens the loopback for a moment. While ffmpeg holds it the open
 * fails with EBUSY -- which costs nothing and disturbs nothing, but it does
 * mean a reading is not always available. The previous one then stands: a
 * stale number is a smaller problem than no number, because no number means
 * falling back to 44100 and possibly to silence.
 */
function readLoopback() {
  var run = spawnSync("aplay", ["-D", ALSA_DEVICE, "--dump-hw-params", "/dev/zero"], {
    encoding: "utf8",
    timeout: 3000,
  });
  // aplay dumps to stderr and then exits non-zero ("Sample format non
  // available"), which is the normal course here and not a failure.
  var fresh = parseHwParams(String((run && run.stderr) || "") + String((run && run.stdout) || ""));
  if (fresh) loopback = fresh;
  return loopback;
}

function describeLoopback(lb) {
  if (!lb) return "unknown";
  return lb.rate + " Hz " + lb.format + " " + lb.channels + "ch";
}

/* What the station is actually sending, read out of ffmpeg's own report.
 *
 * No probe, no second request, no extra second before the music starts: this
 * line is already in the stderr we read for error messages, and we were
 * throwing it away.
 *
 *   Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s
 *   Stream #0:0: Audio: aac (LC), 48000 Hz, stereo, fltp, 96 kb/s
 *
 * Codec, rate and bitrate. NOT bit depth, and that is a refusal rather than
 * an omission: `fltp` there is ffmpeg's decoding format, not the station's.
 * A 128 kbit MP3 has no bit depth to report, and printing "16 bit" beside it
 * would describe our pipeline while looking like a claim about the source.
 * Where a station ever sends something lossless, the codec name says so and
 * that is the honest signal.
 */
function readSourceFormat(text) {
  var line = /Stream #\d+:\d+[^\n]*: Audio: ([^\n]+)/.exec(String(text || ""));
  if (!line) return null;
  var parts = line[1].split(",").map(function (p) { return p.trim(); });
  var codec = (parts[0] || "").split(" ")[0];
  var rate = null;
  var bitrate = null;
  for (var i = 1; i < parts.length; i++) {
    var hz = /^(\d+) Hz$/.exec(parts[i]);
    if (hz) { rate = Number(hz[1]); continue; }
    var kb = /^(\d+) kb\/s$/.exec(parts[i]);
    if (kb) bitrate = Number(kb[1]);
  }
  if (!codec) return null;
  return { codec: codec, sampleRate: rate, bitrateKbps: bitrate };
}
// roon-trigger runs in the host network of the same machine.
// "host.docker.internal" points from inside the container at the host --
// under Linux only if docker-compose.yml maps that alias to host-gateway
// through extra_hosts (see there). Deliberately no fixed IP any more: that
// does not belong in a repository which might one day be public, and an
// address change on the home network would otherwise have broken the code.
const ROON_TRIGGER_URL = process.env.ROON_TRIGGER_URL || "http://host.docker.internal:4000";
const ROON_TRIGGER_DELAY_MS = Number(process.env.ROON_TRIGGER_DELAY_MS) || 3000;

// The very long Content-Security-Policy that used to stand here went with
// the web UI: a CSP takes effect in a browser document, and this server no
// longer serves one. What remains still applies to JSON and manifest
// responses.
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function withSecurityHeaders(headers) {
  return Object.assign({}, SECURITY_HEADERS, headers);
}

// Comparison in constant time. An ordinary === stops at the first differing
// character and so betrays, through the response time, how far a guess got.
// The length comparison up front is needed because timingSafeEqual throws on
// buffers of unequal length -- which gives the length away, and that does
// not matter.
function keyMatches(candidate) {
  var given = Buffer.from(candidate, "utf8");
  if (given.length !== API_KEY_BUFFER.length) return false;
  return crypto.timingSafeEqual(given, API_KEY_BUFFER);
}

function isAuthorized(req) {
  var header = req.headers.authorization || "";
  if (header.slice(0, 7).toLowerCase() !== "bearer ") return false;
  return keyMatches(header.slice(7).trim());
}

// "no-store" here is not caution but necessity: /api/roon-status is polled
// every second, and without a statement about freshness URLSession on iOS
// applies a heuristic of its own and serves the same answer again. The
// playback position stopped moving because of it although the app polled
// correctly (2026-08-09). curl never notices -- it stores nothing.
function sendJson(res, status, obj) {
  res.writeHead(status, withSecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }));
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1e5) req.destroy();
    });
    req.on("end", function () {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON in the request body: " + e.message));
      }
    });
  });
}

function handleLiveManifest(req, res, slug) {
  var source = LIVE_MANIFEST_SOURCES[slug];
  if (!source || typeof source.fetchLiveManifest !== "function") {
    res.writeHead(404, withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("Unknown live stream: " + slug);
    return;
  }
  source
    .fetchLiveManifest()
    .then(function (manifestText) {
      res.writeHead(200, withSecurityHeaders({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      }));
      res.end(manifestText);
    })
    .catch(function (e) {
      res.writeHead(502, withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
      res.end("Live manifest error: " + e.message);
    });
}

/* An adapter's refusal, over HTTP.
 *
 * KONTEXT-RADIO-ADAPTER 5.6. Three things used to arrive as the same 502 with
 * the same red error in the app: a genuine fault, a live page that has no
 * archive, and a concert that lives on YouTube. Only the first is a defect.
 *
 * 422 and not 200, and that is the whole trick of doing this without changing
 * the app on the same day. An app that knows nothing of `unsupported` sees a
 * non-200, decodes { error } and shows the reason -- exactly what it does
 * today. An app that does know can read `unsupported`, keep the red away and
 * offer `sourceUrl` as a button. Had this answered 200, the older app would
 * have taken a body without tracks for a success and shown nothing at all.
 */
function sendAdapterFailure(res, e) {
  if (isUnsupported(e)) {
    return sendJson(res, 422, {
      error: e.message,
      unsupported: true,
      reason: e.reason || e.message,
      sourceUrl: e.sourceUrl || "",
    });
  }
  return sendJson(res, 502, { error: e.message });
}

function handleExtract(req, res) {
  readJsonBody(req)
    .then(function (payload) {
      var url = payload && payload.url;
      var adapter = url && detectAdapter(url);
      if (!adapter) {
        sendJson(res, 400, { error: "No matching source found for this URL" });
        return;
      }
      return adapter.extract(url).then(function (result) {
        sendJson(res, 200, result);
      });
    })
    .catch(function (e) {
      sendAdapterFailure(res, e);
    });
}

// ---------- Roon playback (one session at a time) ----------
// "programme" is the adapter's whole answer, kept as it came. Until
// 2026-08-15 only "tracks" survived here, and the running order -- artist,
// timestamps, lengths, cover -- existed nowhere but in the app's memory. Close
// the app, rebuild it from Xcode, and the Pi went on playing while the screen
// had nothing left to say about what that was. It is served again by
// /api/roon-programme; see there.
var roonState = { playing: false, title: "", sourceType: "", format: null, tracks: [], programme: null, index: -1, error: "", proc: null, stopRequested: false, sourceUrl: "", zone: "", live: false, trackStartedAt: 0, seekOffset: 0, duration: 0 };

// ---------- Resume state (survives closing the browser AND a container restart) ----------
// On stopping, the state (URL, zone, track, position) is written as JSON;
// /api/resume-roon extracts the URL afresh (signed stream URLs expire) and
// re-enters with ffmpeg -ss. Livestreams: re-entry without a seek.
const RESUME_FILE = process.env.RESUME_FILE || path.join(__dirname, "..", "data", "resume.json");
var resumeState = null;
try { resumeState = JSON.parse(fs.readFileSync(RESUME_FILE, "utf8")); } catch (e) {}

function saveResumeState(state) {
  resumeState = state;
  try {
    fs.mkdirSync(path.dirname(RESUME_FILE), { recursive: true });
    fs.writeFileSync(RESUME_FILE, JSON.stringify(state));
  } catch (e) {
    console.error("[autoplay-pi] resume state could not be saved: " + e.message);
  }
}

// ---------- History (the last few things Roon played) ----------
// Beside resume.json rather than inside it, and deliberately so: resume holds
// ONE programme with a position in it, this holds several without one. Sharing
// a file would blur what each is for.
//
// Only what Roon played goes in here. Playing on the phone itself does not --
// decided on 15.08.2026, so the list answers "what was on in the house" and
// not "what did I glance at".
const HISTORY_FILE = process.env.HISTORY_FILE || path.join(__dirname, "..", "data", "history.json");
// Fifteen since 18.08.2026, five before that. The app still shows five and
// unfolds the rest on request, so the number here is how far back the list
// reaches and not how tall it is on screen. Repeats cost no slot -- the same
// address moves up instead of taking a second one -- so fifteen is roughly a
// week of listening rather than fifteen evenings.
const HISTORY_LIMIT = 15;
var historyState = [];
try {
  var loadedHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  if (Array.isArray(loadedHistory)) historyState = loadedHistory.slice(0, HISTORY_LIMIT);
} catch (e) {}

// The same address twice is one entry that moved up, not two entries. Without
// this the list would fill with a single station listened to on five evenings
// and say nothing about anything else.
function rememberInHistory(result, sourceUrl) {
  if (!sourceUrl) return;
  var cover = result.cover || (result.tracks && result.tracks[0] && result.tracks[0].cover) || "";
  var entry = {
    url: sourceUrl,
    title: result.title || sourceUrl,
    sourceType: result.sourceType || "",
    cover: cover,
    // When the recording was published at its source, where the adapter knows
    // -- see toIsoDate in adapters/_shared.js. Empty from most of them, and
    // that is the normal case rather than a fault: a livestream has no such
    // date at all, and an adapter only learns one where its source hands it
    // over without a request of its own.
    publishedAt: result.publishedAt || "",
    playedAt: new Date().toISOString(),
  };
  historyState = [entry].concat(
    historyState.filter(function (old) { return old && old.url !== sourceUrl; })
  ).slice(0, HISTORY_LIMIT);
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyState, null, 2));
  } catch (e) {
    console.error("[autoplay-pi] history could not be saved: " + e.message);
  }
}

// The estimated playback position in the current track (seconds) --
// measured from the ffmpeg process start, plus any seek offset on resuming.
function roonElapsedSeconds() {
  if (!roonState.playing || roonState.index < 0 || !roonState.trackStartedAt) return null;
  return roonState.seekOffset + (Date.now() - roonState.trackStartedAt) / 1000;
}

function stopRoonPlayback() {
  if (roonState.playing && roonState.sourceUrl) {
    saveResumeState({
      url: roonState.sourceUrl,
      zone: roonState.zone || "",
      title: roonState.title,
      index: roonState.index >= 0 ? roonState.index : 0,
      seconds: roonState.live ? 0 : Math.max(0, Math.floor(roonElapsedSeconds() || 0)),
      live: roonState.live,
      savedAt: new Date().toISOString(),
    });
  }
  roonState.stopRequested = true;
  roonState.playing = false;
  var proc = roonState.proc;
  if (proc) {
    proc.kill("SIGTERM");
    // Hanging network reads sometimes survive SIGTERM -- follow up hard
    // after 5s. The timer is cleared again on a normal exit.
    var killTimer = setTimeout(function () {
      try { proc.kill("SIGKILL"); } catch (e) {}
    }, 5000);
    proc.once("close", function () { clearTimeout(killTimer); });
  }
}

function triggerRoonZone(session, zone) {
  fetch(ROON_TRIGGER_URL + "/api/play-station", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zone: zone }),
  })
    .then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
      });
    })
    .catch(function (e) {
      session.error = "Starting the Roon zone failed: " + e.message;
      console.error("[autoplay-pi] " + session.error);
    });
}

function playRoonTrackAt(session, i, seekSeconds) {
  // session is passed in explicitly rather than read from the global:
  // otherwise the close handler of an OLD ffmpeg instance (which dies with a
  // delay after stopRoonPlayback) can start the next track of the NEW
  // session and so produce a second ffmpeg running alongside (happened live
  // on 2026-07-25).
  if (session !== roonState || session.stopRequested || i >= session.tracks.length) {
    if (session === roonState) {
      session.playing = false;
      session.index = -1;
      session.proc = null;
    }
    return;
  }
  session.index = i;
  session.seekOffset = seekSeconds > 0 ? seekSeconds : 0;
  session.trackStartedAt = Date.now();
  var track = session.tracks[i];
  // Adapters may return a relative path ("/live/br-klassik.m3u8", say) that
  // this very server answers -- ffmpeg needs a full URL for that.
  var streamUrl = track.streamUrl.charAt(0) === "/" ? "http://localhost:" + PORT + track.streamUrl : track.streamUrl;
  var args = ["-nostdin", "-re"];
  if (seekSeconds > 0) args.push("-ss", String(seekSeconds));
  args.push("-i", streamUrl, "-f", "alsa");
  // Read afresh rather than trusted from startup: the format is changed in
  // Roon, in another program, and nothing tells us when.
  var lb = readLoopback();
  args.push("-ar", String(lb ? lb.rate : 44100));
  var sampleFmt = lb ? ALSA_TO_FFMPEG_FMT[lb.format] : null;
  if (sampleFmt) args.push("-sample_fmt", sampleFmt);
  args.push("-ac", String(lb ? lb.channels : 2), ALSA_DEVICE);
  var proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  session.proc = proc;
  var stderrTail = "";
  session.format = null;
  proc.stderr.on("data", function (chunk) {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    // The stream line arrives once, in the first seconds. Read until it is
    // found and then stop looking: the tail is trimmed to 2000 characters, so
    // a long-running stream would eventually push it out and null the field
    // for something that is still playing perfectly well.
    if (!session.format) session.format = readSourceFormat(stderrTail);
    console.error("[ffmpeg " + track.title + "] " + chunk.toString().trim());
  });
  proc.on("close", function (code) {
    if (code !== 0 && !session.stopRequested) {
      session.error =
        "ffmpeg stopped at \"" + (track.title || i + 1) + "\" (code " + code + "): " +
        stderrTail.trim().split("\n").slice(-3).join(" / ");
      console.error("[autoplay-pi] " + session.error);
    }
    playRoonTrackAt(session, i + 1, 0);
  });
  proc.on("error", function (e) {
    session.error = "ffmpeg error: " + e.message;
    session.playing = false;
    session.proc = null;
  });
}

// Seeking here means restarting the same ffmpeg at a different place. Roon
// notices nothing: the same "station" plays on there, and the change is the
// same operation that happens at every transition between two tracks of a
// queue anyway.
//
// Deliberately WITHOUT a fresh extraction: that would cost thirty seconds
// per jump. The price is that a signed stream URL may have expired
// (Mixcloud and SoundCloud after an hour, say) -- ffmpeg then aborts, the
// error stands in the status, and a new /api/play-roon fetches a fresh
// URL.
function seekRoonPlayback(index, seconds) {
  var session = roonState;
  var proc = session.proc;
  if (!proc) {
    playRoonTrackAt(session, index, seconds);
    return;
  }
  // The close handler of the running instance would otherwise start the
  // NEXT TRACK -- the same trap as on 2026-07-25, only the other way round.
  // Unhook it first, then decide on the successor ourselves.
  proc.removeAllListeners("close");
  var killTimer = setTimeout(function () {
    try { proc.kill("SIGKILL"); } catch (e) {}
  }, 3000);
  proc.once("close", function () {
    clearTimeout(killTimer);
    // Only start once the old process is really gone: two ffmpeg on the
    // same ALSA device do not get along.
    if (session === roonState && !session.stopRequested) {
      playRoonTrackAt(session, index, seconds);
    }
  });
  proc.kill("SIGTERM");
}

function startRoonPlayback(result, zone, sourceUrl, startIndex, startSeconds) {
  stopRoonPlayback();
  // Livestream detection: every radio factory sets exactly this placeholder
  // tracklist entry (see _direct-stream-station.js and the others).
  var live = !!(result.tracklist && result.tracklist[0] && /^Livestream/.test(result.tracklist[0].title));
  roonState = {
    playing: true,
    title: result.title,
    sourceType: result.sourceType,
    tracks: result.tracks,
    programme: result,
    index: -1,
    error: "",
    proc: null,
    stopRequested: false,
    // The adapter may know better where what is playing really lives. A
    // resolver is handed an ANNOUNCEMENT -- a station's programme page, a
    // series page -- and answers with a recording that sits somewhere else
    // entirely; saying so is the only way the app can link to the thing it is
    // actually playing rather than back to the page it was asked from.
    //
    // Three things follow this field and all three are better for it: the page
    // link in /api/roon-status, the history entry, and the resume state --
    // which then points at a recording that plays directly, with no resolving
    // and no fragment, long after the guide's week has rolled over.
    //
    // Falls back to what was posted, so every adapter that says nothing
    // behaves exactly as before.
    sourceUrl: (result && result.sourceUrl) || sourceUrl || "",
    zone: zone || "",
    live: live,
    trackStartedAt: 0,
    seekOffset: 0,
    // Where the adapter knows the total length it passes it along -- so far
    // only ard-audiothek does, where the broadcast is a finished file. For a
    // stream it stays 0, and the app then draws no bar.
    duration: typeof result.duration === "number" ? result.duration : 0,
  };
  // Here and not in the route: this is the one place both /api/play-roon and
  // /api/resume-roon come through, and it is the moment something really
  // starts rather than merely having been asked for.
  rememberInHistory(result, roonState.sourceUrl);
  var session = roonState;
  playRoonTrackAt(session, startIndex || 0, live ? 0 : (startSeconds || 0));
  if (zone) {
    setTimeout(function () {
      if (!session.stopRequested) triggerRoonZone(session, zone);
    }, ROON_TRIGGER_DELAY_MS);
  }
}

function handlePlayRoon(req, res) {
  readJsonBody(req)
    .then(function (payload) {
      var url = payload && payload.url;
      var adapter = url && detectAdapter(url);
      if (!adapter) {
        sendJson(res, 400, { error: "No matching source found for this URL" });
        return;
      }
      return adapter.extract(url).then(function (result) {
        startRoonPlayback(result, payload.zone, url);
        // The same shape as /api/extract, only with started in front. The
        // reason: whoever starts straight in Roon, without playing locally
        // first, would otherwise have no tracklist to look at -- and a
        // second extraction for the display alone would be twenty to thirty
        // seconds for something already at hand here.
        sendJson(res, 200, Object.assign({ started: true }, result));
      });
    })
    .catch(function (e) {
      // Nothing was started -- startRoonPlayback is only reached after a
      // successful extract, so a refusal here leaves whatever is playing
      // exactly where it was.
      sendAdapterFailure(res, e);
    });
}

var server = http.createServer(function (req, res) {
  // Deliberately without a key: the reachability probe has to be answerable
  // without having the key to hand -- otherwise "server dead" cannot be told
  // apart from "wrong key". It gives away nothing but the fact that
  // something is running here.
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  // Without a key as well, and that is a decision, not a gap:
  // /live/<slug>.m3u8 is fetched by ffmpeg over localhost (see
  // playRoonTrackAt) and by AVPlayer in the app, which sends no headers of
  // its own with the HLS segment requests. In substance these are rewritten,
  // publicly retrievable radio manifests -- there is nothing behind them the
  // key would have to protect.
  var liveMatch = req.method === "GET" && req.url.match(/^\/live\/([\w-]+)\.m3u8$/);
  if (liveMatch) {
    return handleLiveManifest(req, res, liveMatch[1]);
  }

  // From here on everything demands the key. Check what is being asked for
  // first and the key second: otherwise a wrong path with a valid key
  // answers 404 and a wrong path without a key 401, which is confusing to
  // search through.
  if (req.url.split("?")[0].indexOf("/api/") !== 0) {
    return sendJson(res, 404, {
      error: "Unknown path. The web UI is no longer served since the move to StreamAux.",
    });
  }
  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      error: "Missing or wrong key (Authorization: Bearer <AUTOPLAY_KEY>).",
    });
  }

  if (req.method === "POST" && req.url === "/api/extract") {
    return handleExtract(req, res);
  }
  if (req.method === "POST" && req.url === "/api/play-roon") {
    return handlePlayRoon(req, res);
  }
  // { index?, seconds } -- without index the running track stays. With one
  // continuous stream (NTS) there is only the one, and "seconds" is the
  // absolute position inside it; with several files index is the track and
  // seconds usually 0.
  if (req.method === "POST" && req.url === "/api/seek-roon") {
    return readJsonBody(req)
      .then(function (payload) {
        if (!roonState.playing || !roonState.tracks.length) {
          return sendJson(res, 409, { error: "Nothing is playing in Roon right now" });
        }
        if (roonState.live) {
          return sendJson(res, 400, { error: "A livestream cannot be seeked" });
        }
        var current = roonState.index >= 0 ? roonState.index : 0;
        var index = Number.isInteger(payload && payload.index) ? payload.index : current;
        var seconds = Math.max(0, Number(payload && payload.seconds) || 0);
        if (index < 0 || index >= roonState.tracks.length) {
          return sendJson(res, 400, { error: "Track " + index + " does not exist" });
        }
        seekRoonPlayback(index, seconds);
        return sendJson(res, 200, { seeking: true, index: index, seconds: seconds });
      })
      .catch(function (e) { sendJson(res, 502, { error: e.message }); });
  }
  if (req.method === "POST" && req.url === "/api/stop-roon") {
    stopRoonPlayback();
    return sendJson(res, 200, { stopped: true });
  }
  if (req.method === "POST" && req.url === "/api/resume-roon") {
    return readJsonBody(req)
      .then(function (payload) {
        var saved = resumeState;
        if (!saved || !saved.url) {
          sendJson(res, 404, { error: "No saved playback position" });
          return;
        }
        var adapter = detectAdapter(saved.url);
        if (!adapter) {
          sendJson(res, 400, { error: "No matching source for the saved URL" });
          return;
        }
        var zone = (payload && payload.zone) || saved.zone;
        return adapter.extract(saved.url).then(function (result) {
          var index = Math.min(saved.index || 0, result.tracks.length - 1);
          startRoonPlayback(result, zone, saved.url, index, saved.seconds || 0);
          sendJson(res, 200, Object.assign({ started: true, resumedAt: saved.seconds || 0 }, result));
        });
      })
      .catch(function (e) { sendJson(res, 502, { error: e.message }); });
  }
  // Passed on to roon-trigger, the only part that talks to the core.
  // Deliberately without logic of its own: what counts as a valid volume the
  // device knows, and repeating that check here would mean keeping it right
  // in two places.
  if (req.method === "POST" && req.url === "/api/volume") {
    return readJsonBody(req)
      .then(function (payload) {
        return fetch(ROON_TRIGGER_URL + "/api/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(function (resp) {
          return resp.json().then(function (data) {
            if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
            sendJson(res, 200, data);
          });
        });
      })
      .catch(function (e) {
        sendJson(res, 502, { error: "Lautstaerke: " + e.message });
      });
  }
  // Passed on to roon-trigger. With one exception: if the zone being
  // stopped is the very one our station plays in, ffmpeg has to stop too --
  // otherwise it would keep pushing into a loopback nobody picks up any
  // more, and the playback position would never be saved.
  if (req.method === "POST" && req.url === "/api/zone-control") {
    return readJsonBody(req)
      .then(function (payload) {
        var zone = payload && payload.zone;
        var action = payload && payload.action;
        return fetch(ROON_TRIGGER_URL + "/api/zone-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone: zone, action: action }),
        }).then(function (resp) {
          return resp.json().then(function (data) {
            if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
            if (action === "stop" && roonState.playing && zone === roonState.zone) {
              stopRoonPlayback();
            }
            sendJson(res, 200, data);
          });
        });
      })
      .catch(function (e) {
        sendJson(res, 502, { error: "Zonensteuerung: " + e.message });
      });
  }
  // The server knows itself where the station was started, so the source
  // zone comes from here and not from the app. After the transfer
  // roonState.zone is brought along, otherwise a later stop or resume would
  // point at the old room again.
  if (req.method === "POST" && req.url === "/api/transfer-zone") {
    return readJsonBody(req)
      .then(function (payload) {
        var from = roonState.zone || (payload && payload.from);
        var to = payload && payload.to;
        if (!roonState.playing) {
          return sendJson(res, 409, { error: "Nothing is playing in Roon right now" });
        }
        if (!from || !to) {
          return sendJson(res, 400, { error: "Source or target zone missing" });
        }
        return fetch(ROON_TRIGGER_URL + "/api/transfer-zone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: from, to: to }),
        }).then(function (resp) {
          return resp.json().then(function (data) {
            if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
            roonState.zone = to;
            sendJson(res, 200, data);
          });
        });
      })
      .catch(function (e) {
        sendJson(res, 502, { error: "Zonenwechsel: " + e.message });
      });
  }
  if (req.method === "GET" && req.url === "/api/roon-zones") {
    return fetch(ROON_TRIGGER_URL + "/api/zones")
      .then(function (r) { return r.json(); })
      .then(function (zones) { sendJson(res, 200, zones); })
      .catch(function (e) { sendJson(res, 502, { error: "roon-trigger not reachable: " + e.message }); });
  }
  // The running order of what Roon has, in the same shape as /api/extract --
  // so the app decodes it into the very type it already uses and needs no
  // second extraction (which would cost thirty seconds and hand back different
  // signed URLs than the ones ffmpeg is currently reading).
  //
  // Answered even while nothing plays, as long as there is something to
  // answer with: after a stop the resume offer refers to exactly this
  // programme, and the app keeps showing it for the same reason.
  //
  // Gone after a container restart, and that is not worth mending: the
  // restart takes ffmpeg with it, so Roon has nothing left to describe.
  if (req.method === "GET" && req.url === "/api/history") {
    return sendJson(res, 200, historyState);
  }
  if (req.method === "GET" && req.url === "/api/roon-programme") {
    if (!roonState.programme) {
      return sendJson(res, 409, { error: "The server is not holding a programme right now" });
    }
    return sendJson(res, 200, roonState.programme);
  }
  if (req.method === "GET" && req.url === "/api/roon-status") {
    return sendJson(res, 200, {
      playing: roonState.playing,
      title: roonState.title,
      sourceType: roonState.sourceType,
      // What the station sends, and what we do to it on the way in. The
      // second is worth saying only when it differs from the first.
      format: roonState.format,
      // The cached reading, not a fresh probe: the app polls this every
      // couple of seconds, and spawning aplay that often to open a device
      // ffmpeg is using would be noise for no gain. Refreshed at startup,
      // before every ffmpeg start, and while nothing plays (see below).
      loopback: loopback,
      // The page it came from. The app names the source from it, and it is
      // the one copy of that address that survives the app being closed.
      sourceUrl: roonState.sourceUrl,
      index: roonState.index,
      trackCount: roonState.tracks.length,
      currentTitle: roonState.index >= 0 ? (roonState.tracks[roonState.index] || {}).title : "",
      seconds: roonElapsedSeconds(),
      duration: roonState.duration > 0 ? roonState.duration : null,
      resume: !roonState.playing && resumeState && resumeState.url
        ? { title: resumeState.title, seconds: resumeState.seconds || 0, live: !!resumeState.live, zone: resumeState.zone || "" }
        : null,
      error: roonState.error,
    });
  }
  return sendJson(res, 404, { error: "Unknown API route: " + req.method + " " + req.url });
});

server.listen(PORT, function () {
  console.log(
    "autoplay-pi server listening on :" + PORT + " (ALSA device: " + ALSA_DEVICE +
      ", loopback: " + describeLoopback(readLoopback()) +
      ", API key set)"
  );
});

/* Only while nothing plays, and that is the whole point of the guard: during
 * playback ffmpeg holds the device and the probe would fail anyway. The case
 * this serves is the other one -- the format is changed in Roon while the
 * room is quiet, and the app should show the new one without being asked.
 */
setInterval(function () {
  if (!roonState.playing) readLoopback();
}, 30000).unref();
