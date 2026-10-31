import type { createServerRestClient } from "@/lib/data-api/server";

/**
 * The server-side REST client every repository read runs through.
 *
 * One place for a type the action files each re-typed on their own. It matters
 * that this is the *server* client and not the browser one: the read goes out
 * with the caller's role claims, so the RLS policies decide what comes back and
 * a repository can never reach past the scope of the person who asked.
 */
export type StaffRestClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The half of that client a read touches: `from`, and nothing else.
 *
 * Callers annotated their client however they liked before this layer existed
 * — some write the awaited server client, some `RestClient` from the transport
 * — and both carry a `from` built by the same factory. Taking the narrower
 * shape means a repository accepts either, without asking every action file to
 * re-type the parameter it already has.
 */
export type StaffReadClient = Pick<StaffRestClient, "from">;
