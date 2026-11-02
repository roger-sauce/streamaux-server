# roon-trigger - kleine Roon-Extension (node-roon-api), keine Audio-Hardware
# noetig (nur Netzwerk/API), daher kein ALSA-Device-Zugriff wie bei
# mk-autoplay-pi.
FROM node:20-alpine
WORKDIR /app
RUN apk update && apk upgrade --no-cache && apk add --no-cache git
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
# /data ist das Arbeitsverzeichnis zur Laufzeit: node-roon-api legt seine
# config.json (Pairing-Token) im aktuellen Verzeichnis ab. Ohne diesen
# Umweg landete sie in /app, also im Container -- und war nach jedem
# Rebuild weg, sodass die Extension in Roon jedes Mal neu freigegeben
# werden musste. Gleiches Muster wie in discogs-roon/Dockerfile.
RUN mkdir /data && chown -R node:node /app /data
USER node
EXPOSE 4000
ENV PORT=4000
WORKDIR /data
CMD ["node", "/app/server.js"]
