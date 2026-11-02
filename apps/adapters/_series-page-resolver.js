"use strict";

// adapters/_series-page-resolver.js
//
// Factory for the one step the konzert-guide leaves open.
//
// For several stations the guide stores the address of a SERIES -- the page
// listing every edition of "Noches en los jardines" -- while the archive
// adapters need the address of ONE edition. Between the two sits the work
// that has been done by hand until now: open the series page, find the night
// in question, copy its address, paste it.
//
// That step, and only that step, is what this does. It fetches the series
// page, reads the dated episode links out of it, picks the one belonging to
// the broadcast, and hands it to the archive adapter that could always play
// it. No audio is extracted here.
//
// WHICH night is asked of the URL. The konzert-guide app appends the start
// time as a fragment before sharing:
//
//   https://www.rtve.es/play/audios/noches-en-los-jardines/#kg=2026-07-16T18:00:00Z
//
// A fragment never reaches the server, so the same address still opens the
// page in Safari, and nothing about the collection had to change to produce
// it. Without a fragment there is nothing to choose by -- and this then
// refuses rather than handing over last night's concert for Friday's, which
// is the same rule the live adapters were given on 09.08.2026.
//
// Contract (see docs/HANDOFF.md):
//   match(url) => boolean
//   extract(url) => Promise<{ title, sourceType, tracks, tracklist, ... }>

const { fetchHtml, unsupported } = require("./_shared");

const FRAGMENT_RE = /[#&]kg=([^&]+)/i;

function withoutFragment(url) {
  return String(url || "").split("#")[0];
}

// The calendar day the broadcast began on, in the station's OWN country.
//
// Not UTC and not the container's clock: a concert starting at 23:00 in
// Madrid is filed by RTVE under that day, and reading it in UTC would move it
// to the next one for half the year. en-CA is merely the shortest route to
// YYYY-MM-DD -- the same trick br-klassik.js uses for its live test.
function broadcastDay(url, timeZone) {
  const hit = FRAGMENT_RE.exec(String(url || ""));
  if (!hit) return null;
  const when = new Date(decodeURIComponent(hit[1]));
  if (isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

// Both refusals here are the system working, not failing: a series page
// without a date cannot name a night, and a day on which the programme did
// not air has no recording to find. Since 31.08.2026 they say so -- see
// unsupported() in _shared.js -- and carry the archive they looked in, in the
// message for a person and on the error for a caller.

/* WHY a station has no edition for that day, out of the days it does have.
 *
 * Added 17.09.2026. Until then every one of these refusals said the same
 * sentence -- "either the programme did not run that day, or the recording was
 * never put into the archive" -- which is true, useless, and the same for three
 * situations that want three different answers. Measured on the run of that
 * morning, the three were all present at once:
 *
 *   Il Cartellone (Rai)       asked 09-16, newest on offer 09-15, daily
 *                             -> a publisher one day behind. Ask again tomorrow.
 *   La stanza della musica    on offer 09-05, 08-29, 08-22 -- weekly, Fridays;
 *                             asked for a TUESDAY. No amount of asking helps.
 *   Los conciertos de Radio 3 newest on offer 2026-07-17, asked 09-11..09-17,
 *                             while the strand airs four nights a week.
 *                             The archive has stopped. A category of its own --
 *                             see OPEN-TASKS.md.
 *
 * MEASURED AGAINST THE STRAND'S OWN CADENCE and not against a fixed number of
 * days, which is the correction Roger made the same afternoon. A weekly strand
 * whose newest edition is seven days old is perfectly normal; a daily one's is
 * a week behind. The cadence is in the list itself -- the median gap between
 * consecutive editions -- so this costs no request at all.
 *
 * Nothing here waits. The verdict is read off what the station offers TODAY,
 * so "no archive" needs no month of asking to establish; the station says it in
 * one answer.
 */
/* What each verdict says to a person. One sentence, and it must be readable
 * beside the list of days that follows it -- that pair is the whole evidence.
 */
// No full stop at the end of any of them: offered() brings its own, and two in
// a row is the kind of thing a reader notices instead of the sentence.
const SAYS = {
  "not-yet": "The edition is not published yet",
  "did-not-run": "The programme did not run that day",
  "no-archive": "This programme airs, and its archive has stopped -- nothing "
    + "new has been put into it for a long time",
  unknown: "Its page offers no editions at all, which may mean the programme "
    + "publishes none or that the page could not be read",
};

/// The sentence for a verdict, so every resolver says the same thing about the
/// same situation. Exported since 17.09.2026, when Dwojka joined.
function saysOf(declined) {
  // eslint-disable-next-line security/detect-object-injection
  return SAYS[declined] || SAYS.unknown;
}

function medianGap(days) {
  const gaps = [];
  for (let i = 0; i + 1 < days.length; i++) {
    gaps.push(Math.round((Date.parse(days[i]) - Date.parse(days[i + 1])) / 86400000));
  }
  const usable = gaps.filter(function (gap) { return gap > 0; }).sort(function (a, b) { return a - b; });
  if (!usable.length) return 1;
  return usable[Math.floor(usable.length / 2)];
}

// The weekdays the strand actually uses, where there are enough editions to
// say. Four is the smallest number that can show a weekly pattern twice over.
const WEEKDAY_EVIDENCE = 4;

function weekdaysOf(days) {
  return new Set(days.map(function (day) { return new Date(day + "T12:00:00Z").getUTCDay(); }));
}

/* The verdict, and whether it is worth asking again.
 *
 * `days` are the days the series page offers, newest first; `wanted` is the day
 * asked for. Returns { declined, retryable } -- our own word out of a closed
 * set, beside the station's own words in `blockReason`.
 */
function declineOf(days, wanted) {
  const offered = [...new Set(days.filter(Boolean))].sort().reverse();
  if (!offered.length) {
    // An empty list and a page we failed to read look exactly alike from here,
    // so this claims nothing and keeps asking. Muzyczna Noc Euroradia has no
    // episode page at all; a parser that broke this morning would present the
    // same silence.
    return { declined: "unknown", retryable: true };
  }

  const newest = offered[0];
  const gap = Math.round((Date.parse(wanted) - Date.parse(newest)) / 86400000);

  // An edition AFTER the day asked for: the strand is alive and that day
  // simply had none. Asking again cannot change a day that is already past
  // and already overtaken.
  if (gap <= 0) return { declined: "did-not-run", retryable: false };

  // A strand that uses one weekday, asked for another. Four editions or more,
  // or this would file a fortnightly programme by its first two Fridays.
  if (offered.length >= WEEKDAY_EVIDENCE) {
    const used = weekdaysOf(offered);
    const askedOn = new Date(wanted + "T12:00:00Z").getUTCDay();
    if (used.size <= 2 && !used.has(askedOn)) {
      return { declined: "did-not-run", retryable: false };
    }
  }

  const cadence = medianGap(offered);

  // Within its own rhythm, give or take: the next edition is simply not there
  // yet. Half a cadence of slack, and never less than two days.
  if (gap <= Math.max(2, Math.round(cadence * 1.5))) {
    return { declined: "not-yet", retryable: true };
  }

  // Over a month AND several cadences behind: the archive has stopped. Both
  // conditions, because a monthly strand three months behind is three editions
  // behind, while a daily one two months behind is sixty.
  if (gap > 28 && gap > cadence * 4) {
    return { declined: "no-archive", retryable: false };
  }

  return { declined: "did-not-run", retryable: false };
}

/* What the series page DID offer, said in the refusal itself.
 *
 * Added 16.09.2026 to answer a question this file cannot answer about itself.
 *
 * The three resolvers built on it compare an edition's OWN date with the day
 * asked for, and whether that is right depends on something none of us has
 * measured: what a station does when it repeats an older programme. DR asks
 * its schedule -- "what ran that day" -- and finds a repeat by construction.
 * These ask a list of editions. If a station re-airs an edition and leaves it
 * filed under the date it was made, the day asked for simply is not in the
 * list, and the refusal above says "the programme did not run that day" about
 * a programme that did.
 *
 * Rather than guess which stations do that, every refusal now carries the days
 * that WERE on offer. A run of refusals whose nearest editions sit a week
 * apart is a strand that did not run; one that names an edition months old
 * beside a slot the schedule insists on is a repeat. Neither reading needs a
 * new probe -- the log will hold the evidence by itself.
 *
 * Three days and no more: the message is read by a person in a list, and the
 * fourth adds nothing the first three have not already shown.
 */
function offered(found) {
  const days = [];
  for (const entry of found || []) {
    if (entry && entry.day && days.indexOf(entry.day) === -1) days.push(entry.day);
  }
  days.sort();
  days.reverse();
  if (!days.length) return ", and its page lists no editions at all";
  return ". The editions on offer are " + days.slice(0, 3).join(", ") +
    (days.length > 3 ? " and " + (days.length - 3) + " older" : "");
}

function createSeriesPageResolver(opts) {
  const id = opts.id;
  const label = opts.label;
  const matchRe = opts.matchRe;
  const timeZone = opts.timeZone;
  // (html, pageUrl, wanted) => [{ url, day, extra? }] with day as
  // "YYYY-MM-DD". Everything station-specific lives in here; the rest of this
  // file is the same for all.
  //
  // May be async, and may use `wanted` -- both since 31.08.2026, both for
  // RTVE. Its editions come from an API that pages twenty at a time, so
  // knowing which day is being looked for is what decides when to stop
  // fetching. The stations that read the page's own markup ignore the third
  // argument and return an array as before; awaiting one costs nothing.
  //
  // `extra` is merged into the result. RTVE's API carries an expirationDate
  // and a geolocalizado flag, and throwing those away here would mean asking
  // the media server later what the station already said.
  const episodesOf = opts.episodesOf;
  // The adapter that plays what this finds. Passed in rather than required
  // here so the pairing stands in one place -- the station file -- and not
  // split between two.
  const archive = opts.archive;

  function match(url) {
    return matchRe.test(withoutFragment(url));
  }

  async function extract(url) {
    if (!match(url)) throw new Error(id + "-resolver: URL does not match: " + url);

    const page = withoutFragment(url);

    const wanted = broadcastDay(url, timeZone);
    if (!wanted) {
      throw unsupported(
        "This is the series page of " + label + ", not one broadcast, and the " +
        "address does not say which date is meant. Share the concert from the " +
        "Konzertfuehrer, which knows it -- or paste the address of the single " +
        "edition. Its archive: " + page,
        page
      );
    }

    const found = await episodesOf(await fetchHtml(page), page, wanted);
    const hits = found.filter(function (entry) { return entry.day === wanted; });

    if (!hits.length) {
      const verdict = declineOf(found.map(function (entry) { return entry.day; }), wanted);
      throw unsupported(
        // Wording corrected on 31.08.2026. It used to say the recordings
        // "drop out of the archive after a few weeks", which was a guess of
        // ours dressed as a statement of the station's: RTVE answers
        // expirationDate: null for these, and says nothing of the sort. And
        // it said "on that page" while RTVE is now read through its API.
        //
        // The common reason by far is the dullest one: the programme did not
        // air that day. Of twenty-one refusals in the RNE week of 24.08.2026,
        // nineteen were slots the guide had invented for days on which the
        // series does not run at all.
        //
        // And the address of the series comes with it. A refusal that names
        // the archive it looked in can be checked by hand in ten seconds;
        // without it the reader has to reconstruct which page was meant.
        label + " has no edition broadcast on " + wanted + ". " +
        saysOf(verdict.declined) + offered(found) + ". Its archive: " + page,
        page,
        /* Our own word for it, beside the station's own in `blockReason`, and
         * `retryable` follows from it rather than being set for every refusal
         * alike. "not-yet" is asked again tomorrow; "did-not-run" and
         * "no-archive" are answers and stay answered. See isSettled in
         * lib/rows.js and declineOf() above.
         */
        { declined: verdict.declined, retryable: verdict.retryable }
      );
    }

    // Two on one day happens -- Rai splits Il Cartellone into parts. The first
    // is the one the page itself puts on top; guessing between them from here
    // would be worse than following the site's own order.
    const result = await archive.extract(hits[0].url);
    // The edition that was found, not the series page that was shared. See
    // server.js: this becomes what the app links to and what the history
    // stores, so a second listen needs no resolving at all.
    return Object.assign({}, result, hits[0].extra || {}, { sourceUrl: hits[0].url });
  }

  return { match, extract };
}

module.exports = { createSeriesPageResolver, broadcastDay, withoutFragment, offered, declineOf, saysOf };
