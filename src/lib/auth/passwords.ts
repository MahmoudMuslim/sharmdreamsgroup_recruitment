// The extension is load-bearing, not stylistic. This module is imported by a
// plain-Node probe (Task 8's note on probe resolution: an explicit `.ts`
// specifier, a relative path, no loader), and Node's ESM resolver refuses an
// extensionless `./db`. Step 4 enables the matching TypeScript option.
import { getAuthPool } from "./db.ts";

export type PasswordCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown_user" | "wrong_password" | "banned" };

/**
 * Verifies a staff password against the migrated bcrypt hash.
 *
 * `extensions.crypt(submitted, stored) = stored` is pgcrypto's own comparison: it
 * re-salts the submitted password with the stored hash's salt, so the comparison
 * is a string equality on a derived value and never touches the secret itself.
 * Both calls are schema-qualified because pgcrypto is installed `with schema
 * extensions` and this pool's default search_path is `"$user", public` — an
 * unqualified `crypt(...)` raises "function does not exist" (measured).
 *
 * The unknown-user case still pays for a bcrypt round anyway. That is deliberate:
 * without it, a missing account answers faster than a wrong password, and the
 * login form becomes an email-enumeration oracle. The round is generated inside
 * the database (`gen_salt('bf', 10)` — the same cost factor the fixtures were
 * seeded with), because a hand-written hash literal in this file would be a fake
 * credential: it cannot be proven to be real bcrypt output, it goes stale the
 * moment `seed-local-staff` re-hashes with a fresh salt, and a secret-shaped
 * string in source is what a secret scanner (and the next reviewer) flags first.
 */
export async function verifyStaffPassword(email: string, password: string): Promise<PasswordCheck> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await getAuthPool().query(
    `select id,
             (encrypted_password is not null
               and extensions.crypt($2, encrypted_password) = encrypted_password) as password_ok,
             banned_until is not null and banned_until > now() as is_banned
       from auth.users
      where lower(email) = $1
      limit 1`,
    [normalized, password]
  );

  if (!rows.length) {
    await getAuthPool().query("select extensions.crypt($1, extensions.gen_salt('bf', 10)) as x", [password]);
    return { ok: false, reason: "unknown_user" };
  }
  const row = rows[0] as { id: string; password_ok: boolean; is_banned: boolean };
  if (!row.password_ok) return { ok: false, reason: "wrong_password" };
  if (row.is_banned) return { ok: false, reason: "banned" };
  return { ok: true, userId: row.id };
}
