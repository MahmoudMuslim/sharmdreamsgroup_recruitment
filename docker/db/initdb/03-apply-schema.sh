#!/bin/sh
# Apply the schema of record on a fresh volume, so a first `up` ends with a
# database the app can actually read.
#
# Why this exists: `03-schema.sql` was the obvious shape and does not work —
# Docker refuses to create a file mountpoint inside the read-only bind mount
# that `./db/initdb:/docker-entrypoint-initdb.d:ro` already is ("openat
# 03-schema.sql: read-only file system", measured against this image). So the
# repo's `db/` directory is mounted at `/db:ro` and this file is the one-liner
# that applies `db/schema.sql` from it. No copy of the schema is committed twice,
# so the file that runs and the file a human reviews cannot drift.
#
# Order: init files are walked in lexical order, so this runs after
# 00-roles.sql, 01-extensions.sql and 02-auth-users.sql — the roles and the
# `auth` stand-in that schema.sql grants to and foreign-keys into — and before
# 04-seed-staff.sh, which needs `public.user_profiles` and the group-profile row
# that the reference inserts at the end of schema.sql create.
#
# Idempotent by construction (schema.sql is): a re-run on a volume that already
# has objects updates instead of failing. `npm run db:apply-local` remains the
# path for an existing volume, because it also restarts PostgREST afterwards to
# drop its cached schema description.
#
# No `exit` anywhere: docker_process_init_files SOURCES a *.sh it cannot execute,
# and an `exit` in a sourced init file ends the whole entrypoint mid-run. `set -e`
# style failure propagation is the entrypoint's own `set -Eeo pipefail`, so `false`
# is what aborts a half-applied initialisation.
if [ -f /db/schema.sql ]; then
  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -f /db/schema.sql > /tmp/schema-apply.log 2>&1
  then
    objects=$(psql -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "
      select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r','p'))
             || ' tables, ' ||
             (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public')
             || ' policies, ' ||
             (select count(*) from public.tenants_and_companies) || ' companies'")
    echo "[initdb] db/schema.sql applied — $objects"
  else
    # The log is the only copy of the failing statement; the entrypoint's own
    # output would otherwise show just "psql exited with 3".
    echo "[initdb] FAILED to apply db/schema.sql:" >&2
    tail -n 20 /tmp/schema-apply.log >&2
    false
  fi
else
  echo "[initdb] /db/schema.sql is not mounted — is the db service's '../db:/db:ro' volume missing?" >&2
  false
fi
