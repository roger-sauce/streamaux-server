(function () {
  "use strict";

  // Test addresses collected 2026-07-22, last added to 2026-07-24. Between
  // them they cover every adapter, and the newest addition always stands
  // first, so that what was added last is what is seen first.
  // "hakushi-hasegawa-honest" holds one track under DRM. It is skipped, and
  // the set should still deliver its other track -- see soundcloud.js.
  var TESTS = [
    { label: "WXDU 88.7 FM (Duke University, Livestream)", url: "https://wxdu.org" },
    { label: "Klara (VRT, Livestream)", url: "https://www.vrt.be/vrtmax/kanalen/klara/" },
    { label: "Polskie Radio 2 (Livestream)", url: "https://www.polskieradio.pl/8,Dwojka" },
    { label: "DR P8 Jazz (Livestream)", url: "https://www.dr.dk/lyd/p8jazz" },
    { label: "DR P2 (Livestream)", url: "https://www.dr.dk/lyd/p2" },
    { label: "RTÉ 2fm (Livestream)", url: "https://www.rte.ie/radio/2fm/" },
    { label: "RTÉ Lyric FM (Livestream)", url: "https://www.rte.ie/radio/lyricfm/" },
    { label: "RNE Radio Clásica (Livestream)", url: "https://www.rtve.es/radio-clasica" },
    { label: "RNE Radio 3 (Livestream)", url: "https://www.rtve.es/play/videos/directo/rne-streamings/conciertos-radio-3/" },
    { label: "Rai Radio 3 (Livestream)", url: "https://www.raiplaysound.it/radio3" },
    { label: "NRK P2 (Livestream)", url: "https://radio.nrk.no/direkte/p2" },
    { label: "World of Jazz (Concertzender, Livestream)", url: "https://www.worldofjazz.nl" },
    { label: "Concertzender (Livestream)", url: "https://www.concertzender.nl" },
    { label: "Sveriges Radio P2 (Livestream)", url: "https://www.sverigesradio.se/p2" },
    { label: "SRF 2 Kultur (Livestream)", url: "https://www.srf.ch/audio/radio-srf-2-kultur-live-hoeren" },
    { label: "Ö1 / ORF (Livestream)", url: "https://sound.orf.at/radio/oe1" },
    { label: "BBC Radio 3 (Livestream)", url: "https://www.bbc.co.uk/sounds/play/live/bbc_radio_three" },
    { label: "France Inter (Livestream)", url: "https://www.radiofrance.fr/franceinter" },
    { label: "France Musique (Livestream)", url: "https://www.radiofrance.fr/francemusique" },
    { label: "Deutschlandfunk (Livestream)", url: "https://www.deutschlandfunk.de/livestream-100.html" },
    { label: "Deutschlandfunk Kultur (Livestream)", url: "https://www.deutschlandfunkkultur.de/" },
    { label: "radio3 rbb (Livestream, MP3)", url: "https://www.radiodrei.de/livestream/" },
    { label: "HR2 (Livestream)", url: "https://www.hr2.de/index.html" },
    { label: "SWR Kultur (Livestream)", url: "https://www.swr.de/swrkultur/index.html" },
    { label: "WDR 3 (Livestream)", url: "https://www1.wdr.de/radio/wdr3/index.html" },
    { label: "BR-Klassik (Livestream)", url: "https://www.br.de/radio/live/br-klassik/" },
    { label: "Bandcamp Editorial", url: "https://daily.bandcamp.com/label-profile/free-dirt-records-label-profile" },
    { label: "Bandcamp Radio", url: "https://bandcamp.com/radio?show=968" },
    { label: "Bandcamp Album", url: "https://chuckstrangers.bandcamp.com/album/glory-of-the-kings-hand" },
    { label: "NTS (short-circuit to Mixcloud)", url: "https://www.nts.live/shows/the-breakfast-show-flo/episodes/the-breakfast-show-flo-30th-april-2026" },
    { label: "NTS (either SoundCloud or Mixcloud)", url: "https://www.nts.live/shows/early-bird-show-jack-rollo/episodes/early-bird-show-jack-rollo-21st-july-2023" },
    { label: "SoundCloud single track", url: "https://soundcloud.com/freesoulinc/va-spirits-high-above-xvi-up" },
    { label: "SoundCloud Set", url: "https://soundcloud.com/brainfeeder/sets/hakushi-hasegawa-honest" },
    { label: "minnakikeru.com", url: "https://minnakikeru.com/item/al:djtZvUgjxC" },
    { label: "Wire UK (Mixcloud)", url: "https://www.thewire.co.uk/about/contributors/misha-farrant/misha-farrant-presents-adventures-in-sound-and-music-78678" },
    { label: "Wire UK (MP3)", url: "https://www.thewire.co.uk/audio/tracks/office-ambience-509" },
  ];

  var SAMPLE_MS = 6000; // how long each track is sampled before moving on

  var els = {
    btnStart: document.getElementById("btn-start"),
    body: document.getElementById("results-body"),
    audio: document.getElementById("test-audio"),
    nowLabel: document.getElementById("now-label"),
  };

  function addRow(test) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td>' + test.label + '</td>' +
      '<td class="url-cell">' + test.url + '</td>' +
      '<td class="status-pending" data-role="status">waiting</td>' +
      '<td data-role="details"></td>';
    els.body.appendChild(tr);
    return {
      setStatus: function (cls, text) {
        var cell = tr.querySelector('[data-role="status"]');
        cell.className = "status-" + cls;
        cell.textContent = text;
      },
      setDetails: function (text) {
        tr.querySelector('[data-role="details"]').textContent = text;
      },
    };
  }

  function extract(url) {
    return fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
        return data;
      });
    });
  }

  // Plays a little of streamUrl and watches whether currentTime really
  // moves forward. That is a far better signal than "loaded without an
  // error", which a silent stream passes just as well as a sounding one.
  function sampleAudio(streamUrl, label) {
    return new Promise(function (resolve) {
      els.nowLabel.textContent = "Playing: " + label;
      els.audio.pause();
      els.audio.removeAttribute("src");
      els.audio.load();
      els.audio.src = streamUrl;

      var settled = false;
      var startTime = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        els.audio.pause();
        resolve(result);
      }

      els.audio.addEventListener(
        "error",
        function () {
          var err = els.audio.error;
          finish({
            ok: false,
            reason: err ? "MediaError " + err.code + " (" + err.message + ")" : "audio failed, no reason given",
          });
        },
        { once: true }
      );

      var p = els.audio.play();
      if (p && p.catch) {
        p.catch(function (e) {
          finish({ ok: false, reason: "play() refused: " + e.name + " " + e.message });
        });
      }

      setTimeout(function () {
        if (startTime === null) startTime = els.audio.currentTime;
      }, 500);

      setTimeout(function () {
        var advanced = els.audio.currentTime - (startTime || 0);
        if (els.audio.error) {
          finish({ ok: false, reason: "MediaError " + els.audio.error.code });
        } else if (advanced > 0.5 && !els.audio.paused) {
          finish({ ok: true, reason: "currentTime +" + advanced.toFixed(1) + "s" });
        } else {
          finish({ ok: false, reason: "currentTime does not move (paused=" + els.audio.paused + ")" });
        }
      }, SAMPLE_MS);
    });
  }

  async function runOne(test) {
    var row = addRow(test);
    row.setStatus("running", "extracting…");
    var data;
    try {
      data = await extract(test.url);
    } catch (e) {
      row.setStatus("fail", "extraction failed");
      row.setDetails(e.message);
      return;
    }

    var trackCount = (data.tracks || []).length;
    if (trackCount === 0) {
      row.setStatus("fail", "no tracks");
      row.setDetails("sourceType=" + data.sourceType);
      return;
    }

    row.setStatus("running", "playing track 1/" + trackCount + "…");
    var track = data.tracks[0];
    var result = await sampleAudio(track.streamUrl, test.label + " - " + (track.title || ""));

    if (result.ok) {
      row.setStatus("pass", "OK");
      row.setDetails(
        '"' + (data.title || "") + '" - ' + trackCount + " Track(s), sourceType=" + data.sourceType + " (" + result.reason + ")"
      );
    } else {
      row.setStatus("fail", "no audio");
      row.setDetails(result.reason + ' - Track: "' + (track.title || "") + '"');
    }
  }

  async function runAll() {
    els.btnStart.disabled = true;
    els.body.innerHTML = "";
    for (var i = 0; i < TESTS.length; i++) {
      await runOne(TESTS[i]);
    }
    els.nowLabel.textContent = "Done.";
    els.btnStart.disabled = false;
  }

  els.btnStart.addEventListener("click", runAll);
})();
