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

# Where the app answers. The Compose stack ALWAYS supplies this for the `cron`
# service (docker/docker-compose.yml: `APP_URL: ${APP_URL:-http://app:3000}`), so
# the value below is only reached when the image is run by hand, and it is the
# same target Compose uses — the app container on the compose network.
# Override APP_URL in docker/.env with http://host.docker.internal:3000 to point
# the poller at a host-side `next dev` instead; `extra_hosts` in the same service
# is what makes that name resolve on a Linux host.
APP_URL="${APP_URL:-http://app:3000}"

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
  # The secret reaches wget through the config file created below, never as an
  # argv `--header=`, because a process's command line is readable by anyone who
  # can see the container: `docker top cron` on the host printed the whole value
  # while this same file refused to echo it anywhere. GNU wget's `--config` also
  # stops it reading /etc/wgetrc and ~/.wgetrc (neither holds anything this loop
  # needs), and the `header =` line is its own documented way to add a request
  # header. Busybox wget has no `--config`, which is why the Dockerfile installs
  # GNU wget explicitly rather than relying on the base image's applet.
  #
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
  # too (measured), so those two flags hold whichever wget the image ends up
  # with. `--config` is the one flag that does not: busybox wget has no such
  # option (measured — it rejects it), so this loop requires the GNU wget the
  # Dockerfile installs.
  body=$(wget -q -O - --timeout=15 --tries=1 --config="$HEADER_CONFIG" "$1" 2>&1)
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

# The one place the secret is written: a private file GNU wget reads as its
# config, so the value appears in no argv entry and in no `/proc/*/cmdline` —
# neither inside the container nor on the host, where `docker top cron` used to
# print it for anyone who could run docker. mktemp creates the file 0600; the
# chmod is belt-and-braces for a TMPDIR on a filesystem that ignores the mode
# argument, and the trap is why the file does not outlive the loop. It lives in
# the container's own /tmp, so it never touches a mounted path or the repo.
HEADER_CONFIG=$(mktemp "${TMPDIR:-/tmp}/sdg-cron-wget.XXXXXX") || {
  echo "[cron] could not create a private wget config file — the loop cannot send the secret safely, so it is not starting." >&2
  exit 1
}
trap 'rm -f "$HEADER_CONFIG"' EXIT INT TERM
chmod 600 "$HEADER_CONFIG"
# No quotes around the value. wgetrc takes the rest of the line verbatim, so
# `header = "x-cron-secret: …"` sends a header whose NAME starts with a literal
# double quote, and the app's HTTP parser rejects that with 400 Bad Request
# (measured: quoted -> 400, unquoted -> 200 with the route's JSON body).
printf 'header = x-cron-secret: %s\n' "$CRON_SECRET" > "$HEADER_CONFIG"

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
