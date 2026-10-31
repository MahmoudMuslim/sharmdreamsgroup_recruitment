/**
 * PostgREST's answer to "this feature's columns are not on the database yet".
 *
 * Four codes say it — a missing column (42703) or table (42P01), and the two
 * ways PostgREST reports a schema cache that has not caught up (PGRST204,
 * PGRST205) — plus the message check for the local REST shim, which words the
 * same failure in its own sentence. A constraint violation (23514) is not in
 * here: the schema exists and the value is what the database refused.
 *
 * Two domain modules carry this predicate already, and `scripts/prove-core-entities.mjs`
 * reads all three and fails when their code sets disagree. It lives here because
 * whether a read failed on transport or on a missing column is a fact about the
 * wire, not about a business rule — and a repository may not import a module to
 * learn it.
 */

/** The shape a REST error has where this is decided: a code, a message, nothing else. */
export interface SchemaErrorShape {
  code?: string | null;
  message?: string | null;
}

export const MISSING_SCHEMA_CODES = ["42703", "42P01", "PGRST204", "PGRST205"] as const;

export function isMissingSchemaError(error: SchemaErrorShape | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? null;
  if (code && (MISSING_SCHEMA_CODES as readonly string[]).includes(code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}
