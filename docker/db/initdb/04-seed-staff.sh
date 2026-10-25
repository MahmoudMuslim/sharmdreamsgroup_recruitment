#!/bin/sh
# First-boot staff sign-ins, on a fresh volume.
#
# Why this exists: a stack where db/schema.sql has just created 46 tables still
# has nobody who can log in, so "deployed" and "usable" were two different
# states that needed a second command (`npm run db:seed-local`) run by hand from
# a host that had `pg` installed. On KVM2 that host step is the one that gets
# skipped at 2am. This file makes a first `up` end with a working sign-in.
#
# Order: docker_process_init_files walks /docker-entrypoint-initdb.d/* in
# lexical order, so 04-* runs after 03-schema.sql mounted by docker-compose.yml
# (which is what creates `public.user_profiles`, `public.tenants_and_companies`
# and the group-profile row these accounts hang off) and after 00-03, and before
# 05-set-pgrst-password.sh.
#
# Password handling is the same rule the host-side seed follows: pgcrypto's
# `extensions.crypt(pw, extensions.gen_salt('bf', 10))`, byte-compatible with the
# hashes a restored live dump carries, so src/lib/auth/db.ts verifies both the
# same way. It is passed as a psql variable (:'pw'), never interpolated into the
# SQL text, and never echoed - a password containing a quote must not become a
# syntax error, and it must not land in `docker compose logs`.
#
# The skip is silent on purpose, like 05-*: LOCAL_STAFF_PASSWORD unset is the
# documented state of a host that seeds staff its own way, not a mistake.
#
# No `exit` anywhere: docker_process_init_files SOURCES a *.sh it cannot execute,
# and an `exit` in a sourced init file ends the whole entrypoint mid-run.
if [ -n "${LOCAL_STAFF_PASSWORD:-}" ]; then
  # The fixtures keep the addresses the proof scripts sign in as; only the owner
  # is releasable, because production should not ship a `.test` SUPER_ADMIN.
  owner_email="${STAFF_OWNER_EMAIL:-owner.local@sharmdreams.test}"
  owner_name="${STAFF_OWNER_NAME:-Local Owner}"

  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v pw="$LOCAL_STAFF_PASSWORD" \
    -v owner_email="$owner_email" \
    -v owner_name="$owner_name" <<-'EOSQL'
	-- One statement so a half-seeded tenant cannot survive: auth.users and the
	-- profile that names its role are written together, and the conflict arms
	-- make a re-run reset the password instead of failing on a duplicate email.
	with tenant as (
	  select id from public.tenants_and_companies where is_group_profile = true limit 1
	), staff(email, name, role) as (
	  values
	    (:'owner_email', :'owner_name', 'SUPER_ADMIN'),
	    ('recruiter.local@sharmdreams.test', 'Local Recruiter', 'RECRUITER'),
	    ('candidate.local@sharmdreams.test', 'Local Candidate', 'CANDIDATE')
	), upserted as (
	  insert into auth.users (
	    email, role, encrypted_password, email_confirmed_at,
	    raw_app_meta_data, raw_user_meta_data
	  )
	  select s.email,
	         'authenticated',
	         extensions.crypt(:'pw', extensions.gen_salt('bf', 10)),
	         now(),
	         jsonb_build_object(
	           'provider', 'email',
	           'providers', array['email'],
	           'tenant_id', t.id
	         ),
	         jsonb_build_object('full_name', s.name)
	  from staff s cross join tenant t
	  on conflict (email) do update
	    set encrypted_password = excluded.encrypted_password
	  returning id, email
	)
	insert into public.user_profiles (auth_user_id, tenant_id, full_name, email, role, locale)
	select u.id, t.id, s.name, u.email, s.role::public.user_role, 'en'
	from upserted u
	join staff s on s.email = u.email
	cross join tenant t
	on conflict (auth_user_id) do update
	  set role = excluded.role,
	      full_name = excluded.full_name,
	      email = excluded.email;
EOSQL
  then
    echo "[initdb] staff sign-ins seeded (3 rows; password from LOCAL_STAFF_PASSWORD, value never printed)"
  else
    echo "[initdb] FAILED to seed staff sign-ins — is 03-schema.sql applied and is the group tenant present?" >&2
    false
  fi
fi
