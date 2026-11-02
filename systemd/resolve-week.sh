#!/usr/bin/env bash
# The resolver runs on roon-bridge: nightly by default, weekly with --weekly.
#
#   resolve-week.sh                 the night's run over what has been broadcast
#   resolve-week.sh --weekly        one pass over a whole finished week
#   resolve-week.sh --publish-only  build the archive and publish it, no adapters
#
# WHY NIGHTLY IS THE DEFAULT SINCE 07.09.2026. The weekly run asked about
# Monday's broadcasts on the following Sunday -- six days after the archive page
# appeared, and one day before DR's schedule stops reaching back. It worked, and
# it was the wrong way round for the app: what a listener wants on Tuesday is
# Monday's concert, and a weekly run cannot offer it before the weekend.
#
# The nightly run takes the broadcasts that are over and asks about each one
# every night for seven days from its end, then gives up. That window does not
# fit inside a week, which is why the file it keeps -- resolved.json, no date in
# the name -- is not reset on Mondays. See the --daily comment in resolve-week.js.
#
# --weekly is kept for a full pass by hand: a new adapter, a week that was
# missed while the Pi was off, a suspicion that wants checking against
# everything at once. Nothing runs it on a schedule any more.
#
# WHY A TIMER AND NOT A NOTE IN COMMAND.md. DR's schedule reaches back exactly
# seven days -- measured on 02.09.2026: 26.08 answered with eleven items, 25.08
# with none. A broadcast that is not asked about within the week is not a missed
# measurement, it is a missed recording, and nothing later can recover it. That
# was the argument for a weekly timer and it is a stronger one for a nightly:
# the seven days are now spent asking, over and over, instead of waiting.
#
# WHY INSIDE THE CONTAINER. The resolver calls the same adapters the server
# calls, and several of them start Chromium. That Chromium exists on this Pi in
# exactly one place: the autoplay-pi image, where Playwright's ARM build was
# verified. The credentials the adapters need live in the same place --
# PR_API_KEY for Polskie Radio, VRT_USERNAME/VRT_PASSWORD and the session file
# under /app/data for VRT. Running on the host would mean a second Node, a
# second browser download and a second copy of the secrets, in exchange for
# nothing.
#
# WHERE THE RESULT LANDS. /app/data/resolved inside the container is
# apps/autoplay-pi/data/resolved on this host -- a directory .gitignore has
# covered since the beginning. The default the script would use otherwise
# (data/resolved next to the repository root) is the one for runs at the Mac.

set -u

PROJECT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
COMPOSE_DIR="$PROJECT/apps/autoplay-pi"
# Overridable, because this repository is public since 02.11.2026 and the
# address below is one particular guide, not the only one. Set GUIDE in
# systemd/publish.env to point at your own.
GUIDE="${GUIDE:-https://konzertguide.rogzilla.eu/data}"
OUT="/app/data/resolved"

# One byte per answer. It is the only thing that separates "the adapter found an
# address" from "the address still leads to audio", and those two look identical
# in a record that does not ask.
EXTRA=(--probe)

# Everything after the resolver -- building the archive and publishing it --
# without the hour in front of it. For testing the path, and for the morning
# after a run that finished but could not reach the guide.
PUBLISH_ONLY=0
DAILY=1
for arg in "$@"; do
  case "$arg" in
    --publish-only) PUBLISH_ONLY=1 ;;
    --weekly)       DAILY=0 ;;
    *)              echo "Unknown option: $arg"; exit 2 ;;
  esac
done

# --daily makes the run fold into resolved.json instead of writing a file per
# run, and skip the broadcasts that are not over yet. It needs --probe, which
# is already in EXTRA: without a verdict nothing is ever settled and every
# night would ask every station about the whole week again.
if [ "$DAILY" -eq 1 ]; then
  EXTRA+=(--daily)
fi

MODE_LABEL="weekly"
if [ "$DAILY" -eq 1 ]; then MODE_LABEL="nightly"; fi

echo "== Resolver run, $MODE_LABEL, $(date '+%F %H:%M:%S') =="

# The Monday of the week now ending. The collector names its archive copy after
# the day it ran, and it runs Monday 02:00 -- so on any day of the week this is
# the name of the collection currently in service.
if [ "$PUBLISH_ONLY" -eq 1 ]; then
  echo "-> --publish-only: skipping the resolver, using the newest result file."
fi

MONDAY="$(date -d "-$(( $(date +%u) - 1 )) days" +%F)"
ARCHIVE="$GUIDE/archive/schedule-$MONDAY.json"
LIVE="$GUIDE/schedule.json"

# The archive copy is preferred because it is named and will still be there in
# December. The live file is the fallback for the case the archive copy carries
# another date -- a collection that failed on Monday and was repeated by hand on
# Tuesday is named after Tuesday. Then the live file is the same data under a
# name this script cannot guess.
if [ "$PUBLISH_ONLY" -eq 1 ]; then
  SOURCE=""
elif [ "$DAILY" -eq 1 ]; then
  # The live file, not the archived copy. A nightly run is about the week now
  # in service, and schedule.json IS that week -- the same file the app reads,
  # so what the run finds and what a person sees cannot drift apart. The named
  # copy matters for the weekly pass, which is a record of a week that is over.
  SOURCE="$LIVE"
  echo "-> Source: schedule.json -- the week now in service"
elif curl -fsS -I --max-time 20 "$ARCHIVE" >/dev/null 2>&1; then
  SOURCE="$ARCHIVE"
  echo "-> Source: the archived week of $MONDAY"
else
  SOURCE="$LIVE"
  echo "-> Source: schedule.json -- no archive copy named $MONDAY."
  echo "   Worth a look: it means the collection did not run on its Monday."
fi

cd "$COMPOSE_DIR" || { echo "FAILED: no $COMPOSE_DIR"; exit 1; }

CID="$(docker compose ps -q autoplay-pi 2>/dev/null)"
if [ -z "$CID" ] || [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null)" != "true" ]; then
  echo "FAILED: autoplay-pi is not running -- nothing to run the adapters in."
  exit 1
fi

# -T because there is no terminal here. The run takes the better part of an
# hour; the result file is rewritten after every entry, so an interruption
# costs the remainder and not the beginning.
if [ "$PUBLISH_ONLY" -eq 1 ]; then
  STATUS=0
else
  docker compose exec -T autoplay-pi node resolve-week.js "$SOURCE" --out "$OUT" "${EXTRA[@]}"
  STATUS=$?
fi

if [ "$STATUS" -ne 0 ]; then
  echo "== Resolver run finished, exit $STATUS -- not building the archive =="
  exit $STATUS
fi

# --------------------------------------------------------------------------
# The archive, and how it gets to the guide.
#
# Until 07.09.2026 these three steps ran from a laptop by hand, which meant the
# archive only grew on the days somebody remembered it. They belong here
# because this script is the one thing that knows a run has just finished, and
# which run it was.
#
# The result file is picked by DATE MODIFIED rather than by name. The resolver
# names it after the day it started, and a run begun at 22:00 on Sunday can
# finish on Monday -- computing the name here would guess wrong on exactly the
# nights that matter.

HOST_OUT="$COMPOSE_DIR/data/resolved"
if [ "$DAILY" -eq 1 ]; then
  # One standing file, so there is nothing to pick. --publish-only follows a
  # nightly run by default and finds it here; after a weekly pass it wants the
  # dated file, which is what "--weekly --publish-only" is for.
  LATEST="$HOST_OUT/resolved.json"
  [ -f "$LATEST" ] || LATEST=""
else
  LATEST="$(ls -1t "$HOST_OUT"/resolved-*.json 2>/dev/null | head -1)"
fi

if [ -z "$LATEST" ]; then
  echo "WARNING: the run reported success but left no result file in $HOST_OUT."
  exit 0
fi

echo "-> Building the archive from $(basename "$LATEST")"
docker compose exec -T autoplay-pi \
  node build-archive.js "$OUT/$(basename "$LATEST")" --out "$OUT"
BUILD=$?

if [ "$BUILD" -ne 0 ]; then
  echo "WARNING: build-archive.js failed with $BUILD. The run itself is fine;"
  echo "         the archive keeps whatever it held before."
  exit 0
fi

# The operating report, beside the archive and separate from it on purpose.
#
# playable.json answers "what is still there to listen to" and resolver.json
# answers "how did the runs go" -- different question, different reader,
# different lifetime, and the second has no business inside the file people
# play from. Counts and station names only; the media addresses stay here.
#
# A failure is a warning and never an exit: a missing report is worth noticing
# and is not worth losing an archive over.
# --history appends one record per run and is never rewritten. It lives beside
# the result files on this host, so it survives a rebuilt image -- a trend that
# starts over whenever the container is replaced is no trend.
echo "-> Writing the operating report"
docker compose exec -T autoplay-pi \
  node audit-resolved.js "$OUT/$(basename "$LATEST")" --limit 4 \
  --json "$OUT/resolver.json" --history "$OUT/resolver-history.json" || \
  echo "WARNING: audit-resolved.js failed. The archive is unaffected."

# Where the guide lives, and how to reach it. Deliberately NOT written down in
# this file: the repository is private today and might not stay that way, and a
# home network's addresses belong in the same place as its keys. Create
# systemd/publish.env (gitignored) with:
#
#   GUIDE_SSH=roger@<address of extern>
#   GUIDE_PROJECT=~/konzert-guide
#
# The unit reads it with EnvironmentFile=-, so a missing file is not an error --
# the archive is then built here and placed by hand, exactly as before.
if [ -z "${GUIDE_SSH:-}" ]; then
  echo "-> Not published: GUIDE_SSH is unset. playable.json is in $HOST_OUT."
  exit 0
fi

PROJECT_DIR="${GUIDE_PROJECT:-~/konzert-guide}"

# Two files now, and the loop rather than two copies of the same six lines.
# playable.json is the archive the app reads; resolver.json is the operating
# report beside it. Either may be missing without the other being wrong.
PUBLISH="playable.json resolver.json resolver-history.json"

# Piped through ssh rather than sent with scp, since 07.09.2026.
#
# scp failed with "Connection closed" while `ssh guide 'echo …'` worked a
# minute earlier -- not an authentication problem, a protocol one. Since
# OpenSSH 9 scp speaks SFTP, and the guide is a hardened host where that
# subsystem is not offered. A plain `cat` needs nothing but the right to run a
# command, which is the one thing the key over there is allowed to do.
for NAME in $PUBLISH; do
  if [ ! -f "$HOST_OUT/$NAME" ]; then
    echo "-> Not published: $NAME was not written."
    continue
  fi
  echo "-> Publishing $NAME to $GUIDE_SSH"
  if ! ssh -o BatchMode=yes "$GUIDE_SSH" "cat > $NAME" < "$HOST_OUT/$NAME"; then
    echo "WARNING: the copy of $NAME to $GUIDE_SSH failed. Nothing else is wrong"
    echo "         -- the file is waiting in $HOST_OUT. BatchMode is on, so a key"
    echo "         that needs a passphrase looks exactly like this."
    continue
  fi
  if ! ssh -o BatchMode=yes "$GUIDE_SSH" \
    "cd $PROJECT_DIR && docker compose cp ~/$NAME cron:/output/$NAME"; then
    echo "WARNING: $NAME reached $GUIDE_SSH but could not be placed in the"
    echo "         volume. It is in the home directory there; docker compose cp"
    echo "         puts it where the frontend can serve it."
  fi
done

echo "-> Published. $GUIDE/playable.json"
echo "== Resolver run finished, exit $STATUS =="
exit $STATUS
