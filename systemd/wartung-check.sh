#!/usr/bin/env bash
# Checks that the monthly maintenance script on roon-bridge is intact and
# that the Trivy step is wired into it correctly. Reads only -- it changes
# nothing and runs nothing from the script under test.
#
#   sudo /home/roger/autoplay-orchestrator/systemd/wartung-check.sh
#
# WHY THIS EXISTS. On 06.09. and 04.10.2026 the maintenance died four
# minutes in, at a line continuation with a space after the backslash, and
# the only symptom was a notification that did not arrive. A run that
# nobody watches needs a check that can be run before the run.
#
# What it cannot do: say whether the maintenance WORKS. It parses the file
# and looks for the pieces in the right order. A docker build that fails is
# a different matter, and the run itself is the only thing that shows it.

set -uo pipefail

F="${1:-/usr/local/sbin/monatliche-wartung.sh}"
LINK=/usr/local/sbin/trivy-scan.sh
# Overridable so the check itself can be tested against a broken file.
ENVF="${ENVF:-/home/roger/trivy-reports/latest.env}"

FAIL=0
WARN=0

ok()   { printf "  OK    %s\n" "$1"; }
bad()  { printf "  FEHL  %s\n" "$1"; FAIL=$((FAIL + 1)); }
warn() { printf "  WARN  %s\n" "$1"; WARN=$((WARN + 1)); }

echo "=== Wartungsskript ==="

if [ ! -r "$F" ]; then
  bad "$F nicht lesbar -- mit sudo aufrufen"
  echo
  echo "Ergebnis: $FAIL Fehler, $WARN Warnungen"
  exit 1
fi
ok "$F lesbar"

# 1. Does bash accept the file at all? This is the check that would have
#    caught September.
if bash -n "$F" 2>/tmp/wartung-check.$$; then
  ok "bash -n: Syntax in Ordnung"
else
  bad "bash -n meldet einen Syntaxfehler:"
  sed 's/^/        /' /tmp/wartung-check.$$
fi
rm -f /tmp/wartung-check.$$

# 2. The exact fault from September, by name. A backslash continues a line
#    only as the LAST character; with blanks behind it, it is an ordinary
#    backslash and the list simply ends there. bash -n catches it here
#    because the next line then starts a command -- but in a context where
#    it happens to stay valid, it would not. So: look for it directly.
if grep -nE '\\[[:blank:]]+$' "$F" >/dev/null 2>&1; then
  bad "Zeilenfortsetzung mit Leerzeichen HINTER dem Backslash:"
  grep -nE '\\[[:blank:]]+$' "$F" | sed 's/^/        /'
else
  ok "keine Zeilenfortsetzung mit angehaengten Leerzeichen"
fi

# 3. Windows line endings turn every line continuation into the same fault
#    and are invisible in an editor.
if grep -q $'\r' "$F"; then
  bad "CR-Zeichen im Datei -- Zeilenenden sind CRLF, nicht LF"
else
  ok "Zeilenenden sind LF"
fi

echo
echo "=== Trivy-Schritt ==="

line_of() { grep -n -- "$1" "$F" 2>/dev/null | head -1 | cut -d: -f1; }

L_PRUNE=$(line_of 'builder prune')
L_CALL=$(line_of '/usr/local/sbin/trivy-scan.sh')
L_SRC=$(line_of 'latest.env')
L_NTFY=$(line_of 'ntfy.sh')

if [ -n "$L_CALL" ]; then
  ok "Aufruf von trivy-scan.sh steht in Zeile $L_CALL"
else
  bad "kein Aufruf von /usr/local/sbin/trivy-scan.sh im Skript"
fi

# The call must survive a failing scan, or the notification is lost again --
# exactly the way it was lost in September.
if grep -q 'trivy-scan\.sh[^|]*||' "$F"; then
  ok "Aufruf ist mit || abgesichert, ein Fehlschlag killt den Lauf nicht"
else
  warn "Aufruf ohne ||  -- faellt der Scan aus, bricht die Wartung ab und es kommt keine Nachricht"
fi

# Order: clean up first, so Trivy has the free space; scan before the
# notification, or there is nothing to report.
if [ -n "$L_PRUNE" ] && [ -n "$L_CALL" ] && [ "$L_CALL" -gt "$L_PRUNE" ]; then
  ok "Scan laeuft nach dem Aufraeumen (Zeile $L_PRUNE)"
elif [ -n "$L_CALL" ]; then
  warn "Scan steht VOR dem Aufraeumen -- weniger freier Platz fuer das Entpacken"
fi

if [ -n "$L_NTFY" ] && [ -n "$L_CALL" ] && [ "$L_CALL" -lt "$L_NTFY" ]; then
  ok "Scan laeuft vor der ntfy-Nachricht (Zeile $L_NTFY)"
elif [ -n "$L_CALL" ]; then
  bad "Scan steht NACH der Nachricht -- gemeldet wuerden die Zahlen des Vormonats"
fi

# The variables must be set before latest.env is read, or a run with set -u
# dies on the first unset name.
if grep -q '^[[:space:]]*TRIVY_HIGH=""' "$F"; then
  ok "TRIVY-Variablen sind vorbelegt"
else
  warn "keine Vorbelegung TRIVY_HIGH=\"\" gefunden -- bei set -u stirbt der Lauf, wenn latest.env fehlt"
fi

if [ -n "$L_SRC" ]; then
  ok "latest.env wird eingelesen (Zeile $L_SRC)"
else
  bad "latest.env wird nirgends eingelesen -- die Zahlen erreichen die Nachricht nicht"
fi

if grep -q 'TRIVY_HIGH:-\|TRIVY_HIGH}' "$F"; then
  ok "die Zahlen stehen im Nachrichtentext"
else
  bad "im Nachrichtentext steht kein TRIVY_HIGH"
fi

echo
echo "=== Umgebung ==="

if [ -L "$LINK" ]; then
  T=$(readlink -f "$LINK")
  if [ -x "$T" ]; then
    ok "$LINK -> $T"
  else
    bad "$LINK zeigt auf $T, das nicht ausfuehrbar ist"
  fi
elif [ -x "$LINK" ]; then
  warn "$LINK ist eine Kopie, kein Symlink ins Repo -- Aenderungen sind dann wieder unsichtbar"
else
  bad "$LINK fehlt"
fi

for c in trivy jq docker; do
  if command -v "$c" >/dev/null 2>&1; then
    ok "$c vorhanden ($(command -v "$c"))"
  else
    bad "$c fehlt"
  fi
done

# Trivy unpacks the layers here. /tmp is a 1.9 GB tmpfs on Trixie and is
# deliberately not used.
FREI=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ -n "$FREI" ] && [ "$FREI" -ge 8 ]; then
  ok "freier Platz auf /: ${FREI} GB"
elif [ -n "$FREI" ] && [ "$FREI" -ge 4 ]; then
  warn "nur ${FREI} GB frei auf / -- Trivy entpackt dort die Layer, beim groessten Image knapp"
else
  bad "zu wenig Platz auf /: ${FREI} GB"
fi

# 5400 s is what the unit allows today. With the scan the run on extern took
# about forty minutes, so this holds -- but it is worth seeing the number.
TMO=$(systemctl show monatliche-wartung.service -p TimeoutStartUSec --value 2>/dev/null)
[ -n "$TMO" ] && ok "Zeitlimit der Unit: $TMO"

# If the file already exists, reading it must not blow up. This is the trap
# the quotes in trivy-scan.sh are there for.
if [ -f "$ENVF" ]; then
  if ( set -u; . "$ENVF" ) 2>/dev/null; then
    ok "latest.env laesst sich einlesen"
  else
    bad "latest.env laesst sich NICHT einlesen -- unquotierter Wert, vermutlich 'erster Lauf'"
  fi
else
  ok "latest.env existiert noch nicht (vor dem ersten Scan normal)"
fi

if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -S error "$F" >/dev/null 2>&1; then
    ok "shellcheck ohne Fehler"
  else
    warn "shellcheck meldet etwas -- 'shellcheck $F' zeigt es"
  fi
fi

echo
if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo "Ergebnis: alles in Ordnung."
else
  echo "Ergebnis: $FAIL Fehler, $WARN Warnungen"
fi
[ "$FAIL" -eq 0 ]
