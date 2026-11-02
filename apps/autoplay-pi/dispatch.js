/**
 * dispatch.js
 *
 * Finds the adapter that fits a given URL. The adapters/ folder (at apps/
 * level, a sibling of autoplay-pi/) holds the plain source modules only
 * (nts.js, later mk.js, wire.js, bandcamp.js, soundcloud.js) -- the
 * dispatch logic deliberately lives outside it.
 */

const nts = require("../adapters/nts");
const mk = require("../adapters/mk");
const wire = require("../adapters/wire");
const bandcamp = require("../adapters/bandcamp");
const soundcloud = require("../adapters/soundcloud");
// The Internet Archive: not a station's archive but a house of its own --
// Great 78, the Live Music Archive, LibriVox, the netlabels. A /details/
// address carries no file extension, so direct-audio would not catch it
// either way; it stands here with the other sources.
const archiveOrg = require("../adapters/archive-org");
// Mixcloud pasted as its own address. Until 14.08.2026 there was machinery
// for it but no way in: only wire.js used _mixcloud.js, for thewire.co.uk
// articles with an embedded player.
const mixcloud = require("../adapters/mixcloud");
const ardAudiothek = require("../adapters/ard-audiothek");
// The stations' own programme pages, which announce a broadcast but do not
// carry it. Ahead of br-klassik, wdr3, swr-kultur and hr2 below, which claim
// their whole domains: those answer with the livestream, and a programme page
// is not that. Which broadcast is meant comes in the URL fragment; without it
// this refuses rather than guessing. See ard-programme.js.
const ardProgramme = require("../adapters/ard-programme");
const deutschlandradio = require("../adapters/deutschlandradio");
// The dated schedule page of Deutschlandfunk and Deutschlandfunk Kultur, which
// the collection stores because the links on it are SERIES pages and the
// recordings do not exist yet when the week is collected. Finds the block of
// the slot and reads the recording out of it. Must sit AHEAD of the two
// station adapters below, which claim their whole domains and would answer a
// schedule page with the livestream. See deutschlandradio-programme.js for why
// it does not use pickAudioTagAt -- repeats.
const deutschlandradioProgramme = require("../adapters/deutschlandradio-programme");
// Ahead of the oe1 station adapter below on purpose: that one claims the
// whole of oe1.orf.at and would otherwise take the programme pages away.
const oe1Archive = require("../adapters/oe1-archive");
// Likewise ahead of its station adapter, and for the same reason.
const concertzenderArchive = require("../adapters/concertzender-archive");
// The programme page of a DR series, which the collection stores because DR's
// schedule offers nothing better before a broadcast has aired. Finds the
// episode of the day and hands it to the adapter below -- and must sit AHEAD
// of it, because dr-lyd-archive's own pattern would take the programme page
// too and then refuse it. See dr-lyd-series.js for the seven-day deadline.
const drLydSeries = require("../adapters/dr-lyd-series");
// One adapter for the whole of DR LYD, ahead of dr-p2 and dr-p8-jazz: an
// episode address sits below the station path those two claim.
const drLydArchive = require("../adapters/dr-lyd-archive");
// Likewise for the whole of Radio France, ahead of france-inter and
// france-musique.
const radiofranceArchive = require("../adapters/radiofrance-archive");
// And for VRT MAX, ahead of klara. The only adapter here that needs an
// account: VRT releases broadcasts to signed-in users only, credentials in
// apps/autoplay-pi/.env, see adapters/_vrt-session.js.
const vrtArchive = require("../adapters/vrt-archive");
// And for Polskie Radio, ahead of polskie-radio-2: an episode address sits
// below the station path that one claims.
const polskieradioArchive = require("../adapters/polskieradio-archive");
// The series page of a Dwojka programme, which the collection stores because
// the schedule gives it nothing better. Finds the edition of the day and hands
// it to the adapter above. See polskieradio-series.js for why this cannot
// happen during collection.
const polskieradioSeries = require("../adapters/polskieradio-series");
// And for NRK, ahead of nrk-p2. psapi answers to the programme id that
// stands at the end of an episode address, for every NRK channel.
const nrkArchive = require("../adapters/nrk-archive");
// And for radio3 (rbb), ahead of the station adapter: an archive page sits
// on the same domain that one claims. The ARD Audiothek stays the richer
// route where it has the broadcast -- this one takes the address the
// station itself shows.
const rbbArchive = require("../adapters/rbb-archive");
// And for RaiPlay Sound, ahead of rai-radio3. The address form belongs to
// the platform, not to a station: the same adapter serves every Rai radio.
const raiplaysoundArchive = require("../adapters/raiplaysound-archive");
// Likewise for RaiPlay Sound: /programmi/<slug> is the programme, the
// editions hang underneath it with the date in the file name.
const raiplaysoundSeries = require("../adapters/raiplaysound-series");
// And for RTVE, ahead of rne-radio-3 and rne-radio-clasica. The number at
// the end of the address is the key for the whole house, in all three of
// its address forms. This one excludes the RNE live pages itself -- they
// have the shape of a broadcast page, see the trap noted in the adapter.
const rtveArchive = require("../adapters/rtve-archive");
// And the series pages RTVE parks above those recordings. The konzert-guide
// stores the series, not the night; this reads the night out of it and hands
// the edition to rtveArchive. See _series-page-resolver.js for why the date
// arrives as a URL fragment.
const rtveSeries = require("../adapters/rtve-series");
// And for RTE, ahead of rte-2fm and rte-lyric-fm. The uuid at the end of an
// episode address is the key for the whole house; the recordings themselves
// sit on Omny Studio, not on rte.ie.
const rteArchive = require("../adapters/rte-archive");
// And the strand pages above those recordings. RTE's episode slugs are
// editorial and cannot be worked out from a date -- konzert-guide/COMMANDS.md
// records that finding -- so the strand page is looked up and the night read
// off it. Only lyric fm: 2fm's "Sessions" are DJ sets, not concerts.
const rteSeries = require("../adapters/rte-series");
// And for SRF, ahead of srf2. A broadcast address has two path parts after
// /audio/, the livestream page only one -- that is the whole separation.
const srfArchive = require("../adapters/srf-archive");
// And the SRF station page, which the collection stores whenever SRF has not
// yet filled in the episode -- most of a week, since the guide collects on
// Monday for the week ahead. Looks the slot up in the EPG and hands the edition
// to srfArchive above. Ahead of the srf2 station adapter, which would answer a
// station page with the livestream; behind srfArchive, whose two-path-part rule
// already keeps the two apart. See srf-epg.js.
const srfEpg = require("../adapters/srf-epg");
// And for Sveriges Radio, ahead of srp2. Talks only to api.sr.se: the
// website itself answers a plain fetch with 403 from Akamai's edge.
const srArchive = require("../adapters/sr-archive");
// And for Cashmere Radio, ahead of the station module below: the episode
// pages sit under the domain that one claims. The recordings are on
// Mixcloud and the episode page names that address twice, so this adapter
// needs no browser of its own -- see cashmere-archive.js.
const cashmereArchive = require("../adapters/cashmere-archive");
const brKlassik = require("../adapters/radiostations/br-klassik");
const wdr3 = require("../adapters/radiostations/wdr3");
const swrKultur = require("../adapters/radiostations/swr-kultur");
const hr2 = require("../adapters/radiostations/hr2");
const radio3 = require("../adapters/radiostations/radio3");
// rbb Radio 1, added 03.09.2026. Claims only radioeins.de; its archive
// entries carry ARD Sounds addresses, which ardAudiothek above takes.
const radioeins = require("../adapters/radiostations/radioeins");
const deutschlandfunk = require("../adapters/radiostations/deutschlandfunk");
const deutschlandfunkKultur = require("../adapters/radiostations/deutschlandfunk-kultur");
const franceMusique = require("../adapters/radiostations/france-musique");
const franceInter = require("../adapters/radiostations/france-inter");
// BBC Radio 3 dropped on 12.08.2026: the mediaselector refuses even the
// live stream now, listening back is restricted to the United Kingdom, and
// Roon plays the station by itself -- so there was nothing left the adapter
// could do better.
const oe1 = require("../adapters/radiostations/oe1");
const srf2 = require("../adapters/radiostations/srf2");
const srp2 = require("../adapters/radiostations/srp2");
const concertzender = require("../adapters/radiostations/concertzender");
const worldOfJazz = require("../adapters/radiostations/world-of-jazz");
const nrkP2 = require("../adapters/radiostations/nrk-p2");
// NRK Klassisk and NRK Jazz, 10.09.2026. The guide asked NRK's EPG for p2
// alone until that day, and its concert strands are on the sister channels.
const nrkKlassisk = require("../adapters/radiostations/nrk-klassisk");
const nrkJazz = require("../adapters/radiostations/nrk-jazz");
const raiRadio3 = require("../adapters/radiostations/rai-radio3");
const raiRadio3Classica = require("../adapters/radiostations/rai-radio3-classica");
const rneRadio3 = require("../adapters/radiostations/rne-radio-3");
const rneRadioClasica = require("../adapters/radiostations/rne-radio-clasica");
const rteLyricFm = require("../adapters/radiostations/rte-lyric-fm");
const rte2fm = require("../adapters/radiostations/rte-2fm");
const drP2 = require("../adapters/radiostations/dr-p2");
const drP8Jazz = require("../adapters/radiostations/dr-p8-jazz");
const polskieRadio2 = require("../adapters/radiostations/polskie-radio-2");
const klara = require("../adapters/radiostations/klara");
const wxdu = require("../adapters/radiostations/wxdu");
const cashmereRadio = require("../adapters/radiostations/cashmere-radio");
// Last of all, see adapters/direct-audio.js: it checks nothing but the
// file extension and must therefore only get its turn once no real adapter
// wanted the URL.
const directAudio = require("../adapters/direct-audio");
// Not an adapter: the clock. Reads the start time and the length out of the
// URL fragment the app appends before sharing. See adapters/_on-air.js.
const { airtimeOf } = require("../adapters/_on-air");

const ADAPTERS = [
  nts, mk, wire, bandcamp, soundcloud, archiveOrg, mixcloud, ardAudiothek, rbbArchive, ardProgramme, deutschlandradio, deutschlandradioProgramme, oe1Archive, concertzenderArchive, drLydSeries, drLydArchive, radiofranceArchive, vrtArchive, polskieradioArchive, polskieradioSeries, nrkArchive, raiplaysoundArchive, raiplaysoundSeries, rtveArchive, rtveSeries, rteArchive, rteSeries, srfArchive, srfEpg, srArchive, cashmereArchive,
  brKlassik, wdr3, swrKultur, hr2, radio3, radioeins,
  deutschlandfunk, deutschlandfunkKultur,
  franceMusique, franceInter, oe1, srf2,
  srp2, concertzender, worldOfJazz, nrkP2,
  raiRadio3, raiRadio3Classica, rneRadio3, rneRadioClasica, rteLyricFm, rte2fm,
  nrkKlassisk, nrkJazz,
  drP2, drP8Jazz, polskieRadio2, klara,
  wxdu, cashmereRadio,
  directAudio,
];

/* The guide's station ids, and the adapter that holds each station's
 * livestream. All 27 rows, including the three that are deliberately empty --
 * a table with a gap in it says "checked and none", a table with a row missing
 * says nothing at all.
 *
 * Why a table and not a rule: two houses publish two stations each under one
 * address shape. RNE Radio Clasica and RNE Radio 3 both at
 * rtve.es/play/audios/<slug>, Rai Radio 3 and Rai Radio 3 Classica both at
 * raiplaysound.it/programmi/<slug>, and in both cases the slug is the
 * programme name with nothing in it that marks the station. Measured against
 * the snapshot of 26.08.2026, matching by address found the station for 11 of
 * 21; widening the regexes would have reached 16 and could never have reached
 * those two.
 *
 * The two sides never agreed on spelling and this is where that is paid for
 * once: `rne_radio2` is Radio Clasica (not Radio 3), `rte_lyric` against
 * rte-lyric-fm, `rbb3` against radio3, underscores here and hyphens there.
 */
const STATION_BY_ID = new Map([
  ["br-klassik", brKlassik],
  ["concertzender", concertzender],
  ["deutschlandfunk", deutschlandfunk],
  ["deutschlandfunk-kultur", deutschlandfunkKultur],
  ["dr-p2", drP2],
  ["dr-p8-jazz", drP8Jazz],
  ["france-inter", franceInter],
  ["france-musique", franceMusique],
  ["hr2", hr2],
  ["klara", klara],
  ["nrk_p2", nrkP2],
  ["nrk_klassisk", nrkKlassisk],
  ["nrk_jazz", nrkJazz],
  ["oe1", oe1],
  ["polskie_radio_2", polskieRadio2],
  ["rai_radio3", raiRadio3],
  ["rbb3", radio3],
  ["radioeins", radioeins],
  // Radio Clasica, despite the name. The guide has called it this since the
  // beginning and renaming it would break every archived schedule.
  ["rne_radio2", rneRadioClasica],
  ["rne_radio3", rneRadio3],
  ["rte_2fm", rte2fm],
  ["rte_lyric", rteLyricFm],
  ["srf2", srf2],
  ["srp2", srp2],
  ["swr-kultur", swrKultur],
  ["wdr3", wdr3],
  ["world_of_jazz", worldOfJazz],
  // No adapter here, and not an oversight. BBC Radio 3 and 6 Music were
  // dropped on 12.08.2026 -- the mediaselector refuses even the livestream now
  // and Roon plays the stations by itself. YLE never had one.
  //
  // 30 rows since NRK Klassisk and NRK Jazz joined on 10.09.2026.
  ["bbc_radio3", null],
  ["bbc_6music", null],
  ["yle_radio_1", null],
]);

// A wrong module in the table would be silent otherwise: the station would
// simply never answer live, and nobody would look. Loud at startup instead.
for (const [id, station] of STATION_BY_ID) {
  if (station && typeof station.live !== "function") {
    throw new Error("dispatch: station '" + id + "' has no live() -- check STATION_BY_ID");
  }
}

/* Every station's own livestream address, asked of the station itself.
 *
 * WHY THIS EXISTS (07.09.2026). `probe.live` was set from `sourceType ===
 * "live"`, and no station adapter writes that: `deutschlandfunk-kultur.live()`
 * answers `sourceType: "deutschlandfunk-kultur"`. So ten DLF Kultur entries of
 * the first real run resolved to the livestream, were probed, answered 200 --
 * a livestream always does -- and were written down as archive recordings. The
 * summary printed `live 0`. The counter put there to stop the record
 * flattering itself flattered it in exactly its own number.
 *
 * An address is a fact and a `sourceType` is a label, so this asks the fact.
 * Not a pattern either: guessing what a livestream address looks like would
 * miss the ones that end in .mp3 and would condemn archive recordings that
 * happen to sit under /stream/. Each station adapter holds its own live
 * address as a constant; `live()` is what hands it over, and it is already
 * called for every on-air share.
 *
 * Keyed by origin and path. The query is an aggregator tag -- DLF appends
 * `?aggregator=web` -- and two spellings of one stream are one stream.
 *
 * Built once and kept. Twenty-seven adapters, a handful of which fetch, and
 * the answer does not change while the process lives.
 */
let liveKeys = null;

function addressKey(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.origin + parsed.pathname;
  } catch (e) {
    return String(url || "");
  }
}

async function liveAddresses() {
  if (liveKeys) return liveKeys;
  const found = new Set();
  for (const [, station] of STATION_BY_ID) {
    if (!station || typeof station.live !== "function") continue;
    try {
      const answer = await station.live();
      const tracks = (answer && answer.tracks) || [];
      for (const track of tracks) {
        if (track && track.streamUrl) found.add(addressKey(track.streamUrl));
      }
    } catch (e) {
      // A station that cannot say what its livestream is today simply does not
      // contribute one. Refusing to answer at all would turn a missing witness
      // into no witnesses.
    }
  }
  liveKeys = found;
  return liveKeys;
}

/// Whether this address IS a station's livestream. `false` until
/// `liveAddresses()` has been awaited once -- callers that care do that at
/// startup, and a caller that does not is no worse off than before.
function isLiveAddress(url) {
  return !!liveKeys && liveKeys.has(addressKey(url));
}

/* What the adapters WERE when a question was answered.
 *
 * WHY (Roger, 08.09.2026). The nightly file never asks a settled row again --
 * right towards the stations, and wrong the moment our own side changes. The
 * ARD Nachtkonzert was fixed that evening and the stored rows went on carrying
 * a four-minute piece about the series, because "ok, reachable" means done
 * with. Somebody then has to remember to go and delete them, which is exactly
 * the kind of memory the record exists to replace.
 *
 * So a row records this, and a row whose fingerprint no longer matches is not
 * settled. No discipline required: it is the content of the files, so it
 * changes when they change and never when they do not.
 *
 * ALL the adapters, in one hash, and that is a deliberate coarseness. What an
 * adapter answers depends on its own file AND on the shared ones underneath --
 * `_archive-match.js` decided today's Nachtkonzert as much as
 * `ard-programme.js` did -- and there is no honest way to say which of them a
 * given row leaned on. The price is that any adapter change makes every row in
 * the seven-day window worth asking again: about a week's entries, once. A
 * finer rule that missed a shared change would be cheaper and wrong.
 *
 * Computed on first use, not at load: server.js requires this file too and has
 * no business reading the adapter directory to start up.
 */
let adapterHash = null;

function adaptersVersion() {
  if (adapterHash) return adapterHash;
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const root = path.join(__dirname, "..", "adapters");
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".js")) files.push(full);
    }
  })(root);
  const sum = crypto.createHash("sha256");
  for (const file of files) {
    // The name as well as the content: a file renamed is a change, and two
    // files that swap contents are not the same set as before.
    sum.update(path.relative(root, file));
    sum.update(fs.readFileSync(file));
  }
  adapterHash = sum.digest("hex").slice(0, 12);
  return adapterHash;
}

/* Which adapter fits this address -- and, since 02.09.2026, at what time.
 *
 * Roger's third case, the one that never worked. A broadcast has three states
 * and they are not three addresses, they are one address and a clock: not yet
 * (nothing to play), over (the recording, if the station kept one), and ON AIR
 * -- where the answer is the station's livestream and nothing else. The app
 * has been promising exactly that since 18.08.2026, in
 * StreamAuxHandoff.swift: "On air. StreamAux puts the livestream into a Roon
 * zone." It then handed over the ordinary broadcast address, an archive
 * adapter went looking for the recording of a concert that was still being
 * played, found none and refused. Correctly, and uselessly. All 27 stations.
 *
 * It belongs HERE and not in the adapters, because here is the one place
 * everything passes through: three call sites in server.js, extract.js,
 * resolve-week.js, try-adapter.js. Putting the clock in each adapter would
 * have meant writing the same rule twenty-six times and getting it wrong in
 * one of them.
 *
 * The station comes from kgs= in the fragment, through the table above. Where
 * the share carries no kgs -- an app older than 02.09.2026 -- it falls back to
 * the station adapters themselves: a broadcast page often sits below the path
 * a station's live page already claims (dr.dk/lyd/p8jazz/paa-scenen/... belongs
 * to dr-p8-jazz), and the five stations where it does not now carry a
 * broadcastRe saying where their programme pages live. That fallback reaches
 * every station but the two RNE ones, which cannot be told apart by address --
 * see the note in rne-radio-3.js.
 *
 * What is NOT used either way is the station adapter's extract(): that one
 * guards against exactly this address, and rightly so, because a programme
 * page is not the livestream page. live() is the same answer without that
 * gate, and it exists on all twenty-six.
 *
 * The weekly resolver run is untouched by this. It walks a week that has been
 * broadcast, so every start time it carries lies in the past.
 */
function detectAdapter(url, nowMs) {
  // null means "no clock": never on air, always the archive adapter. The
  // weekly resolver run passes it. Without it the run would hit a real edge --
  // it starts Sunday 22:00 over a week that ends Sunday night, so the handful
  // of concerts playing WHILE it runs would be recorded as livestreams. That
  // run exists to measure archives; a livestream is always reachable and
  // therefore says nothing.
  const air = nowMs === null ? null : airtimeOf(url, nowMs);
  if (air && air.onAir) {
    const station =
      (air.stationId ? STATION_BY_ID.get(air.stationId) : null) ||
      ADAPTERS.find((a) => typeof a.live === "function" &&
        ((a.broadcastRe && a.broadcastRe.test(url)) || a.match(url)));
    if (station) {
      return {
        match: station.match,
        extract: () => Promise.resolve(station.live()),
        // So a caller can say why it got a livestream rather than a recording.
        // resolve-week.js writes down which adapter claimed an address, and
        // "the livestream, because it was on air" is a different fact from
        // "the station adapter matched". `station` is the module itself, which
        // is how that run puts a name to an adapter -- by identity, not by a
        // field the object could get wrong.
        onAir: air,
        station: station,
      };
    }
    // No station adapter: an address from outside the guide, or one of the
    // three stations that have none. Falls through -- the ordinary adapter is
    // still the best answer available.
  }
  return ADAPTERS.find((a) => a.match(url)) || null;
}

module.exports = { detectAdapter, liveAddresses, isLiveAddress, adaptersVersion };
