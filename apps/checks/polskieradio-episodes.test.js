"use strict";

// Finding a Dwojka edition in the episode list the series page carries.
//
// The fixture is the real page, not a copy of one: six kilobytes cut out of
// polskieradio.pl/dwojka/audycje/fantazja-polska,382, fetched 16.09.2026,
// unedited. It is machine-generated into the literal below rather than typed,
// because the payload lives inside a JavaScript string -- every quotation mark
// arrives as \" -- and a hand-written fixture would be a test of my typing.
//
// What it proves is mostly one thing. The page carries "showEpisodes" TWICE --
// once empty, in its loading state, and once with the editions. An adapter that
// takes the first match reports "no episodes" for a series that has ten, and
// that is precisely the false conclusion this whole route exists to undo.

const test = require("node:test");
const assert = require("node:assert");
const ep = require("../adapters/polskieradio-episodes");

// Copied byte for byte out of the page, machine-generated into this literal and
// not retyped. `test/` is in .gitignore, which is why every fixture in this
// folder is inline and this one is too -- a check that reads a capture from
// disk passes on the machine that made the capture and nowhere else.
const PAGE =
    "cz\u0105 Dw\u00f3jki, dominuj\u0105 w Fantazji polskiej. Maj\u0105 one swoich wiernych s\u0142uchaczy tak\u017ce za granic\u0105: w\u015br\u00f3d ciekawy"
  + "ch nowej muzyki meloman\u00f3w, poszukuj\u0105cych nagra\u0144, kt\u00f3rych nie spos\u00f3b znale\u017a\u0107 na p\u0142ytach!\\\",\\\"showEpisodes\\\":["
  + "],\\\"variant\\\":\\\"radioShow\\\",\\\"image\\\":\\\"https://static.prsa.pl/images/db85d0a9-ff2d-4b4c-909b-cea55f330237.f"
  + "ile?format=700\\\",\\\"antenna\\\":\\\"dwojka\\\",\\\"categoryId\\\":382,\\\"showName\\\":\\\"Fantazja polska\\\",\\\"loading\\\":true"
  + "}],\\\"children\\\":\\\"$L3a\\\"}]]}]\\n\"])</script><script>self.__next_f.push([1,\"3a:[\\\"$\\\",\\\"$L39\\\",null,{\\\"descrip"
  + "tion\\\":\\\"Muzyka polskich kompozytor\u00f3w od \u015bredniowiecza do czas\u00f3w Chopina.\\\\r\\\\nPolska kultura muzyczna jest "
  + "bogatsza, ni\u017c mo\u017cna by s\u0105dzi\u0107 po repertuarach filharmonicznych. Polskie Radio od dziesi\u0119cioleci nagrywa w\u0142a\u015b"
  + "nie t\u0119 muzyk\u0119, kt\u00f3ra nie dor\u00f3wnuje popularno\u015bci\u0105 utworom Chopina czy Szymanowskiego.\\\\r\\\\nArchiwalne rejestr"
  + "acje Polskiego Radia, realizowane pod redakcyjn\u0105 piecz\u0105 Dw\u00f3jki, dominuj\u0105 w Fantazji polskiej. Maj\u0105 one swoic"
  + "h wiernych s\u0142uchaczy tak\u017ce za granic\u0105: w\u015br\u00f3d ciekawych nowej muzyki meloman\u00f3w, poszukuj\u0105cych nagra\u0144, kt\u00f3rych"
  + " nie spos\u00f3b znale\u017a\u0107 na p\u0142ytach!\\\",\\\"showEpisodes\\\":[{\\\"articleId\\\":3367189,\\\"title\\\":\\\"Fantazja polska 19 kw"
  + "ietnia godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-19T06:00:00\\\",\\\"sounds\\\":[\\\"https://static.pr"
  + "sa.pl/13a7f3b0-02ce-4930-8a3f-0166fbd7ae60.mp3\\\"]},{\\\"articleId\\\":3366697,\\\"title\\\":\\\"Fantazja polska 18 kwi"
  + "etnia godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-18T06:00:01\\\",\\\"sounds\\\":[\\\"https://static.prs"
  + "a.pl/92caa137-6418-40f7-a919-166d5a640399.mp3\\\"]},{\\\"articleId\\\":3366110,\\\"title\\\":\\\"Fantazja polska 17 kwie"
  + "tnia godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-17T06:00:00\\\",\\\"sounds\\\":[\\\"https://static.prsa"
  + ".pl/0c11c3a0-0142-447a-b29c-4202a8e5a128.mp3\\\"]},{\\\"articleId\\\":3365548,\\\"title\\\":\\\"Fantazja polska 16 kwiet"
  + "nia godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-16T06:00:00\\\",\\\"sounds\\\":[\\\"https://static.prsa."
  + "pl/9de13df6-6e17-4bce-9a85-ae6d223a156e.mp3\\\"]},{\\\"articleId\\\":3365039,\\\"title\\\":\\\"Fantazja polska 15 kwietn"
  + "ia godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-15T06:00:33\\\",\\\"sounds\\\":[\\\"https://static.prsa.p"
  + "l/ce8e0ecd-58fd-4d3c-9aa7-b23e0db03622.mp3\\\"]},{\\\"articleId\\\":3364713,\\\"title\\\":\\\"Fantazja polska 14 kwietni"
  + "a godz. 02:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-14T02:00:07\\\",\\\"sounds\\\":[\\\"https://static.prsa.pl"
  + "/747b9a4f-18c6-4401-8373-2dc5748b6574.mp3\\\"]},{\\\"articleId\\\":3364408,\\\"title\\\":\\\"Fantazja polska 13 kwietnia"
  + " godz. 01:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-13T01:00:00\\\",\\\"sounds\\\":[\\\"https://static.prsa.pl/"
  + "0a1e9893-60cd-48a2-8481-d8fcc2c3a48a.mp3\\\"]},{\\\"articleId\\\":3363200,\\\"title\\\":\\\"Fantazja polska 12 kwietnia "
  + "godz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-12T06:00:01\\\",\\\"sounds\\\":[\\\"https://static.prsa.pl/b"
  + "cb97d29-8c5d-478c-bb02-deb1aaa25577.mp3\\\"]},{\\\"articleId\\\":3362672,\\\"title\\\":\\\"Fantazja polska 11 kwietnia g"
  + "odz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-11T06:00:00\\\",\\\"sounds\\\":[\\\"https://static.prsa.pl/9b"
  + "987b10-9502-4733-8dba-f6cd25895573.mp3\\\"]},{\\\"articleId\\\":3362148,\\\"title\\\":\\\"Fantazja polska 10 kwietnia go"
  + "dz. 06:00\\\",\\\"station\\\":\\\"Dw\u00f3jka\\\",\\\"date\\\":\\\"2024-04-10T06:00:00\\\",\\\"sounds\\\":[\\\"https://static.prsa.pl/304"
  + "eb246-9baf-46e2-89df-95aa36391292.mp3\\\"]}],\\\"variant\\\":\\\"radioShow\\\",\\\"image\\\":\\\"https://static.prsa.pl/imag"
  + "es/db85d0a9-ff2d-4b4c-909b-cea55f330237.file?format=700\\\",\\\"antenna\\\":\\\"dwojka\\\",\\\"categoryId\\\":382,\\\"showNa"
  + "me\\\":\\\"Fantazja polska\\\",\\\"total\\\":2803}]\\n\"])</script><div hidden id=\"S:0\"><div id=\"broadcast-list\" class=\""
  + "mx-auto w-full pb-32 md:container md:pt-9\"><div class=\"mb-3 hidden md:block\"><div class=\"w-full relative\"><s"
  + "pan class=\"text-black-500 dark:text-white font-primary text-3xl font-bold relative after:content-[&#x27;&#x2"
  + "7;] after:w-full after:-translate-y-1 after:absolute after:-bottom-4 after:left-0 after:bg-red after:h-1 z-2"
  + "0\">Odcinki</span><div class=\"w-full absolute -bottom-3 left-0 bg-black-400 h-px\"></div></div></div><div clas"
  + "s=\"flex justify-center border-b border-solid border-black-500 bg-black-700 md:hidden\"><button class=\"w-32 h-"
  + "10 flex justify-center items-center block bg-black-500 text-primary bold transition-all text-black-400 relat"
  + "ive text-bold mr-2 rounded-tl-md bg-white text-black-500 dark:bg-black-500 dark:text-white\">Odcinki<span cla"
  + "ss=\"absolute -bottom-[1px] h-[6px] w-full bg-red\"></span></button><button class=\"w-32 h-10 flex justify-cent"
  + "er items-center block bg-black-500 text-primary bold transition-all text-black-400 relative text-bold rounde"
  + "d-tr-md\">O audycji</button></div><div class=\"w-full px-2 md:grid md:grid-cols-2 md:px-0 lg:grid-cols-3\"><div"
  + " class=\"col-span-2\"><div><div class=\"text-primary relative w-full border-b border-solid border-black-400 bg-"
  + "white text-black-500 transition-all dark:bg-black-700 dark:text-white\"><a href=\"/dwojka/audycje/fantazja-pol"
  + "ska,382/odcinek/fantazja-polska-19-kwietnia-godz-0600,13a7f3b0-02ce-4930-8a3f-0166fbd7ae60\"><h4 class=\"text "
  + "py-4 text-sm font-normal md:max-w-[630px] md:pb-0 md:text-base md:font-medium\">Fantazja polska 19 kwietnia g"
  + "odz. 06:00</h4></a><div class=\"mb-6 flex items-center\"><div class=\"mr-4 flex items-center\"><svg xmlns=\"http:"
  + "//www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\" class=\"mr-2 h-3 w-3\"><path fill=\"#B8B8B8\" d=\"M16 1.6h"
  + "-3.2V0h-1.6v4.8h1.6V3.2h1.6v11.2H1.6V3.2h1.6V1.6H0V16h16z\"></path><path fill=\"#B8B8B8\" d=\"M6.255 0H4.801v4.8"
  + "h1.454V3.2h3.346V1.6H6.255zM6.4 6.4H3.2v3.2h3.2zM12.8 6.4h-1.6V8h1.6zM9.6 6.4H8V8h1.6zM12.8 9.6h-1.6v1.6h1.6"
  + "zM9.6 9.6H8v1.6h1.6z\"></path></svg><span class=\"text-sm\">19.04.2024</span></div><div class=\"flex items-cente"
  + "r\"><svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\" class=\"mr-2 h-3 w-3\"><g fill=\"#B8"
  + "B8B8\" clip-path=\"url(#clock_svg__a)\"><path d=\"M8 16c4.436 0 8-3.564 8-8s-3.564-8-8-8-8 3.564-8 8 3.564 8 8 8"
  + "M8 1.455A6.52 6.52 0 0 1 14.546 8 6.52 6.52 0 0 1 8 14.546 6.52 6.52 0 0 1 1.455 8 6.52 6.52 0 0 1 8 1.455\">"
  + "</path><path d=\"M11.419 10.4 8.728 7.71v-4.8H7.273V8.29l3.128 3.127z\"></path></g><defs><clipPath id=\"clock_s"
  + "vg__a\"><path fill=\"#fff\" d=\"M0 0h16v16H0z\"></path></clipPath></defs></svg><span class=\"text-sm\">06:00</span>"
  + "</div></div><div class=\"absolute bottom-3 ri";

test("the fixture still contains the trap it was kept for", () => {
  assert.ok(PAGE.indexOf('\\"showEpisodes\\":[]') !== -1,
    "the empty loading-state copy must be in the capture, or the next test proves nothing");
});

test("the longest episode list wins, not the first", () => {
  const list = ep.parseEpisodes(PAGE);
  assert.equal(list.length, 10);
  assert.equal(list[0].date, "2024-04-19T06:00:00");
  assert.equal(list[list.length - 1].date, "2024-04-10T06:00:00");
});

test("the edition of a day is found by its broadcast time", () => {
  const list = ep.parseEpisodes(PAGE);
  assert.match(ep.episodeFor(list, { day: "2024-04-19", minutes: 6 * 60 }).title,
    /19 kwietnia/);
  // 18.04. carries date 06:00:01 for a programme announced at 06:00 -- nearest,
  // not exact, or the station's own rounding would lose the edition.
  assert.match(ep.episodeFor(list, { day: "2024-04-18", minutes: 6 * 60 }).title,
    /18 kwietnia/);
});

test("a day with no edition is not answered with a neighbouring one", () => {
  const list = ep.parseEpisodes(PAGE);
  assert.equal(ep.episodeFor(list, { day: "2024-04-20", minutes: 6 * 60 }), null);
  assert.equal(ep.episodeFor(list, { day: "2026-09-16", minutes: 60 }), null,
    "the reason Fantazja polska cannot be resolved today: the list stops in 2024");
});

test("the recording comes out of the episode itself", () => {
  const list = ep.parseEpisodes(PAGE);
  const sound = ep.soundOf(ep.episodeFor(list, { day: "2024-04-19", minutes: 6 * 60 }));
  assert.equal(sound, "https://static.prsa.pl/13a7f3b0-02ce-4930-8a3f-0166fbd7ae60.mp3");
});

test("the edition's own page is found by the uuid, not built from the title", () => {
  const list = ep.parseEpisodes(PAGE);
  const sound = ep.soundOf(list[0]);
  assert.equal(
    ep.episodePageFor(PAGE, sound),
    "https://www.polskieradio.pl/dwojka/audycje/fantazja-polska,382/odcinek/" +
      "fantazja-polska-19-kwietnia-godz-0600,13a7f3b0-02ce-4930-8a3f-0166fbd7ae60");
  // A recording whose link is not on the page leaves the caller with the series
  // page, which is true rather than convenient.
  assert.equal(ep.episodePageFor(PAGE, "https://static.prsa.pl/" +
    "00000000-0000-0000-0000-000000000000.mp3"), null);
  assert.equal(ep.episodePageFor(PAGE, "not-a-sound"), null);
});

test("one level out of a JavaScript string, left to right", () => {
  assert.equal(ep.unescapeJsString('\\"a\\"'), '"a"');
  // A backslash before an escaped quote: the pair goes first, then the quote
  // stands on its own. The other order would swallow the quotation mark.
  assert.equal(ep.unescapeJsString('a\\\\\\"b'), 'a\\"b');
  assert.equal(ep.unescapeJsString('\\u00f3'), "ó");
  assert.equal(ep.unescapeJsString('a\\/b'), "a/b");
});

test("a bracket inside a title does not end the array", () => {
  const text = '"showEpisodes":[{"title":"Kwartet [wersja koncertowa]"},{"title":"b"}] rest';
  const raw = ep.jsonArrayAt(text, text.indexOf("["));
  assert.equal(JSON.parse(raw).length, 2);
  assert.equal(JSON.parse(raw)[0].title, "Kwartet [wersja koncertowa]");
});
