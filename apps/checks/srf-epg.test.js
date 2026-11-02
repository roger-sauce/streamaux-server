"use strict";

// Finding an SRF broadcast in the EPG day it was announced in.
//
// The fixture below is COPIED from the real answer of
// srf.ch/epg/schedule/radio-srf-2-kultur/2026-09-15, fetched on 16.09.2026 and
// kept whole in test/srf-epg-radio-srf-2-kultur-20260915.json. Six of its
// forty-two shows are here -- everything else is cut, nothing is edited.
//
// The first of them is the reason this file exists in the shape it does. The
// day runs 00:00 to 22:06 in ascending order and carries ANOTHER 22:06 ahead of
// all of them, which a nearest-minute search takes in preference to the day's
// own. Nobody would have invented that; it had to be read.

const test = require("node:test");
const assert = require("node:assert");

const srfEpg = require("../adapters/srf-epg");

const DAY = {
  "station": "Radio SRF 2 Kultur",
  "date": "2026-09-15",
  "sections": [
    {
      "title": "Programm von Radio SRF 2 Kultur",
      "start": "00:00:00",
      "end": "23:59:59",
      "shows": [
        {
          "title": "Notturno",
          "start": "22:06:00",
          "end": "00:00:00",
          "episode": null
        },
        {
          "title": "Klassiktelefon",
          "start": "13:00:00",
          "end": "13:45:00",
          "episode": {
            "title": "Klassiktelefon 15.09.26",
            "audio_uuid": "28bce052-82bb-3f69-86e9-2a8c639329c5",
            "product_id": "AUDI20260915_RS_0021",
            "seoUrl": "https://www.srf.ch/audio/klassiktelefon/klassiktelefon-15-09-26?id=AUDI20260915_RS_0021"
          }
        },
        {
          "title": "Concerto",
          "start": "13:45:00",
          "end": "15:00:00",
          "episode": {
            "title": "Die vier Jahreszeiten in Buenos Aires mit dem Trio Zadig",
            "audio_uuid": "54b4323d-c20c-33df-8324-75be1effa8d5",
            "product_id": "AUDI20260915_RS_0022",
            "seoUrl": "https://www.srf.ch/audio/concerto/die-vier-jahreszeiten-in-buenos-aires-mit-dem-trio-zadig?id=AUDI20260915_RS_0022"
          }
        },
        {
          "title": "Jazz Collection",
          "start": "20:00:00",
          "end": "21:00:00",
          "episode": {
            "title": "Bassist Christian McBride - Schl\u00fcsselfigur des Jazz",
            "audio_uuid": "4a4db100-d909-382c-8f27-75e03758daa6",
            "product_id": "AUDI20260915_NR_0006",
            "seoUrl": "https://www.srf.ch/audio/jazz-collection/bassist-christian-mcbride-schluesselfigur-des-jazz?id=AUDI20260915_NR_0006"
          }
        },
        {
          "title": "Jazz punkt CH",
          "start": "21:00:00",
          "end": "22:00:00",
          "episode": {
            "title": "Micha Zumsteg tr\u00e4umt von einem Morgen mit Trost und Dankbarkeit",
            "audio_uuid": "7f7efb9b-cb68-348b-b17e-698e890a1e91",
            "product_id": "AUDI20260915_RS_0023",
            "seoUrl": "https://www.srf.ch/audio/jazz-punkt-ch/micha-zumsteg-traeumt-von-einem-morgen-mit-trost-und-dankbarkeit?id=AUDI20260915_RS_0023"
          }
        },
        {
          "title": "Notturno",
          "start": "22:06:00",
          "end": "00:00:00",
          "episode": null
        }
      ]
    }
  ]
};

// Zurich is UTC+2 on this day.
const CONCERTO_AT = new Date("2026-09-15T11:45:00.000Z");   // 13:45
const JAZZ_COLLECTION_AT = new Date("2026-09-15T18:00:00.000Z"); // 20:00
const NOTTURNO_AT = new Date("2026-09-15T20:06:00.000Z");   // 22:06

test("the leading carry-over is not part of the day", () => {
  const all = DAY.sections[0].shows;
  const kept = srfEpg.showsOf(DAY);
  assert.equal(all.length, 6);
  assert.equal(kept.length, 5, "the 22:06 printed ahead of 00:00 belongs to the evening before");
  assert.equal(kept[0].title, "Klassiktelefon");
});

test("a simulcast printed twice is not mistaken for a carry-over", () => {
  // Only a LEADING entry that breaks the ascending order is dropped. Two
  // genuine entries on the same minute, in order, both stay.
  const twice = { sections: [{ shows: [
    { title: "A", start: "20:00:00" },
    { title: "B", start: "20:00:00" },
    { title: "C", start: "21:00:00" },
  ] }] };
  assert.equal(srfEpg.showsOf(twice).length, 3);
});

test("the show that begins at that minute is the one found", () => {
  const shows = srfEpg.showsOf(DAY);
  assert.equal(srfEpg.showAt(shows, CONCERTO_AT).title, "Concerto");
  assert.equal(srfEpg.showAt(shows, JAZZ_COLLECTION_AT).title, "Jazz Collection");
});

test("at 22:06 it is the day's own Notturno, not the one carried over", () => {
  const found = srfEpg.showAt(srfEpg.showsOf(DAY), NOTTURNO_AT);
  assert.ok(found);
  assert.equal(found.title, "Notturno");
  // The two are identical in content, so identity is what is asserted: the
  // LAST of the two, which is the one the day's ascending run reaches.
  assert.equal(found, DAY.sections[0].shows[5]);
});

test("a slot no broadcast begins at is left alone", () => {
  // 17:00 Zurich: an hour after Concerto ends, three before Jazz Collection.
  assert.equal(srfEpg.showAt(srfEpg.showsOf(DAY), new Date("2026-09-15T15:00:00.000Z")), null);
});

test("the edition address is what gets handed on", () => {
  const show = srfEpg.showAt(srfEpg.showsOf(DAY), JAZZ_COLLECTION_AT);
  assert.match(show.episode.seoUrl, /^https:\/\/www\.srf\.ch\/audio\/jazz-collection\//);
  // And it is a broadcast address in the form srf-archive.js claims: two path
  // parts after /audio/. If that ever stops being true this hands it an address
  // it will refuse.
  assert.ok(require("../adapters/srf-archive").match(show.episode.seoUrl));
});

test("a show SRF names no edition for is a refusal, not a failure", () => {
  const found = srfEpg.showAt(srfEpg.showsOf(DAY), NOTTURNO_AT);
  assert.equal(found.episode, null,
    "Notturno runs nightly and SRF publishes no edition of it -- 14 of the 42 " +
    "shows of that day are like this, a day AFTER broadcast");
});

test("the Zurich wall clock decides which day page is asked for", () => {
  assert.deepEqual(srfEpg.zurichStamp(JAZZ_COLLECTION_AT), { day: "2026-09-15", minutes: 20 * 60 });
  // 22:30 UTC is 00:30 the next day in Zurich, and SRF files it there.
  assert.equal(srfEpg.zurichStamp(new Date("2026-09-15T22:30:00.000Z")).day, "2026-09-16");
});

test("the station page is claimed, the livestream and the broadcast page are not", () => {
  const share = "#kg=2026-09-15T18%3A00%3A00.000Z&kgt=Jazz%20Collection&kgs=srf2";
  assert.ok(srfEpg.match("https://www.srf.ch/audio/srf-2-kultur" + share));
  // Without the fragment too: the refusal that says WHY is better than silence,
  // and it can only be given by an adapter that took the address.
  assert.ok(srfEpg.match("https://www.srf.ch/audio/srf-2-kultur"));
  assert.ok(!srfEpg.match("https://www.srf.ch/audio/radio-srf-2-kultur-live-hoeren" + share));
  assert.ok(!srfEpg.match("https://www.srf.ch/audio/concerto/xy?id=AUDI20260915_RS_0022"));
  assert.ok(!srfEpg.match("https://www.srf.ch/audio/srf-1"), "an SRF station the guide does not collect");
});

test("the station id in the fragment names the channel even where the path does not", () => {
  assert.equal(srfEpg.channelOf("https://www.srf.ch/audio/srf-2-kultur"), "radio-srf-2-kultur");
  assert.equal(srfEpg.channelOf("https://www.srf.ch/audio/srf-2-kultur#kg=x&kgs=srf2"), "radio-srf-2-kultur");
});

test("the start time is read out of the fragment", () => {
  const url = "https://www.srf.ch/audio/srf-2-kultur#kg=2026-09-15T18%3A00%3A00.000Z&kgs=srf2";
  assert.equal(srfEpg.slotOf(url).toISOString(), "2026-09-15T18:00:00.000Z");
  assert.equal(srfEpg.slotOf("https://www.srf.ch/audio/srf-2-kultur"), null);
});
