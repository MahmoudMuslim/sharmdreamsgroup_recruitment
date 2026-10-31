#!/bin/sh
# Set the PostgREST login role's password from the environment, on a fresh volume.
#
# Why this exists: docker/.env.example says that on KVM2 every value here is
# replaced from a secrets file, while 00-roles.sql set the `authenticator`
# password as a committed literal and docker-compose.yml builds PGRST_DB_URI from
# ${LOCAL_PGRST_PASSWORD}. Those two instructions contradicted each other: an
# operator who rotated the env value alone got a `rest` that restart-looped, and
# one who kept the pair working kept a repo-known role password on a public host.
# This file makes the environment authoritative without editing a committed
# literal.
#
# Order: docker_process_init_files walks /docker-entrypoint-initdb.d/* in lexical
# order and dispatches on the extension, so this 05-*.sh runs after 00-roles.sql
# created the role and after every other *.sql file — which is what "the env wins"
# requires. It only runs while PGDATA is empty, so rotating the value takes
# `npm run docker:wipe` + re-apply + re-seed (docs/DEPLOYMENT.md).
#
# The skip is silent on purpose. LOCAL_PGRST_PASSWORD is unset on a host that has
# only ever used 00-roles.sql's first-boot default, which is the documented local
# state, not a mistake — and a warning on every fresh volume is how a real one
# stops being read. An empty value skips too: blanking a login role's password is
# not a fallback, it is an open door.
#
# No `exit` anywhere: docker_process_init_files SOURCES a *.sh it cannot execute
# (a checkout that lost the exec bit), and an `exit` in a sourced init file ends
# the whole entrypoint mid-initialisation.
if [ -n "${LOCAL_PGRST_PASSWORD:-}" ]; then
  # :'pw' is psql's quoted-literal substitution — it is what makes a password
  # containing a single quote safe. Never interpolate the value into the SQL text
  # by hand.
  #
  # The statement arrives on stdin, not as `-c "… :'pw'"`, because psql does not
  # interpolate inside `-c` (measured against this image: `psql -v pw=x -c
  # "select :'pw'"` raises `syntax error at or near ":"`, while the same `-v pw=x`
  # fed on stdin returns the value). This is also the form the image's own
  # docker_process_sql uses for its `CREATE DATABASE :"db"`.
  #
  # A failure is loud and ends the init pass (the entrypoint runs `set -Eeo
  # pipefail`, and `false` propagates whether this file is executed or sourced) —
  # a half-set role is precisely the state that leaves `rest` restart-looping with
  # no explanation in the logs. `exit` is never used: sourced, it would take the
  # entrypoint down mid-initialisation.
  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
    -v pw="$LOCAL_PGRST_PASSWORD" <<-'EOSQL'
alter role authenticator password :'pw';
EOSQL
  then
    echo "[initdb] authenticator password set from LOCAL_PGRST_PASSWORD (value never printed)"
  else
    echo "[initdb] FAILED to set the authenticator password from LOCAL_PGRST_PASSWORD" >&2
    false
  fi
fi
