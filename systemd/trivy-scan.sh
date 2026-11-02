#!/usr/bin/env bash
# Checks every image a RUNNING container uses for known vulnerabilities.
# Purely informative: nothing is blocked, nothing is updated automatically.
#
# The twin of /usr/local/sbin/trivy-scan.sh on extern, which has run since
# 04.08.2026. Same logic, two differences worth knowing before diffing them:
# that one is written in German, and it skips /opt/camoufox where this one
# skips /ms-playwright -- see the loop below.
#
# WHY IT LIVES IN THE REPOSITORY. On extern the script sits only in
# /usr/local/sbin, and so does the monthly maintenance -- which spent
# September and October dying on a stray space after a line continuation
# without anyone being able to see a diff. A file that runs unattended
# belongs where a change to it is a commit. roon-bridge reaches it through a
# symlink, the way the systemd units beside it already do:
#
#   sudo ln -s /home/roger/autoplay-orchestrator/systemd/trivy-scan.sh \
#              /usr/local/sbin/trivy-scan.sh
#
# The price of that symlink is the one already paid for the units: a git
# checkout or stash in ~/autoplay-orchestrator silently changes what runs.
#
# WHAT TO READ IN THE OUTPUT. The CHANGE, not the absolute number. Base
# images routinely carry two-digit HIGH counts, mostly in libraries this code
# never calls. A number that jumps, or a finding in something that actually
# faces the network, is the signal.
#
#   trivy-scan.sh        by hand after a deploy
#                        and from the monthly maintenance

set -uo pipefail

# /tmp is a tmpfs of about 1.9 GB on Debian Trixie. Trivy unpacks the layers
# of the image under test there, and for Java artefacts pulls a database of
# its own. On extern the 1.2 GB NPM and then the 5 GB sidecar both ran it
# dry -- "no space left on device", and only after minutes. Here the heavy
# one is autoplay-pi with its ARM Chromium. So: the real filesystem.
export TMPDIR=/var/tmp/trivy
mkdir -p "$TMPDIR"

BASE=/home/roger/trivy-reports
OUT="$BASE/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$OUT"

# Packages left out of the HEADLINE FIGURE -- the reports still list them in
# full.
#
# linux-libc-dev is kernel headers: text files for compiling C programs. In a
# container that compiles nothing they are not executable code. On extern they
# made up 180 of the Nginx Proxy Manager's 291 HIGH and would have buried
# every change that matters.
IGNORE='["linux-libc-dev"]'

# Last run's figures, read BEFORE latest.env is overwritten.
PREV_HIGH=""
PREV_CRIT=""
if [ -f "$BASE/latest.env" ]; then
  PREV_HIGH=$(grep '^TRIVY_HIGH='     "$BASE/latest.env" | cut -d= -f2)
  PREV_CRIT=$(grep '^TRIVY_CRITICAL=' "$BASE/latest.env" | cut -d= -f2)
fi

HIGH=0
CRIT=0
IGNORIERT=0
FEHLER=0

echo "=== Trivy scan $(date -Is) ==="
printf "%-38s %6s %6s %10s\n" "IMAGE" "HIGH" "CRIT" "skipped"

for img in $(docker ps --format '{{.Image}}' | sort -u); do
  safe=$(echo "$img" | tr '/:' '__')
  # --timeout 45m: the default five minutes is nowhere near enough for a
  #   multi-gigabyte image on an SD card.
  # --skip-dirs /ms-playwright: an unpacked Chromium lives there, put in by
  #   "playwright install" in apps/autoplay-pi/Dockerfile. Trivy walks it for
  #   minutes and finds nothing -- it recognises operating-system packages and
  #   dependencies of package managers, and a browser dropped in as a binary
  #   is neither. Chromium's own currency rides on the base image, which the
  #   monthly rebuild pulls.
  if ! trivy image --quiet --scanners vuln --severity HIGH,CRITICAL \
         --timeout 45m --skip-dirs /ms-playwright \
         --format json --output "$OUT/$safe.json" "$img" 2>"$OUT/$safe.err"; then
    printf "%-38s %6s %6s %10s\n" "$img" "FEHLER" "-" "-"
    FEHLER=$((FEHLER + 1))
    continue
  fi
  rm -f "$OUT/$safe.err"

  h=$(jq --argjson ign "$IGNORE" '[.Results[]?.Vulnerabilities[]? | select(.Severity=="HIGH")     | select(.PkgName as $p | ($ign | index($p)) | not)] | length' "$OUT/$safe.json")
  c=$(jq --argjson ign "$IGNORE" '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL") | select(.PkgName as $p | ($ign | index($p)) | not)] | length' "$OUT/$safe.json")
  ig=$(jq --argjson ign "$IGNORE" '[.Results[]?.Vulnerabilities[]? | select(.PkgName as $p | ($ign | index($p)))] | length' "$OUT/$safe.json")

  printf "%-38s %6s %6s %10s\n" "$img" "$h" "$c" "$ig"
  HIGH=$((HIGH + h))
  CRIT=$((CRIT + c))
  IGNORIERT=$((IGNORIERT + ig))

  # A readable version out of the SAME scan -- no second pass. Deliberately
  # holds everything, the skipped packages included.
  trivy convert --quiet --format table --output "$OUT/$safe.txt" "$OUT/$safe.json" 2>/dev/null || true
done

# Against the previous run. The first time there is nothing to compare with.
delta() {
  local jetzt=$1 vorher=$2 d
  if [ -z "$vorher" ]; then echo "erster Lauf"; return; fi
  d=$((jetzt - vorher))
  if   [ "$d" -gt 0 ]; then echo "+$d"
  elif [ "$d" -lt 0 ]; then echo "$d"
  else echo "=0"; fi
}
D_HIGH=$(delta "$HIGH" "$PREV_HIGH")
D_CRIT=$(delta "$CRIT" "$PREV_CRIT")

echo
echo "Summe: HIGH $HIGH ($D_HIGH), CRITICAL $CRIT ($D_CRIT)"
echo "Nicht gezaehlt: $IGNORIERT Funde in $(echo "$IGNORE" | tr -d '[]\"')"
[ "$FEHLER" -gt 0 ] && echo "ACHTUNG: $FEHLER Image(s) konnten nicht geprueft werden, siehe *.err"
echo "Berichte: $OUT"

# For the monthly maintenance to read, with the SOURCE command -- which is
# why the two deltas are quoted and the numbers are not. On the first run
# delta() answers "erster Lauf", two words: written bare, sourcing the file
# tries to run "Lauf" as a command. It never bit on extern because the first
# run there was in August and the file has held numbers ever since, which is
# the kind of fault that waits for a fresh machine. This one is fresh.
{
  echo "TRIVY_HIGH=$HIGH"
  echo "TRIVY_CRITICAL=$CRIT"
  echo "TRIVY_D_HIGH=\"$D_HIGH\""
  echo "TRIVY_D_CRITICAL=\"$D_CRIT\""
  echo "TRIVY_IGNORIERT=$IGNORIERT"
  echo "TRIVY_FEHLER=$FEHLER"
  echo "TRIVY_DIR=\"$OUT\""
} > "$BASE/latest.env"

# Keep the last three runs. "+4" means: from the fourth onwards, delete.
ls -1dt "$BASE"/20* 2>/dev/null | tail -n +4 | xargs -r rm -rf

# Give the scratch space back -- gigabytes, with an image of this size.
rm -rf "${TMPDIR:?}"/*

# So the reports can be read without sudo.
chown -R roger:roger "$BASE"
