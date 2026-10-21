#!/bin/sh
# Sharm Dreams Talent Cloud — the scheduler this app never had.
#
# /api/cron/whatsapp drains the queue that every stage-change notice is written
# to; /api/cron/grading re-grades attempts left unscored during a provider
# outage. Both are idempotent sweeps, so this loop only has to keep knocking on
# the door. It is the container's PID 1: no crond (which wants a user, a spool
# and a foreground-flag fight), and Compose restarts it with `unless-stopped`.
#
# Both routes answer 401 `{"error":"Unauthorized"}` when x-cron-secret is wrong
# and 503 when the APP has no CRON_SECRET at all, so a broken scheduler is
# loud here: `hit()` prints [FAIL], never silence.

# Poll intervals, in seconds. A short interval costs one query; a long one
# delays a candidate's notice. Keep the ratio honest: the grading sweep runs
# every GRADING_EVERY / WHATSAPP_EVERY ticks, so 300/60 means every fifth tick.
# Change one and you must change the other — see docker/.env.example.
WHATSAPP_EVERY="${WHATSAPP_EVERY:-60}"
GRADING_EVERY="${GRADING_EVERY:-300}"

# The app. Locally that is `next dev` on the Windows host, which the container
# reaches through host.docker.internal (extra_hosts in docker-compose.yml keeps
# this same default valid on a Linux host). Set APP_URL in docker/.env to point
# at the `app` service when the `full` profile is the one running.
APP_URL="${APP_URL:-http://host.docker.internal:3000}"

# busybox integer division truncates, and `$((x % 0))` is an error on every
# single tick. Clamp both intervals to >= 1 and compute the ratio once: zero
# would mean a modulo-by-zero each tick, and `seq 1 0` emits nothing, which
# would spin this loop hot with no sleep at all. A non-numeric value also
# prints what it replaced — a silent default would hide an operator typo in plain
# configuration (not a secret), and the loop would look fine on the wrong clock.
case "$WHATSAPP_EVERY" in
  ''|*[!0-9]*)
    echo "[cron] WHATSAPP_EVERY='$WHATSAPP_EVERY' is not a number — using 60" >&2
    WHATSAPP_EVERY=60
    ;;
esac
case "$GRADING_EVERY" in
  ''|*[!0-9]*)
    echo "[cron] GRADING_EVERY='$GRADING_EVERY' is not a number — using 300" >&2
    GRADING_EVERY=300
    ;;
esac
[ "$WHATSAPP_EVERY" -lt 1 ] && WHATSAPP_EVERY=1
[ "$GRADING_EVERY" -lt 1 ] && GRADING_EVERY=1
GRADING_EVERY_TICKS=$((GRADING_EVERY / WHATSAPP_EVERY))
[ "$GRADING_EVERY_TICKS" -lt 1 ] && GRADING_EVERY_TICKS=1

hit() {
  # -q with -O - : wget exits non-zero on a 4xx/5xx, which is the point — a
  # refused or misconfigured sweep must print [FAIL], not nothing. -q also means
  # no body on a refusal (measured: GNU wget 1.24.5 prints nothing at all under
  # -q), so the exit code is what names the reason, and it is a real
  # distinction: rc=6 is the server answering with an error status (401 wrong
  # secret, 503 app with no secret), rc=4 is a connection that never landed
  # (app down, wrong APP_URL). Both are printed, never swallowed.
  #
  # --timeout=15 --tries=1 closes the other way this loop can go quiet. The
  # manual's defaults for this image's GNU wget 1.24.5 are a 900s read timeout
  # and 20 tries (`wget --help` names the flags but prints no values), so an app
  # that accepts the socket and never answers could block one hit() for hours —
  # no sweep, no heartbeat, no [FAIL]. Measured against a listener that never
  # answers: the defaults were still blocked at 100s, `--timeout=3 --tries=1`
  # came back in 3s. Busybox wget 1.36.1 parses and honours both long spellings
  # too (measured), so the flags hold whichever wget the image ends up with.
  body=$(wget -q -O - --timeout=15 --tries=1 --header="x-cron-secret: $CRON_SECRET" "$1" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "[ok] $1 $body"
  else
    echo "[FAIL] $1 rc=$rc reason=${body:-wget returned a non-zero status; -q prints no body}"
  fi
}

if [ -z "$CRON_SECRET" ]; then
  echo "[cron] CRON_SECRET is empty — the routes answer 503, so this loop would only log failures." >&2
  echo "[cron] Set it in docker/.env to the same value the app has. Sleeping instead." >&2
  while :; do sleep 3600; done
fi

echo "[cron] polling $APP_URL every ${WHATSAPP_EVERY}s; grading every ${GRADING_EVERY_TICKS} ticks (${GRADING_EVERY}s)"

Counter=0
while :; do
  # One sleep, not 60 `sleep 1` forks a minute. Busybox sh dies on SIGTERM while
  # this child runs, so `docker stop` is already prompt.
  sleep "$WHATSAPP_EVERY"
  hit "$APP_URL/api/cron/whatsapp"
  Counter=$((Counter + 1))
  if [ $((Counter % GRADING_EVERY_TICKS)) -eq 0 ]; then
    hit "$APP_URL/api/cron/grading"
  fi
done
