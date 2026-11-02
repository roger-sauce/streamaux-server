/* roon-trigger: a small Roon extension that starts one fixed "My Live Radio"
 * station (by default "Audio Entrypoint (roon-bridge)") in a chosen zone on
 * an HTTP call. It replaces looking the station up and starting it by hand
 * in the Roon remote app, and mk-autoplay-pi calls it automatically shortly
 * after ffmpeg playback begins (see ROON_TRIGGER_URL and
 * ROON_TRIGGER_DELAY_MS there).
 *
 * How: through the official node-roon-api (browse service). The trick to
 * starting a live radio station programmatically is to browse and load the
 * "internet_radio" hierarchy, find the entry by title, and then call
 * browse() again with item_key and zone_or_output_id. Modelled on
 * https://github.com/imgrant/roon-extension-radio-presets-api
 *
 * IMPORTANT: this has to be enabled once in Roon under Settings ->
 * Extensions (like Entrypoint Gateway / Audio Entrypoint). According to the
 * node-roon-api documentation the pairing token survives restarts by
 * itself; in this Docker setup it is NOT mounted as a volume, so whether a
 * container rebuild resets the approval is still untested (it would then
 * need one more click on "Enable" in Roon -- inelegant, but harmless for
 * home use).
 */
"use strict";

const http = require("http");
const RoonApi = require("node-roon-api");
const RoonApiBrowse = require("node-roon-api-browse");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiStatus = require("node-roon-api-status");

const PORT = process.env.PORT || 4000;
const STATION_NAME = process.env.ROON_STATION_NAME || "Audio Entrypoint (roon-bridge)";

// What /api/zone-control accepts. A whitelist rather than passing things
// through: transport.control() does not throw on something unknown, nothing
// simply happens.
const ALLOWED_CONTROLS = ["play", "pause", "playpause", "stop", "previous", "next"];

var transport = null;
var browser = null;
var zones = [];

function findZone(idOrName) {
  return (
    zones.find(function (z) {
      return z.zone_id === idOrName || z.display_name === idOrName;
    }) || null
  );
}

// One output across all zones. Volume hangs on the output, not on the zone
// -- a grouped zone has several, and change_volume wants exactly one of
// them.
function findOutput(outputId) {
  for (var i = 0; i < zones.length; i++) {
    var outs = zones[i].outputs || [];
    for (var j = 0; j < outs.length; j++) {
      if (outs[j].output_id === outputId) return outs[j];
    }
  }
  return null;
}

// The range comes from the device, not from here: a DAC reports -80 to 0 in
// decibel, a streamer 0 to 100. None of it is a percentage, so the bounds
// travel along instead of being normalised. Where "volume" is missing
// entirely the output has no control of its own -- a fixed line out into an
// amplifier with its own knob. Then null, and the app shows no slider
// rather than offering one that does nothing.
function describeVolume(zone) {
  var out = (zone.outputs || [])[0];
  if (!out || !out.volume) return null;
  var v = out.volume;
  return {
    outputId: out.output_id,
    type: v.type,
    min: v.min,
    max: v.max,
    value: v.value,
    step: v.step || 1,
    isMuted: !!v.is_muted,
  };
}

// What is playing in the zone, in one line. Roon offers the same
// information in three cuts (one_line/two_line/three_line); two lines are
// right here, because a title without an artist often says nothing.
function describeNowPlaying(z) {
  var np = z.now_playing;
  if (!np) return null;
  var two = np.two_line || {};
  var one = np.one_line || {};
  var parts = [two.line1 || one.line1 || "", two.line2 || ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

// For a grouped zone the first output stands in for the rest -- the same
// simplification as in discogs-roon/Crate. Anyone wanting to control a group
// separately does that in Roon itself.
//
// The three can* flags come from Roon unchanged. They are the reason the app
// draws no pause button where none belongs: an internet radio station -- and
// from Roon's side that is all ours is -- can as a rule be stopped but not
// paused.
function describeZone(z) {
  return {
    id: z.zone_id,
    name: z.display_name,
    state: z.state || null,
    nowPlaying: describeNowPlaying(z),
    canPlay: !!z.is_play_allowed,
    canPause: !!z.is_pause_allowed,
    canStop: !!z.is_stop_allowed,
    volume: describeVolume(z),
  };
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (c) {
      body += c;
      if (body.length > 1e5) req.destroy();
    });
    req.on("end", function () {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

var roon = new RoonApi({
  extension_id: "com.rogzilla.roon-trigger",
  display_name: "Roon Trigger (mk-autoplay-pi)",
  display_version: "1.0.0",
  publisher: "Roger",
  email: "36forlive@gmail.com",
  website: "https://github.com/roger-sauce/streamaux-server",

  core_paired: function (core) {
    console.log("[roon-trigger] paired with core: " + core.display_name);
    transport = core.services.RoonApiTransport;
    browser = core.services.RoonApiBrowse;
    svc_status.set_status("Connected to " + core.display_name, false);
    transport.subscribe_zones(function (cmd, data) {
      if (cmd === "Subscribed") {
        zones = data.zones || [];
      } else if (cmd === "Changed") {
        // An upsert rather than a concat: Roon sends zones_added for zones
        // already in the list too (after a core restart or a network
        // interruption, say). A blind concat let the list grow with every
        // such event, and the zones then turned up several times over in
        // the UI.
        if (data.zones_added) {
          data.zones_added.forEach(function (added) {
            var i = zones.findIndex(function (z) {
              return z.zone_id === added.zone_id;
            });
            if (i >= 0) zones[i] = added;
            else zones.push(added);
          });
        }
        if (data.zones_removed) {
          data.zones_removed.forEach(function (id) {
            zones = zones.filter(function (z) {
              return z.zone_id !== id;
            });
          });
        }
        // An upsert as well: where the list did not know the changed zone,
        // it used to be dropped in silence instead of taken in.
        if (data.zones_changed) {
          data.zones_changed.forEach(function (changed) {
            var i = zones.findIndex(function (z) {
              return z.zone_id === changed.zone_id;
            });
            if (i >= 0) zones[i] = changed;
            else zones.push(changed);
          });
        }
      }
    });
  },

  core_unpaired: function (core) {
    console.log("[roon-trigger] lost core: " + core.display_name);
    transport = null;
    browser = null;
    zones = [];
    svc_status.set_status("No Roon core connected", true);
  },
});

var svc_status = new RoonApiStatus(roon);

roon.init_services({
  required_services: [RoonApiTransport, RoonApiBrowse],
  provided_services: [svc_status],
});

svc_status.set_status("Waiting for Roon core pairing (Settings -> Extensions) ...", false);
roon.start_discovery();

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

// Looks STATION_NAME up in "My Live Radio" (the "internet_radio" browse
// hierarchy) and starts it in the given zone.
function playStation(zone, cb) {
  if (!browser) return cb("Not connected to the Roon core");
  var opts = { hierarchy: "internet_radio", pop_all: true };
  browser.browse(opts, function (err) {
    if (err) return cb("Browse error: " + err);
    browser.load(opts, function (err, r) {
      if (err) return cb("Load error: " + err);
      var station = (r.items || []).find(function (item) {
        return (item.title || "").trim() === STATION_NAME.trim();
      });
      if (!station) {
        return cb('Station "' + STATION_NAME + '" not found in My Live Radio');
      }
      browser.browse({
        hierarchy: "internet_radio",
        pop_all: false,
        item_key: station.item_key,
        zone_or_output_id: zone.zone_id,
      });
      cb(null);
    });
  });
}

var server = http.createServer(function (req, res) {
  if (req.method === "GET" && req.url === "/api/zones") {
    return sendJson(res, 200, zones.map(describeZone));
  }

  // An absolute value, not a relative step up or down: the app knows the
  // device's range and sends the number that should stand there. With two
  // places to operate from -- the app and the Roon remote -- relative steps
  // would be the quicker way to get the arithmetic wrong.
  if (req.method === "POST" && req.url === "/api/volume") {
    readJsonBody(req)
      .then(function (payload) {
        if (!transport) return sendJson(res, 502, { error: "Not connected to the Roon core" });
        var output = findOutput(payload && payload.outputId);
        if (!output) {
          return sendJson(res, 404, { error: "Output not found: " + (payload && payload.outputId) });
        }
        var value = Number(payload.value);
        if (!isFinite(value)) return sendJson(res, 400, { error: "Not a valid volume value" });
        transport.change_volume(output, "absolute", value, function (err) {
          if (err) return sendJson(res, 502, { error: "Roon: " + err });
          sendJson(res, 200, { ok: true, outputId: output.output_id, value: value });
        });
      })
      .catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    return;
  }

  // Play, pause and stop for a zone -- the same buttons Roon's own remote
  // shows. What is allowed the zone says itself (see describeZone); this
  // only passes on what Roon accepts.
  if (req.method === "POST" && req.url === "/api/zone-control") {
    readJsonBody(req)
      .then(function (payload) {
        if (!transport) return sendJson(res, 502, { error: "Not connected to the Roon core" });
        var zone = findZone(payload && payload.zone);
        if (!zone) return sendJson(res, 404, { error: "Zone not found: " + (payload && payload.zone) });
        var action = payload && payload.action;
        if (ALLOWED_CONTROLS.indexOf(action) < 0) {
          return sendJson(res, 400, { error: "Unknown action: " + action });
        }
        transport.control(zone, action, function (err) {
          if (err) return sendJson(res, 502, { error: "Roon: " + err });
          sendJson(res, 200, { ok: true, zone: zone.display_name, action: action });
        });
      })
      .catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    return;
  }

  // Roon's own "Transfer Zone": it takes what is playing in one zone and
  // hands it to another. For us that is the honest way to change zones --
  // the alternative would be starting the station afresh in the new zone
  // and stopping the old one, two interventions with a window in between in
  // which both play.
  if (req.method === "POST" && req.url === "/api/transfer-zone") {
    readJsonBody(req)
      .then(function (payload) {
        if (!transport) return sendJson(res, 502, { error: "Not connected to the Roon core" });
        var from = findZone(payload && payload.from);
        var to = findZone(payload && payload.to);
        if (!from) return sendJson(res, 404, { error: "Source zone not found: " + (payload && payload.from) });
        if (!to) return sendJson(res, 404, { error: "Target zone not found: " + (payload && payload.to) });
        if (from.zone_id === to.zone_id) {
          return sendJson(res, 200, { transferred: false, zone: to.display_name });
        }
        transport.transfer_zone(from, to, function (err) {
          if (err) return sendJson(res, 502, { error: "Roon: " + err });
          sendJson(res, 200, { transferred: true, from: from.display_name, to: to.display_name });
        });
      })
      .catch(function (e) {
        sendJson(res, 400, { error: e.message });
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/play-station") {
    var body = "";
    req.on("data", function (c) {
      body += c;
    });
    req.on("end", function () {
      var payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON" });
      }
      var zone = findZone(payload && payload.zone);
      if (!zone) {
        return sendJson(res, 404, { error: "Zone not found: " + (payload && payload.zone) });
      }
      playStation(zone, function (err) {
        if (err) return sendJson(res, 502, { error: err });
        sendJson(res, 200, { started: true, zone: zone.display_name, station: STATION_NAME });
      });
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, function () {
  console.log('roon-trigger listening on :' + PORT + ' (station: "' + STATION_NAME + '")');
});
