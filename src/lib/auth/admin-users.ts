import "server-only";
// The `@/` alias is safe in this file and only in this file: `server-only`
// means Next loads it, so no plain-Node probe has to resolve the specifier
// (contrast Task 9's `./db.ts`, which a probe does import).
import { getAuthPool } from "@/lib/auth/db";

export interface AdminUserRow {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
  banned_until: string | null;
}

/** Every method answers in supabase-js's shape: exactly one of these is set. */
type Result<T> = { data: T; error: null } | { data: null; error: { message: string; code?: string } };

/** `876000h` is a century, which is what the console means by "permanent". */
function banUntil(duration: string): Date | null {
  if (duration === "none") return null;
  const hours = Number(duration.replace("h", ""));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + hours * 3_600_000);
}

export const authAdmin = {
  async listUsers({ page, perPage }: { page: number; perPage: number }): Promise<Result<{ users: AdminUserRow[] }>> {
    const offset = (Math.max(1, page) - 1) * perPage;
    const { rows, error } = await run(
      // `banned_until` is cast to text HERE, not left as the `timestamptz` `pg`
      // hands back as a JS Date: `AdminUserRow` declares `string | null`, and
      // `user-actions.ts:483` puts the value into a `Record<string, string|null>`
      // that the Team console renders. Returning a Date would make that type a
      // lie that only shows up as a formatting bug in the browser.
      `select id, email, raw_user_meta_data as user_metadata,
              to_char(banned_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as banned_until
         from auth.users order by created_at limit $1 offset $2`,
      [perPage, offset],
    );
    if (error) return { data: null, error };
    return { data: { users: rows as AdminUserRow[] }, error: null };
  },

  async createUser(input: {
    email: string;
    password: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
  }): Promise<Result<{ user: { id: string } }>> {
    const { rows, error } = await run(
      `insert into auth.users
         (aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values ('authenticated', 'authenticated', lower($1), extensions.crypt($2, extensions.gen_salt('bf', 10)),
               case when $3 then now() else null end, $4::jsonb, now(), now())
       returning id`,
      [input.email, input.password, input.email_confirm ?? false, JSON.stringify(input.user_metadata ?? {})],
    );
    if (error) return { data: null, error };
    return { data: { user: rows[0] }, error: null };
  },

  async updateUserById(
    id: string,
    patch: { email?: string; email_confirm?: boolean; password?: string; ban_duration?: string; user_metadata?: Record<string, unknown> },
  ): Promise<Result<null>> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.email) {
      values.push(patch.email.toLowerCase());
      sets.push(`email = $${values.length}`);
      // GoTrue's `email_confirm` is the same column Task 12's INSERT writes, and
      // the Team console's rename path sets it: a moved address that comes back
      // unconfirmed is an account that cannot sign in.
      values.push(patch.email_confirm !== false);
      sets.push(`email_confirmed_at = case when $${values.length} then coalesce(email_confirmed_at, now()) else null end`);
    }
    if (patch.password) {
      values.push(patch.password);
      sets.push(`encrypted_password = extensions.crypt($${values.length}, extensions.gen_salt('bf', 10))`);
    }
    if (patch.ban_duration !== undefined) {
      values.push(banUntil(patch.ban_duration));
      sets.push(`banned_until = $${values.length}`);
    }
    if (patch.user_metadata) {
      values.push(JSON.stringify(patch.user_metadata));
      sets.push(`raw_user_meta_data = $${values.length}::jsonb`);
    }
    if (sets.length === 0) return { data: null, error: null };

    values.push(id);
    sets.push("updated_at = now()");
    const { error } = await run(
      `update auth.users set ${sets.join(", ")} where id = $${values.length}::uuid`,
      values,
    );
    if (error) return { data: null, error };
    return { data: null, error: null };
  },

  async deleteUser(id: string): Promise<Result<null>> {
    const { error } = await run(`delete from auth.users where id = $1::uuid`, [id]);
    if (error) return { data: null, error };
    return { data: null, error: null };
  },
};

async function run(text: string, values: unknown[]) {
  try {
    return { rows: (await getAuthPool().query(text, values)).rows, error: null };
  } catch (cause) {
    const e = cause as { message?: string; code?: string };
    return { rows: [], error: { message: e.message ?? "Database error", code: e.code } };
  }
}
