"use strict";

/* Is this broadcast on the air right now?
 *
 * WHY IT EXISTS. The guide's three ways to a broadcast are not three code
 * paths -- they are three answers to the same address, and only the clock
 * tells them apart. Over: the recording, if the station kept one. Not yet:
 * nothing to play. On air: the LIVESTREAM, and until 02.09.2026 that third
 * answer did not exist anywhere. StreamAuxHandoff.swift promised it -- "On
 * air. StreamAux puts the livestream into a Roon zone" -- and then handed over
 * the same broadcast address as in every other case. The archive adapter went
 * looking for a recording of a concert that was still being played, found
 * none, and refused. Correctly, and uselessly. All 27 stations.
 *
 * WHAT IT READS. The fragment the app appends before sharing:
 *
 *   #kg=<startTime ISO8601>&kgt=<title>&kgd=<durationMin>&kgs=<stationId>
 *
 * kg, kgd and kgs are the three this file needs. See kg-url.js and Handoff.url() in
 * the app -- the same fragment, written in two places because the app cannot
 * call into this one.
 *
 * THE WINDOW (Roger, 02.09.2026). From five minutes before the start until the
 * end. Five minutes because someone who reaches for the button at 19:58 for a
 * 20:00 concert means the concert, and a refusal there would be pedantry. Not
 * a minute longer than that at the front, and not generous at the back either
 * where the length is known: past the end the recording is the right answer,
 * and handing out a livestream instead would be wrong SILENTLY -- the stream
 * plays, it is simply not what was asked for. A refusal is visible and can be
 * tried again; a wrong stream is not.
 *
 * WHERE THE LENGTH IS MISSING it falls back to three hours, and that is the
 * one guessed number here. Roger's reasoning, and it is the right one: the
 * length is not a stop signal. The listener switches off when the concert
 * ends, earlier if it disappoints, or leaves it running because the programme
 * after it sounds good too. What the number has to protect is the OTHER case
 * -- a concert of this morning, opened in the guide at noon, must reach its
 * recording and not the livestream. Three hours draws that line without
 * cutting into a long concert.
 *
 * The fallback is meant to shrink. Every station that starts reporting a
 * length takes entries out of it. France Musique was 65 of 65 without one on
 * 01.09.2026; since the resolver reads podcastEpisode.duration, that is a
 * question with an answer.
 */

// Someone reaching for the button just before the hour means the concert.
const LEAD_MS = 5 * 60 * 1000;

// Only where the collection reported no length. See above.
const ASSUMED_LENGTH_MS = 3 * 60 * 60 * 1000;

// The fragment as the app writes it. A base address may carry a fragment of
// its own, in which case the app appends with "&" -- so everything after the
// first "#" is read as one parameter list rather than assumed to start with
// kg=.
function fragmentParams(url) {
  const hash = String(url || "").split("#").slice(1).join("#");
  if (!hash) return null;
  try {
    return new URLSearchParams(hash);
  } catch (e) {
    return null;
  }
}

/* What the clock says about this address.
 *
 * Returns null when the address carries no start time at all -- pasted by
 * hand rather than shared, which is the third of Roger's three cases and has
 * no time in it by nature. A found archive address is never "on air".
 */
function airtimeOf(url, nowMs) {
  const params = fragmentParams(url);
  if (!params) return null;

  const startMs = Date.parse(params.get("kg") || "");
  if (!Number.isFinite(startMs)) return null;

  const minutes = Number(params.get("kgd"));
  const lengthKnown = Number.isFinite(minutes) && minutes > 0;
  const endMs = startMs + (lengthKnown ? minutes * 60000 : ASSUMED_LENGTH_MS);

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return {
    // Which station, as the guide knows it. The one exact fact about the
    // identity: several houses publish two stations under one address shape --
    // RNE Radio Clasica and RNE Radio 3 both at rtve.es/play/audios/<slug>,
    // Rai Radio 3 and Rai Radio 3 Classica both at
    // raiplaysound.it/programmi/<slug> -- where the slug is the programme name
    // and nothing marks the station. No rule read off the address separates
    // those, so it has to travel. Added 02.09.2026; null for shares made by an
    // app version older than that.
    stationId: params.get("kgs") || null,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    lengthKnown: lengthKnown,
    onAir: now >= startMs - LEAD_MS && now < endMs,
  };
}

function isOnAir(url, nowMs) {
  const air = airtimeOf(url, nowMs);
  return air !== null && air.onAir;
}

module.exports = { airtimeOf, isOnAir, LEAD_MS, ASSUMED_LENGTH_MS };
