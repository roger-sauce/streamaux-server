# roon-trigger

Kleine Roon-Extension, die die feste "My Live Radio"-Station **"Audio
Entrypoint (roon-bridge)"** per HTTP-Aufruf in einer ausgewählten Zone
startet. Wird vom Resolver automatisch mit kurzer Verzögerung nach dem Start der
ffmpeg-Wiedergabe aufgerufen - ersetzt das manuelle Suchen/Starten der
Station in der Roon-Remote-App.

Technischer Hintergrund: die offizielle Roon-API hat keinen direkten
"play this internet radio station"-Aufruf. Der Weg ist, über die
Browse-API die `internet_radio`-Hierarchie (= "My Live Radio") zu laden,
den Eintrag per Titel zu finden, und dann `browse()` erneut mit
`item_key` + `zone_or_output_id` aufzurufen - das startet die Wiedergabe.
Nachgebaut nach dem Vorbild von
[roon-extension-radio-presets-api](https://github.com/imgrant/roon-extension-radio-presets-api).

## API

- `GET /api/zones` - Liste der aktuell verfügbaren Roon-Zonen (`{id, name}`).
- `POST /api/play-station` `{ "zone": "<Zonenname oder Zone-ID>" }` -
  startet die Station in der Zone.

## Einmalige Einrichtung

1. Deployen und starten (siehe unten).
2. In Roon: ☰ → Settings → Extensions → bei "Roon Trigger (mk-autoplay-pi)"
   auf **Enable** klicken (einmalig, wie bei Entrypoint Gateway/Audio
   Entrypoint - lässt sich wegen Roons Pairing-Protokoll nicht
   automatisieren).
3. Kurzer Test: `curl http://localhost:4000/api/zones | jq` sollte die Zonen
   zeigen, sobald gepairt ist.

**Hinweis:** ob das Pairing einen `docker compose up -d --build` überlebt,
ist noch nicht getestet (Token-Persistenz ist in diesem Docker-Setup nicht
extra als Volume gemountet). Falls nach einem Rebuild die Extension in
Roon wieder als "nicht freigegeben" erscheint, einfach erneut auf
**Enable** klicken.

## Deployment auf dem Pi

Siehe das README im Wurzelverzeichnis. Kurz:

```bash
cd apps/roon-trigger
mkdir -p roon-config && sudo chown -R 1000:1000 roon-config
docker compose up -d --build
```

## Konfiguration

- `ROON_STATION_NAME` (Default `Audio Entrypoint (roon-bridge)`) - exakter
  Titel des "My Live Radio"-Eintrags.
- `PORT` (Default `4000`).
