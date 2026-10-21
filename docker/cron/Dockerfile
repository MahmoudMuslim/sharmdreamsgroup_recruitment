# The cron container: a supervised shell loop, nothing else.
# Patch-pinned to the newest stable Alpine, on the same 3.24 base as every other
# image in this stack. Never take a tag from memory.
FROM alpine:3.24.2
# Correction to the brief: Alpine's built-in wget IS busybox's, but this explicit
# `apk add wget` installs GNU Wget, so run.sh's flags are exercised by the GNU
# parser rather than busybox's. Re-measure the printed version after any Alpine
# bump (`docker compose run --rm cron wget --version`); the loop's behaviour does
# not depend on the number, because every flag run.sh uses (-q, -O -, --header) is
# understood by both implementations. The difference is that under -q a refusal
# prints no body at all, which is why run.sh logs the exit code instead.
#
# Measured on this base, 2026-10-21: `docker compose run --rm --no-deps cron
# wget --version` prints `GNU Wget 1.25.0 built on linux-musl.`
RUN apk add --no-cache wget
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
CMD ["/usr/local/bin/run.sh"]
