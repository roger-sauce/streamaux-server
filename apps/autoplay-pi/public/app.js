(function () {
  "use strict";

  var ROON_POLL_MS = 2000;
  var els = {
    urlForm: document.getElementById("url-form"),
    urlInput: document.getElementById("url-input"),
    roonZone: document.getElementById("roon-zone"),
    btnExtract: document.getElementById("btn-extract"),
    status: document.getElementById("status"),
    nowPlaying: document.getElementById("now-playing"),
    cover: document.getElementById("cover"),
    npTitle: document.getElementById("np-title"),
    npSource: document.getElementById("np-source"),
    transportRow: document.getElementById("transport-row"),
    npCurrentTrack: document.getElementById("np-current-track"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    tracklist: document.getElementById("tracklist"),
    btnDeviceStop: document.getElementById("btn-device-stop"),
    btnRoon: document.getElementById("btn-roon"),
    btnRoonResume: document.getElementById("btn-roon-resume"),
    resumeRow: document.getElementById("resume-row"),
    roonZoneResume: document.getElementById("roon-zone-resume"),
    spinnerRow: document.getElementById("spinner-row"),
    roonOnly: document.getElementById("roon-only"),
    roonOnlyTitle: document.getElementById("roon-only-title"),
    roonOnlyPos: document.getElementById("roon-only-pos"),
    btnRoonOnlyStop: document.getElementById("btn-roon-only-stop"),
    roonStatus: document.getElementById("roon-status"),
    audio: document.getElementById("audio"),
    timeCur: document.getElementById("time-cur"),
    timeDur: document.getElementById("time-dur"),
    progressFill: document.getElementById("progress-fill"),
  };

  // ---------- supported-stations dropdown ----------
  // Two groups, and a click means something different in each:
  // - STATIONS_PLATFORMS: on-demand places where WHAT to listen to still
  //   has to be chosen. The link opens the front page in a new tab and
  //   does NOT fill the URL field.
  // - STATIONS_RADIO: fixed livestreams, alphabetical. A click only fills
  //   the URL field, submits nothing, and closes the dropdown.
  var STATIONS_PLATFORMS = [
    { label: "Bandcamp", url: "https://bandcamp.com" },
    { label: "minnakikeru", url: "https://minnakikeru.com/" },
    { label: "NTS", url: "https://www.nts.live" },
    { label: "SoundCloud", url: "https://soundcloud.com/discover" },
    { label: "Wire UK", url: "https://www.thewire.co.uk/home/" },
  ];

  var STATIONS_RADIO = [
    { label: "BR-Klassik", url: "https://www.br.de/radio/live/br-klassik/" },
    { label: "Concertzender", url: "https://www.concertzender.nl" },
    { label: "Deutschlandfunk", url: "https://www.deutschlandfunk.de/livestream-100.html" },
    { label: "Deutschlandfunk Kultur", url: "https://www.deutschlandfunkkultur.de/" },
    { label: "DR P2", url: "https://www.dr.dk/lyd/p2" },
    { label: "DR P8 Jazz", url: "https://www.dr.dk/lyd/p8jazz" },
    { label: "France Inter", url: "https://www.radiofrance.fr/franceinter" },
    { label: "France Musique", url: "https://www.radiofrance.fr/francemusique" },
    { label: "HR2", url: "https://www.hr2.de/index.html" },
    { label: "Klara (VRT)", url: "https://www.vrt.be/vrtmax/kanalen/klara/" },
    { label: "NRK P2", url: "https://radio.nrk.no/direkte/p2" },
    { label: "Ö1 / ORF", url: "https://sound.orf.at/radio/oe1" },
    { label: "Polskie Radio 2", url: "https://www.polskieradio.pl/8,Dwojka" },
    { label: "radio3 rbb", url: "https://www.radiodrei.de/livestream/" },
    { label: "Rai Radio 3", url: "https://www.raiplaysound.it/radio3" },
    { label: "RNE Radio 3", url: "https://www.rtve.es/play/videos/directo/rne-streamings/conciertos-radio-3/" },
    { label: "RNE Radio Clásica", url: "https://www.rtve.es/radio-clasica" },
    { label: "RTÉ 2fm", url: "https://www.rte.ie/radio/2fm/" },
    { label: "RTÉ Lyric FM", url: "https://www.rte.ie/radio/lyricfm/" },
    { label: "SRF 2 Kultur", url: "https://www.srf.ch/audio/radio-srf-2-kultur-live-hoeren" },
    { label: "Sveriges Radio P2", url: "https://www.sverigesradio.se/p2" },
    { label: "SWR Kultur", url: "https://www.swr.de/swrkultur/index.html" },
    { label: "WDR 3", url: "https://www1.wdr.de/radio/wdr3/index.html" },
    { label: "World of Jazz", url: "https://www.worldofjazz.nl" },
    { label: "WXDU 88.7 FM", url: "https://wxdu.org" },
  ];

  function renderPlatformsGroup(ulId, list) {
    var ul = document.getElementById(ulId);
    list.forEach(function (s) {
      var li = document.createElement("li");
      li.className = "station-item-link";
      var a = document.createElement("a");
      a.className = "station-link";
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = s.label;
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  function renderRadioGroup(ulId, list) {
    var ul = document.getElementById(ulId);
    var details = document.getElementById("stations-dropdown");
    list.forEach(function (s) {
      var li = document.createElement("li");
      li.textContent = s.label;
      li.addEventListener("click", function () {
        els.urlInput.value = s.url;
        details.open = false;
        els.urlInput.focus();
      });
      ul.appendChild(li);
    });
  }

  function renderStationsList() {
    renderPlatformsGroup("stations-list-platforms", STATIONS_PLATFORMS);
    renderRadioGroup("stations-list-radio", STATIONS_RADIO);
  }

  // state.tracks: the playable queue. One entry is a continuous stream, as
  // at NTS; more than one is separate files, as at minnakikeru.
  // state.displayList: what the list shows -- at NTS the song metadata the
  // adapter delivered, everywhere else the same thing as state.tracks.
  // state.queueMode: true where the entries are real files and a click or
  // next/back moves between them; false where there is one stream and the
  // list is there to be read rather than clicked.
  var state = { tracks: [], displayList: [], index: 0, queueMode: false };
  var roonPollTimer = null;
  var roonIsPlaying = false; // Roon wins the equalizer icon in the tracklist
  var pendingResumeZone = null; // the stored zone, applied once the list is in

  function stopPolling() {
    if (roonPollTimer) { clearInterval(roonPollTimer); roonPollTimer = null; }
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------- playback on this device ----------
  // Reassurance more than anything: it shows that the extracted addresses
  // really do carry sound. It runs on regardless of what Roon is doing,
  // until it is stopped by hand. For .m3u8 this leans on Safari's own HLS
  // -- no hls.js, and deliberately no script from a CDN; .mp3 plays in any
  // browser.
  function playLocalIndex(i) {
    if (i < 0 || i >= state.tracks.length) return;
    state.index = i;
    var track = state.tracks[i];
    if (track.cover) {
      els.cover.src = track.cover;
      els.cover.classList.remove("hidden");
    }
    els.audio.src = track.streamUrl;
    updateTransportUi();
    attemptPlay();
  }

  // A slow extraction -- NTS and Wire go through Playwright and often take
  // 10 to 20 seconds -- outlives the tap that started it, and by the time
  // .play() is called Safari's autoplay policy refuses it silently, with no
  // visible error. So say so, and let a tap on the title try again: that
  // tap is a fresh gesture and is allowed.
  function attemptPlay() {
    var p = els.audio.play();
    if (p && p.catch) {
      p.catch(function (err) {
        if (err && err.name === "NotAllowedError") {
          els.status.textContent = "Ready -- tap here to play";
          els.npTitle.classList.add("tap-to-play");
          els.npTitle.addEventListener("click", retryPlay, { once: true });
        } else {
          // Not autoplay but a real playback failure -- an expired signed
          // stream address, say. That is worth seeing, rather than being
          // told to tap again for the rest of the evening.
          els.status.textContent = "Playback failed: " + (err && err.message ? err.message : "reason unknown");
        }
      });
    }
  }

  function retryPlay() {
    els.npTitle.classList.remove("tap-to-play");
    els.status.textContent = "";
    attemptPlay();
  }

  els.audio.addEventListener("error", function () {
    var err = els.audio.error;
    els.status.textContent = "Playback failed" + (err ? " (code " + err.code + ": " + err.message + ")" : "");
  });

  function playLocalNext() {
    if (state.index + 1 < state.tracks.length) playLocalIndex(state.index + 1);
  }

  function playLocalPrev() {
    if (els.audio.currentTime > 3) {
      els.audio.currentTime = 0;
      return;
    }
    if (state.index > 0) playLocalIndex(state.index - 1);
    else els.audio.currentTime = 0;
  }

  function stopLocal() {
    els.audio.pause();
    els.audio.removeAttribute("src");
    els.audio.load();
    els.timeCur.textContent = "0:00";
    els.timeDur.textContent = "0:00";
    els.progressFill.style.width = "0%";
    state.index = -1;
    highlightActive(-1);
  }

  function updateTransportUi() {
    if (!state.queueMode) {
      els.transportRow.classList.add("hidden");
      return;
    }
    els.transportRow.classList.remove("hidden");
    els.npCurrentTrack.textContent = (state.index + 1) + " / " + state.tracks.length;
  }

  els.audio.addEventListener("ended", function () {
    if (state.queueMode) playLocalNext();
  });

  // ---------- Roon status ----------

  // The two faces of one button, as constants because a later click has to
  // ask which of them is showing. That test read indexOf("stoppen") until
  // 18.08.2026, which tied what the button DOES to the words printed on it
  // -- and would have broken silently the moment those words changed.
  var LABEL_PLAY_ROON = "Play in Roon";
  var LABEL_STOP_ROON = "Stop Roon";

  function renderRoonStatus(data) {
    roonIsPlaying = !!(data && data.playing);
    if (!data || !data.playing) {
      els.btnRoon.textContent = LABEL_PLAY_ROON;
      els.roonStatus.textContent = data && data.error ? data.error : "";
      els.roonOnly.classList.add("hidden");
      stopPolling();
      if (data && data.resume && data.resume.title) {
        els.btnRoonResume.textContent = data.resume.live
          ? "Resume in Roon: " + data.resume.title
          : "Resume in Roon: " + data.resume.title + " (" + fmtTime(data.resume.seconds) + ")";
        if (data.resume.zone) {
          if (els.roonZoneResume.options.length) els.roonZoneResume.value = data.resume.zone;
          else pendingResumeZone = data.resume.zone;
        }
        els.resumeRow.classList.remove("hidden");
      } else {
        els.resumeRow.classList.add("hidden");
      }
      return;
    }
    els.resumeRow.classList.add("hidden");
    els.btnRoon.textContent = LABEL_STOP_ROON;
    var pos = data.trackCount > 1 ? " (" + (data.index + 1) + "/" + data.trackCount + ")" : "";
    els.roonStatus.textContent = "In Roon: " + (data.currentTitle || data.title || "…") + pos;
    // Roon can be playing with nothing extracted in this tab -- after a
    // resume, after a reload, or because it was started on another device.
    // Then a small panel of its own says what is on; without it the screen
    // would be silent about something that is audibly playing.
    if (els.nowPlaying.classList.contains("hidden")) {
      els.roonOnlyTitle.textContent = data.currentTitle || data.title || "…";
      els.roonOnlyPos.textContent = (data.seconds != null ? fmtTime(data.seconds) : "") + pos;
      els.roonOnly.classList.remove("hidden");
    } else {
      els.roonOnly.classList.add("hidden");
    }
    // Keep the poll alive when the playback was not started in this tab.
    // Guarded on the timer being empty, so intervals cannot stack up.
    if (!roonPollTimer) roonPollTimer = setInterval(pollRoonStatus, ROON_POLL_MS);
    // Once Roon is playing it owns the equalizer icon, whether or not the
    // browser is playing alongside it. One icon, and Roon wins it.
    if (data.seconds != null) highlightActive(data.seconds);
  }

  function pollRoonStatus() {
    fetch("/api/roon-status").then(function (r) { return r.json(); }).then(renderRoonStatus).catch(function () {});
  }

  function startPolling() {
    stopPolling();
    pollRoonStatus();
    roonPollTimer = setInterval(pollRoonStatus, ROON_POLL_MS);
  }

  function loadZones() {
    fetch("/api/roon-zones")
      .then(function (r) { return r.json(); })
      .then(function (zones) {
        els.roonZone.innerHTML = "";
        els.roonZoneResume.innerHTML = "";
        (Array.isArray(zones) ? zones : []).forEach(function (z) {
          [els.roonZone, els.roonZoneResume].forEach(function (sel) {
            var opt = document.createElement("option");
            opt.value = z.id;
            opt.textContent = z.name;
            sel.appendChild(opt);
          });
        });
        // Preselect the zone last used, rather than silently taking
        // whichever zone happens to stand first in the list.
        if (pendingResumeZone) {
          els.roonZoneResume.value = pendingResumeZone;
          pendingResumeZone = null;
        }
      })
      .catch(function () {});
  }

  // ---------- the tracklist ----------
  // Two modes. In "queue" -- minnakikeru and its like -- the entries are
  // real files, a row is clickable and starts that track here, and the
  // active row is state.index. In "info" -- NTS -- there is one continuous
  // stream and the list is song metadata with timestamps; the active row
  // follows audio.currentTime, and no row can be clicked.
  function renderTracklist(data) {
    state.queueMode = data.tracks.length > 1;
    state.displayList = data.tracklist || data.tracks.map(function (t) {
      return { artist: data.artist || "", title: t.title, seconds: null };
    });
    els.tracklist.innerHTML = "";
    state.displayList.forEach(function (t, i) {
      var li = document.createElement("li");
      li.dataset.index = String(i);
      li.innerHTML =
        '<span class="tl-indicator"><span></span><span></span><span></span></span>' +
        '<span class="tl-time"></span><span class="tl-artist"></span><span class="tl-title"></span>' +
        '<a class="tl-discogs" target="_blank" rel="noopener noreferrer" title="Search Discogs">' +
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<circle cx="12" cy="12" r="11" fill="currentColor"/>' +
        '<circle cx="12" cy="12" r="8.3" fill="none" stroke="var(--bg)" stroke-width="0.7" opacity="0.6"/>' +
        '<circle cx="12" cy="12" r="5.8" fill="none" stroke="var(--bg)" stroke-width="0.7" opacity="0.6"/>' +
        '<circle cx="12" cy="12" r="3.2" fill="var(--bg)"/>' +
        '<circle cx="12" cy="12" r="1" fill="currentColor"/>' +
        "</svg></a>";
      li.querySelector(".tl-time").textContent =
        t.seconds != null ? fmtTime(t.seconds) : (state.queueMode ? String(i + 1) + "." : "–:–");
      li.querySelector(".tl-artist").textContent = t.artist || "";
      li.querySelector(".tl-title").textContent = t.title || "";
      var query = [t.artist, t.title].filter(Boolean).join(" ");
      li.querySelector(".tl-discogs").href = "https://www.discogs.com/search/?q=" + encodeURIComponent(query);
      li.querySelector(".tl-discogs").addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
      if (state.queueMode) {
        li.classList.add("clickable");
        li.addEventListener("click", function () { playLocalIndex(i); });
      }
      els.tracklist.appendChild(li);
    });
  }

  // Which row is the current one. In a real queue that is state.index; in
  // one continuous stream it is the last entry whose timestamp is at or
  // before currentTime. Entries without a timestamp -- the ones NTS keeps
  // behind its supporter wall -- are skipped rather than guessed at.
  function highlightActive(currentTime) {
    var activeIndex = -1;
    if (state.queueMode) {
      activeIndex = state.index;
    } else {
      state.displayList.forEach(function (t, i) {
        if (t.seconds != null && t.seconds <= currentTime) activeIndex = i;
      });
    }
    var items = els.tracklist.querySelectorAll("li");
    items.forEach(function (li) {
      var isActive = Number(li.dataset.index) === activeIndex;
      li.classList.toggle("active", isActive);
      if (isActive) li.scrollIntoView({ block: "nearest" });
    });
  }

  els.audio.addEventListener("timeupdate", function () {
    var d = els.audio.duration || 0;
    var c = els.audio.currentTime || 0;
    els.timeCur.textContent = fmtTime(c);
    els.timeDur.textContent = fmtTime(d);
    els.progressFill.style.width = (d ? (c / d) * 100 : 0) + "%";
    if (!roonIsPlaying) highlightActive(c);
  });
  els.audio.addEventListener("loadedmetadata", function () {
    els.timeDur.textContent = fmtTime(els.audio.duration || 0);
  });

  // ---------- the URL form ----------
  els.urlForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var url = els.urlInput.value.trim();
    if (!url) return;
    els.btnExtract.disabled = true;
    els.status.textContent = "Extracting, which can take up to 30 seconds…";
    els.spinnerRow.classList.remove("hidden");
    els.nowPlaying.classList.add("hidden");
    fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw new Error(data.error || "Extraction failed");
          return data;
        });
      })
      .then(function (data) {
        els.status.textContent = "";
        els.npTitle.textContent = data.title || "";
        els.npSource.textContent = data.sourceType ? "Source: " + data.sourceType : "";
        if (data.cover) {
          els.cover.src = data.cover;
          els.cover.classList.remove("hidden");
        } else {
          els.cover.classList.add("hidden");
        }
        els.nowPlaying.classList.remove("hidden");
        state.tracks = data.tracks || [];
        renderTracklist(data);
        playLocalIndex(0);
      })
      .catch(function (e) {
        els.status.textContent = e.message || "Something went wrong";
      })
      .finally(function () {
        els.btnExtract.disabled = false;
        els.spinnerRow.classList.add("hidden");
      });
  });

  els.btnRoonResume.addEventListener("click", function () {
    els.roonStatus.textContent = "Resuming in Roon, which can take up to 30 seconds…";
    els.spinnerRow.classList.remove("hidden");
    els.btnRoonResume.disabled = true;
    fetch("/api/resume-roon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone: els.roonZoneResume.value }),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw new Error(data.error || "Could not resume");
        });
      })
      .then(startPolling)
      .catch(function (e) { els.roonStatus.textContent = e.message || "Something went wrong"; })
      .finally(function () {
        els.btnRoonResume.disabled = false;
        els.spinnerRow.classList.add("hidden");
      });
  });

  els.btnDeviceStop.addEventListener("click", stopLocal);
  els.btnPrev.addEventListener("click", playLocalPrev);
  els.btnNext.addEventListener("click", playLocalNext);

  els.btnRoon.addEventListener("click", function () {
    if (els.btnRoon.textContent === LABEL_STOP_ROON) {
      fetch("/api/stop-roon", { method: "POST" }).then(pollRoonStatus);
      return;
    }
    var url = els.urlInput.value.trim();
    if (!url) return;
    els.roonStatus.textContent = "Starting playback in Roon…";
    els.spinnerRow.classList.remove("hidden");
    fetch("/api/play-roon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, zone: els.roonZone.value }),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw new Error(data.error || "Could not start playback");
          return data;
        });
      })
      .then(function () {
        startPolling();
      })
      .catch(function (e) {
        els.roonStatus.textContent = e.message || "Something went wrong";
      })
      .finally(function () {
        els.spinnerRow.classList.add("hidden");
      });
  });

  els.btnRoonOnlyStop.addEventListener("click", function () {
    fetch("/api/stop-roon", { method: "POST" }).then(pollRoonStatus);
  });

  loadZones();
  pollRoonStatus();
  renderStationsList();

  // Moved out of an inline <script> in index.html so that the CSP can keep
  // script-src at 'self' without having to allow 'unsafe-inline'.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
