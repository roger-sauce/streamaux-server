#!/usr/bin/env bash
#
# security-scan.sh
#
# Lokaler Open-Source-Security-Scan fuer das autoplay-pi-Docker-Image
# (Trivy, https://github.com/aquasecurity/trivy). Baut das Image lokal
# auf dem Mac (nativ ARM64 - gleiche Architektur wie der Pi, kein
# Cross-Build noetig), scannt es auf bekannte OS-/Library-
# Schwachstellen, und scannt zusaetzlich den Projekt-Quellcode
# (package.json/package-lock.json, Dockerfile, docker-compose.yml) auf
# verwundbare Dependencies und IaC-Fehlkonfigurationen.
#
# Rein informativ - blockiert nichts (kein --exit-code), Reports landen
# unter ./test/ (Projekt-Root). Fuer einen harten Gate-Modus (Abbruch
# bei HIGH/CRITICAL) SCAN_STRICT=1 setzen.
#
# Voraussetzung: trivy lokal installiert (brew install trivy). Ohne
# trivy wird nur der Docker-Build ausgefuehrt, der Scan wird
# uebersprungen.
#
# Ausfuehrung: ./security-scan.sh (aus apps/autoplay-pi/ oder per
# vollem Pfad - der Build-Context ist immer apps/, da das Dockerfile
# ../adapters und ../package.json braucht, siehe docker-compose.yml).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$APPS_DIR/.." && pwd)"
IMG_TAG="autoplay-pi-security-scan:local"
REPORT_DIR="$PROJECT_ROOT/test"
TS=$(date +%Y%m%d-%H%M%S)
SCAN_STRICT="${SCAN_STRICT:-0}"

mkdir -p "$REPORT_DIR"

echo "== 1/3: Baue $IMG_TAG (nativ, Build-Context: $APPS_DIR) =="
docker build \
  -f "$SCRIPT_DIR/Dockerfile" \
  -t "$IMG_TAG" \
  "$APPS_DIR"

if ! command -v trivy >/dev/null 2>&1; then
  echo "WARNUNG: trivy nicht gefunden - Scan wird uebersprungen."
  echo "Nachholen mit: brew install trivy"
  exit 0
fi

EXIT_CODE_ARG=()
if [ "$SCAN_STRICT" = "1" ]; then
  EXIT_CODE_ARG=(--exit-code 1)
  echo "== SCAN_STRICT=1: Lauf bricht bei HIGH/CRITICAL-Funden ab =="
fi

echo "== 2/3: Trivy Image-Scan (HIGH/CRITICAL) =="
trivy image --severity HIGH,CRITICAL "${EXIT_CODE_ARG[@]}" "$IMG_TAG" \
  | tee "$REPORT_DIR/trivy-image-$TS.txt"

echo "== 3/3: Trivy Dateisystem-Scan (Dependencies + IaC-Fehlkonfiguration) =="
trivy fs --severity HIGH,CRITICAL "${EXIT_CODE_ARG[@]}" "$APPS_DIR" \
  | tee "$REPORT_DIR/trivy-fs-$TS.txt"

echo "== Fertig. Reports unter: $REPORT_DIR =="
ls -la "$REPORT_DIR"/*"$TS"*

# Image danach entfernen (belegt sonst unnoetig Platz - Playwright/Chromium
# macht das Image gross). Zum Behalten (z.B. zum Debuggen eines Fehlschlags)
# KEEP_IMAGE=1 setzen.
if [ "${KEEP_IMAGE:-0}" = "1" ]; then
  echo "== KEEP_IMAGE=1: Image bleibt erhalten ($IMG_TAG) =="
else
  echo "== Raeume Image auf: $IMG_TAG =="
  docker rmi -f "$IMG_TAG" >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
fi
