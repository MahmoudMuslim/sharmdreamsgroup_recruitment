import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import { getServiceRestClient } from "@/lib/data-api/service";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  OFFER_SCHEMA_NOTE,
  isOfferState,
  type OfferState,
} from "@/modules/offers/domain/offer";

/**
 * One offer as every screen reads it.
 *
 * The dates stay strings: PostgREST answers timestamp-with-time-zone columns in
 * the database's own offset, and the domain's arithmetic parses them when it
 * needs a number. A row whose state is not one of the four is not handed out at
 * all — a screen that cannot say what an offer's state means must not guess.
 */
export interface OfferRecord {
  id: string;
  applicationId: string;
  state: OfferState;
  expiresAt: string;
  issuedAt: string;
  decidedAt: string | null;
}

export type OfferRead =
  | { ok: true; offer: OfferRecord | null }
  | { ok: false; error: string; missingSchema: boolean };

function toRecord(row: Record<string, unknown> | null): OfferRecord | null {
  if (!row) return null;
  if (!isOfferState(row.state)) return null;
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    state: row.state,
    expiresAt: String(row.expires_at ?? ""),
    issuedAt: String(row.issued_at ?? ""),
    decidedAt: row.decided_at == null ? null : String(row.decided_at),
  };
}

const COLUMNS = "id, application_id, state, expires_at, issued_at, decided_at";

/**
 * The newest offer on an application, as the desk sees it.
 *
 * A missing table is reported as a read that failed with the schema note, not as
 * "no offer": those are different facts, and a panel that shows the first as the
 * second would invite a recruiter to issue a second offer into a database that
 * cannot hold the first.
 */
export async function readLatestOffer(applicationId: string): Promise<OfferRead> {
  const rest = await createServerRestClient();
  const { data, error } = await rest
    .from("application_offers")
    .select(COLUMNS)
    .eq("application_id", applicationId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      missingSchema: isMissingSchemaError(error),
      error: isMissingSchemaError(error)
        ? OFFER_SCHEMA_NOTE
        : "The offers could not be read just now. Try again in a moment.",
    };
  }

  return { ok: true, offer: toRecord(data as Record<string, unknown> | null) };
}

/**
 * The one offer a mailed link names, read without a session.
 *
 * The link is the credential: its signature and purpose were checked before this
 * is called, and the pair (application id, offer id) is taken from that signed
 * body. Reading both ids means a link from an older offer cannot answer the
 * application's newer one.
 */
export async function readOfferForLink(
  applicationId: string,
  offerId: string
): Promise<OfferRead> {
  const { data, error } = await getServiceRestClient()
    .from("application_offers")
    .select(COLUMNS)
    .eq("id", offerId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      missingSchema: isMissingSchemaError(error),
      error: isMissingSchemaError(error)
        ? OFFER_SCHEMA_NOTE
        : "This offer could not be read just now. Try again in a moment.",
    };
  }

  return { ok: true, offer: toRecord(data as Record<string, unknown> | null) };
}
