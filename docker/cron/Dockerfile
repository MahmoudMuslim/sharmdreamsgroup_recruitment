# The cron container: a supervised shell loop, nothing else.
# Pinned to the tag this repo already has local and has measured
# (`docker manifest inspect alpine:3.20` passes; Task 15's host-reach test ran
# on it). Never take a tag from memory.
FROM alpine:3.20
# Correction to the brief: Alpine's built-in wget IS busybox's, but this explicit
# `apk add wget` installs GNU Wget — measured in the built image, `wget --version`
# prints "GNU Wget 1.24.5 built on linux-musl". Every flag run.sh uses (-q, -O -,
# --header) is understood by both, so the loop works either way; the difference is
# that under -q a refusal prints no body at all, which is why run.sh logs the exit
# code instead.
RUN apk add --no-cache wget
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
CMD ["/usr/local/bin/run.sh"]
