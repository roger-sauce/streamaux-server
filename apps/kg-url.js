"use strict";

/* The address the KonzertGuide app shares, rebuilt from a schedule entry.
 *
 * A concert's broadcastUrl on its own is not enough. It points at a programme
 * page, and several of those carry a whole series -- the ARD programme pages,
 * RTVE, RTE, RaiPlay Sound. A resolver landing there has no way to know which
 * night is meant, and refuses, correctly. The app therefore appends what it
 * knows before handing the address on:
 *
 *   #kg=<startTime>&kgt=<title>&kgd=<durationMin>&kgs=<stationId>
 *
 * kg is the part a series resolver reads. kgt and kgd exist because
 * ard-programme uses them to tell two editions of the same evening apart, and
 * kgs because while a broadcast is running the answer is the station's
 * livestream -- and for RNE and Rai the address does not say which station.
 *
 * A fragment never reaches a server -- which is the point. It travels inside
 * the share sheet to StreamAux and is read there, so no broadcaster ever sees
 * it, and pasting the bare address by hand loses it. That last part has cost
 * an afternoon of puzzlement once already: pasting drops the fragment, sharing
 * keeps it, and the same concert therefore plays or does not depending on how
 * it arrived.
 *
 * Lives in its own file since 31.08.2026 because check-schedule.js and
 * resolve-week.js both need it and the iOS app is already a second
 * implementation. Two is unavoidable, three would be careless.
 */

function sharedUrl(concert) {
  const base = String((concert && concert.broadcastUrl) || "");
  if (!base) return "";
  const parts = ["kg=" + encodeURIComponent(concert.startTime || "")];
  if (concert.title) parts.push("kgt=" + encodeURIComponent(concert.title));
  if (concert.durationMin) {
    parts.push("kgd=" + encodeURIComponent(String(concert.durationMin)));
  }
  // Which station, as the guide knows it. Only _on-air.js reads it, and only
  // to answer with the right livestream while a broadcast is running: two
  // houses publish two stations each under one address shape, so the address
  // alone cannot say. See adapters/_on-air.js.
  if (concert.stationId) {
    parts.push("kgs=" + encodeURIComponent(String(concert.stationId)));
  }
  return base + (base.includes("#") ? "&" : "#") + parts.join("&");
}

module.exports = { sharedUrl };
