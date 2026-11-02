# autoplay-pi (Multi-Source-Engine) - laeuft direkt auf dem Raspberry Pi
# (roon-bridge). Braucht ffmpeg (Roon-Wiedergabe) UND Playwright/Chromium
# (Stream-Extraktion, z.B. NTS/Wire/Mixcloud) - deshalb Debian-basiertes
# Image statt Alpine wie bei mk-autoplay-pi: Playwrights Chromium-Build
# unterstuetzt kein musl/Alpine zuverlaessig.
#
# node:24-trixie-slim seit dem 11.10.2026, vorher node:20-bookworm-slim.
# Node 20 ist seit dem 30.04.2026 am Ende des Lebenszyklus, auch im
# Sicherheitszweig, und die Basisschicht wird nicht mehr neu gebaut -- ein
# monatlicher Neubau holte dort nichts mehr ab. Gemessen am selben Tag mit
# Trivy, gleiches Dockerfile, nur diese Zeile getauscht:
#
#   node:20-bookworm   Debian 12.13   269 HIGH   13 CRITICAL   20 mit Fix
#   node:24-trixie     Debian 13.7    228 HIGH    1 CRITICAL    3 mit Fix
#
# Die verbleibende CRITICAL ist libxml2 ohne Fix; die drei mit Fix sind npms
# eigenes Buendel. node:22-trixie-slim ergab exakt dieselben Zahlen -- 24
# wurde genommen, weil sein Sicherheitszweig ein Jahr laenger laeuft
# (30.04.2028 statt 30.04.2027).
#
# UNVERAENDERT BLEIBEN DIE 144 FUNDE DER FFMPEG-FAMILIE. Debian hat dieselben
# sechzehn CVEs auch auf Trixie nicht zugemacht. ffmpeg ist der Abspielweg
# und bleibt; die Zahl ist eine Konstante und kein Argument fuer oder gegen
# ein Basis-Image.
#
# WAS DABEI ZU PRUEFEN IST, falls diese Zeile je wieder angefasst wird: mit
# Trixie springt ffmpeg von 5.1.9 auf 7.1.5, zwei Hauptversionen. Betroffen
# sind der spawn-Aufruf in server.js und readSourceFormat(), das die
# Senderformate aus ffmpegs stderr liest -- schreibt ffmpeg die Zeile anders,
# liefert die Funktion still null statt zu scheitern.
FROM node:24-trixie-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg alsa-utils \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# npm@11 statt @latest. Der urspruengliche Grund ist mit node:24 entfallen --
# neuere npm-Majors verlangten Node >=22, das Image war auf node:20 gepinnt.
# Die Pinnung bleibt vorerst stehen, damit der Wechsel des Basis-Images eine
# Aenderung ist und nicht zwei; npm gehoert ohnehin nicht ins Laufzeit-Image
# (die drei verbleibenden Funde mit Fix stecken in seinem Buendel).
RUN npm install -g npm@11 && npm install --omit=dev
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium
COPY adapters/ ./adapters/
COPY autoplay-pi/ ./autoplay-pi/
# Der woechentliche Aufloeselauf (systemd/resolve-week.sh ruft ihn per
# "docker compose exec" hier drin auf). Er braucht dieselben Adapter,
# dasselbe Chromium und dieselben Zugangsdaten wie der Server -- deshalb
# dieses Image und kein zweites. Keine neue Abhaengigkeit.
#
# lib/ seit 10.09.2026: die reinen Helfer der Skripte liegen dort (isoDate,
# endsAt, isSettled, isPlayable ...), und ein Verzeichnis, das nicht mitkommt,
# faellt erst zur Laufzeit auf -- "Cannot find module './lib/rows'" beim ersten
# Aufruf im Container, nicht beim Bauen. Derselbe Fehler wie bei run-daily.js
# im Sammler-Image einen Tag zuvor: eine Liste einzelner Dateien vergisst
# lautlos das Neue.
COPY lib/ ./lib/
# try-adapter.js kam am 02.11.2026 dazu, mit der Veroeffentlichung: es ist
# das Werkzeug, mit dem man sieht, welcher Adapter eine Adresse faengt und
# was er antwortet, und wer das Projekt gerade erst aufgesetzt hat braucht
# es im Container statt auf einem Rechner mit npm install.
COPY resolve-week.js build-archive.js audit-resolved.js retention.js kg-url.js try-adapter.js ./
RUN chown -R node:node /app /ms-playwright
USER node
EXPOSE 3001
ENV PORT=3001
ENV ALSA_DEVICE=hw:0,1
CMD ["node", "autoplay-pi/server.js"]
