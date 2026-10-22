"use server";

import { revalidatePath } from "next/cache";
import { createServerRestClient } from "@/lib/data-api/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
import { recordActivity } from "@/modules/activity/application/record";
import { changePhrase, changedFields } from "@/modules/activity/domain/trail";
import {
  PROSPECT_OUTREACH_DEFAULTS,
  PROSPECT_OUTREACH_TEMPLATES,
  renderTemplate,
  type TemplateVars,
} from "@/modules/settings/domain/templates";
import {
  normalizeLinkedInUrl,
  parseProspectImport,
  type ProspectImportProblem,
} from "@/modules/sourcing/domain/prospect-import";
import {
  matchCatalogueSkills,
  normalizeProspectProfile,
  profileIsEmpty,
  renderProfileText,
  type ProspectProfile,
} from "@/modules/sourcing/domain/prospect-profile";
import {
  HIREABLE_STATUSES,
  PICKER_LIMIT,
  isHireable,
  openingOptionLabel,
} from "@/modules/jobs/domain/hireable";
import { requireHireableOpening } from "@/modules/jobs/infrastructure/hireableOpening";
import {
  DEDUPE_WINDOW,
  POOL_LIMIT,
  PROSPECT_STAGES,
  stageWord,
  type PoolCounts,
  type ProspectPoolTotals,
  type ProspectStage,
} from "./pool-model";

/**
 * Server actions behind the Sourcing board.
 *
 * A prospect is not a candidate: these rows have no tracking code and no portal
 * access, so nothing here touches `applications` until a recruiter explicitly
 * converts one. Every write goes through the session's RLS-scoped client rather
 * than the service role, so the `candidates.write` grant is the real gate and
 * not just a check the UI performs.
 */

export type OutreachChannel = "EMAIL" | "WHATSAPP";

export interface ProspectRow {
  id: string;
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  origin: string;
  stage: ProspectStage;
  job_id: string | null;
  job_title: string | null;
  /** The linked opening's `job_status`, so a closed role can be named as closed. */
  job_status: string | null;
  application_id: string | null;
  last_contacted_at: string | null;
  created_at: string;
  /** Messages this pool has generated, across both channels. */
  messages: number;
}

export interface ProspectHistoryRow {
  id: string;
  channel: OutreachChannel;
  subject: string | null;
  body: string;
  recipient: string;
  delivered: boolean;
  error_message: string | null;
  created_at: string;
}

export interface JobOption {
  id: string;
  title: string;
  status: string;
}

/** The openings a picker may offer, and how many hireable ones the table holds. */
export interface JobPicker {
  jobs: JobOption[];
  total: number;
}

interface ProspectWriteResult {
  ok: boolean;
  error?: string;
}

const PROSPECT_SELECT = `
  id, full_name, headline, company, location, email, phone, linkedin_url, notes,
  origin, stage, job_id, application_id, last_contacted_at, created_at,
  job_openings ( title, status ),
  communication_logs ( channel )
`;

const STAGES = new Set<string>(PROSPECT_STAGES);

function toRow(row: Record<string, unknown>): ProspectRow {
  // A prospect outlives the role it was linked to, and the outreach letter
  // quotes that role by name, so the row carries its status.
  const job = row.job_openings as
    | { title?: string; status?: string }
    | { title?: string; status?: string }[]
    | null;
  const logs = row.communication_logs as unknown[] | undefined;
  const embedded = Array.isArray(job) ? job[0] : job;
  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    headline: (row.headline as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    linkedin_url: (row.linkedin_url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    origin: String(row.origin ?? "MANUAL"),
    stage: (row.stage as ProspectStage) ?? "NEW",
    job_id: (row.job_id as string | null) ?? null,
    job_title: embedded?.title ?? null,
    job_status: embedded?.status ?? null,
    application_id: (row.application_id as string | null) ?? null,
    last_contacted_at: (row.last_contacted_at as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    messages: Array.isArray(logs) ? logs.length : 0,
  };
}

/** Writes only the columns it was given, so an edit never blanks a field. */
function prospectPayload(input: Partial<ProspectFields>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of [
    "full_name",
    "headline",
    "company",
    "location",
    "email",
    "phone",
    "linkedin_url",
    "notes",
    "job_id",
  ] as const) {
    if (input[key] !== undefined) payload[key] = input[key];
  }
  return payload;
}

interface ProspectFields {
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  job_id: string | null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The pool: this render's window into it, and what the whole table holds.
 *
 * `stage` is the rail's own filter and goes into the query, so the rows under a
 * chip come from the database rather than from whatever happened to load — the
 * same reason the candidates list answers its rails server-side. The counts stay
 * whole-pool either way: the other chips would otherwise shrink to describe one
 * stage, and a rail that counts nine hundred prospects has to be a rail the page
 * can walk, not a promise it quietly breaks.
 */
export async function getProspectPool(input: {
  stage?: ProspectStage | null;
} = {}): Promise<{
  prospects: ProspectRow[];
  totals: ProspectPoolTotals;
}> {
  await requireStaff("/sourcing");

  const restClient = await createServerRestClient();
  const rowsQuery = restClient
    .from("sourced_prospects")
    .select(PROSPECT_SELECT)
    .order("created_at", { ascending: false })
    .limit(POOL_LIMIT);
  const [rows, total, ...stageCounts] = await Promise.all([
    input.stage ? rowsQuery.eq("stage", input.stage) : rowsQuery,
    restClient.from("sourced_prospects").select("id", { count: "exact", head: true }),
    ...PROSPECT_STAGES.map((stage) =>
      restClient
        .from("sourced_prospects")
        .select("id", { count: "exact", head: true })
        .eq("stage", stage)
    ),
  ]);

  const prospects = rows.error
    ? []
    : (rows.data ?? []).map((row) => toRow(row as unknown as Record<string, unknown>));
  const byStage = Object.fromEntries(
    PROSPECT_STAGES.map((stage, index) => [stage, stageCounts[index]?.count ?? 0])
  ) as PoolCounts;

  return {
    prospects,
    totals: {
      // A failed head count leaves nothing truer than the rows in hand.
      total: total.count ?? prospects.length,
      byStage,
      loaded: prospects.length,
      limit: POOL_LIMIT,
    },
  };
}

/**
 * Openings a prospect can be linked to or converted against.
 *
 * Closed roles are left out by the query, not hidden by the picker: a dropdown
 * that offers one is an invitation to file a person into a pipeline that leads
 * nowhere, and every closed row on it spends room the still-hiring roles need.
 * `total` is the hireable set's own head count, so a list that ran out of room
 * can say how many roles it dropped rather than looking complete.
 */
export async function getProspectJobs(): Promise<JobPicker> {
  await requireStaff("/sourcing");

  const restClient = await createServerRestClient();
  const [rows, count] = await Promise.all([
    restClient
      .from("job_openings")
      .select("id, title, status")
      .in("status", [...HIREABLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(PICKER_LIMIT),
    restClient
      .from("job_openings")
      .select("id", { count: "exact", head: true })
      .in("status", [...HIREABLE_STATUSES]),
  ]);

  if (rows.error || count.error) {
    console.error(
      "[sourcing] opening picker failed:",
      (rows.error ?? count.error)?.message,
    );
  }

  return { jobs: (rows.data ?? []) as JobOption[], total: count.count ?? 0 };
}

export async function getProspectHistory(id: string): Promise<ProspectHistoryRow[]> {
  await requireStaff("/sourcing");

  const restClient = await createServerRestClient();
  const { data } = await restClient
    .from("communication_logs")
    .select("id, channel, subject, body, recipient, delivered, error_message, created_at")
    .eq("prospect_id", id)
    .in("channel", ["EMAIL", "WHATSAPP"])
    .order("created_at", { ascending: false })
    .limit(30);

  return (data ?? []) as ProspectHistoryRow[];
}

/**
 * Stored outreach copy, falling back to the text shipped in code.
 *
 * The board prefills its composer with this so what a recruiter edits before
 * sending is the same sentence the Settings template would have produced.
 */
export async function getOutreachCopy(): Promise<
  Record<OutreachChannel, { subject: string; body: string }>
> {
  await requireStaff("/sourcing");

  const restClient = await createServerRestClient();
  const { data } = await restClient
    .from("notification_templates")
    .select("key, subject, body")
    .in("key", Object.values(PROSPECT_OUTREACH_TEMPLATES))
    .eq("is_active", true);

  const rows = (data ?? []) as { key: string; subject: string | null; body: string }[];
  const find = (channel: OutreachChannel) =>
    rows.find((row) => row.key === PROSPECT_OUTREACH_TEMPLATES[channel]);

  const email = find("EMAIL");
  const whatsapp = find("WHATSAPP");

  return {
    EMAIL: {
      subject: email?.subject?.trim() || PROSPECT_OUTREACH_DEFAULTS.EMAIL.subject,
      body: email?.body?.trim() || PROSPECT_OUTREACH_DEFAULTS.EMAIL.body,
    },
    WHATSAPP: {
      subject: "",
      body: whatsapp?.body?.trim() || PROSPECT_OUTREACH_DEFAULTS.WHATSAPP.body,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportResult extends ProspectWriteResult {
  imported?: number;
  /** Rows already in the pool by profile URL or email. */
  existing?: number;
  /** Lines inside this paste that described the same person. */
  duplicates?: number;
  problems?: ProspectImportProblem[];
}

/**
 * Loads a pasted list of profiles.
 *
 * Parsing happens server-side as well as in the preview, because the preview is
 * a convenience and the database is the guarantee: a duplicate profile URL is
 * skipped here even when two different pastes produced it.
 */
export async function importProspects(input: {
  raw: string;
  origin: "LINKEDIN" | "CSV";
  job_id: string | null;
}): Promise<ImportResult> {
  const user = await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Manage candidates permission to import prospects." };
  }
  if (input.raw.length > 200_000) {
    return { ok: false, error: "That paste is too large. Import it in batches of a few hundred." };
  }

  const restClient = await createServerRestClient();

  // The chosen opening is quoted in every row's outreach copy, so a role nobody
  // is hiring for is refused before any row exists to advertise it.
  if (input.job_id) {
    const opening = await requireHireableOpening(restClient, input.job_id);
    if (!opening.ok) return { ok: false, error: opening.error };
  }

  const parsed = parseProspectImport(input.raw);
  if (parsed.drafts.length === 0) {
    return {
      ok: false,
      error:
        parsed.problems[0]?.reason ??
        "Nothing usable in that text. Paste one LinkedIn profile URL per line, or a CSV with a header row.",
      problems: parsed.problems,
    };
  }

  // Newest first, because a list re-imported days after the first paste is a
  // duplicate of rows near the top of the table, not of an arbitrary slice of it.
  const { data: current } = await restClient
    .from("sourced_prospects")
    .select("linkedin_url, email")
    .order("created_at", { ascending: false })
    .limit(DEDUPE_WINDOW);

  const known = new Set<string>();
  for (const row of (current ?? []) as { linkedin_url: string | null; email: string | null }[]) {
    const url = row.linkedin_url ? normalizeLinkedInUrl(row.linkedin_url) : null;
    if (url) known.add(url);
    if (row.email) known.add(row.email.toLowerCase());
  }

  const fresh = parsed.drafts.filter((draft) => {
    const urlKey = draft.linkedin_url;
    const emailKey = draft.email;
    return !(urlKey && known.has(urlKey)) && !(emailKey && known.has(emailKey));
  });

  if (fresh.length === 0) {
    return {
      ok: true,
      imported: 0,
      existing: parsed.drafts.length,
      duplicates: parsed.duplicates,
      problems: parsed.problems,
    };
  }

  const createdBy = await staffProfileId(restClient, user.authUserId);

  const { error } = await restClient.from("sourced_prospects").insert(
    fresh.map((draft) => ({
      full_name: draft.full_name,
      headline: draft.headline,
      company: draft.company,
      location: draft.location,
      email: draft.email,
      phone: draft.phone,
      linkedin_url: draft.linkedin_url,
      origin: input.origin,
      stage: "NEW",
      job_id: input.job_id,
      created_by: createdBy,
    }))
  );

  // 23505 is the unique profile-URL index: someone else imported the same list
  // while this paste was open.
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Some of those profiles are already in the pool. Refresh the list and import the rest.",
      };
    }
    return { ok: false, error: error.message };
  }

  const already = parsed.drafts.length - fresh.length;
  await recordActivity({
    area: "sourcing",
    action: "prospect_import",
    entity: "prospect",
    summary: `Imported ${fresh.length} ${
      input.origin === "CSV" ? "rows from a CSV" : "LinkedIn profiles"
    } into the sourcing pool${already > 0 ? `, ${already} already there` : ""}`,
    detail: {
      origin: input.origin,
      job_id: input.job_id,
      imported: fresh.length,
      already_in_pool: already,
      repeated_in_paste: parsed.duplicates,
    },
  });

  return {
    ok: true,
    imported: fresh.length,
    existing: parsed.drafts.length - fresh.length,
    duplicates: parsed.duplicates,
    problems: parsed.problems,
  };
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProspectDraftInput extends Partial<ProspectFields> {
  id?: string;
  /**
   * `CHATBOT` is written by the public careers assistant at `/api/careers/lead`,
   * never chosen here — but a recruiter editing one of those records saves the
   * whole row, so the name of where it came from has to survive the round trip.
   */
  origin?: "LINKEDIN" | "CSV" | "MANUAL" | "CHATBOT";
}

function cleanFields(input: ProspectDraftInput): ProspectWriteResult & { fields?: ProspectFields } {
  const fullName = input.full_name?.trim() ?? "";
  if (fullName.length < 2) {
    return { ok: false, error: "A prospect needs a name of at least two characters." };
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email)) {
    return { ok: false, error: "That email address is not valid." };
  }
  if (input.linkedin_url) {
    const url = normalizeLinkedInUrl(input.linkedin_url);
    if (!url) {
      return { ok: false, error: "Only a LinkedIn profile link (linkedin.com/in/…) fits here." };
    }
    input.linkedin_url = url;
  }

  return {
    ok: true,
    fields: {
      full_name: fullName.slice(0, 160),
      headline: input.headline?.trim().slice(0, 200) || null,
      company: input.company?.trim().slice(0, 160) || null,
      location: input.location?.trim().slice(0, 160) || null,
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      linkedin_url: input.linkedin_url ?? null,
      notes: input.notes?.trim().slice(0, 4000) || null,
      job_id: input.job_id || null,
    },
  };
}

/** Adds one prospect or edits an existing one — the drawer does both. */
export async function saveProspect(input: ProspectDraftInput): Promise<ProspectWriteResult & { id?: string }> {
  const user = await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Manage candidates permission." };
  }

  const cleaned = cleanFields(input);
  if (!cleaned.fields) return { ok: false, error: cleaned.error };

  const restClient = await createServerRestClient();

  if (input.id) {
    const { data: found, error: readError } = await restClient
      .from("sourced_prospects")
      .select("id, full_name, headline, company, location, email, phone, linkedin_url, notes, job_id, stage")
      .eq("id", input.id)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };
    if (!found) return { ok: false, error: "That prospect is no longer in the pool." };

    const before = found as unknown as Record<string, unknown>;
    const patch = prospectPayload(cleaned.fields);

    // The role a prospect is linked to is quoted in the letter they are sent, so
    // *moving* someone onto it means the role has to be one still hiring. An
    // unchanged link is not a move: a recruiter who only came to add a phone
    // number must not be refused because the opening this row was filed under
    // closed after the fact.
    const wanted = cleaned.fields.job_id ?? null;
    const current = (before.job_id as string | null) ?? null;
    if (wanted && wanted !== current) {
      const opening = await requireHireableOpening(restClient, wanted);
      if (!opening.ok) return { ok: false, error: opening.error };
    }

    const { error } = await restClient.from("sourced_prospects").update(patch).eq("id", input.id);
    if (error) return { ok: false, error: error.message };

    // The drawer always sends the whole row back, so the diff is what makes this
    // a record of an edit rather than a record of a save click.
    const edits = changedFields(before, patch);
    if (Object.keys(edits).length > 0) {
      await recordActivity({
        area: "sourcing",
        action: "prospect_edit",
        entity: "prospect",
        entityId: input.id,
        summary: `Updated ${String(before.full_name)} on the sourcing board — ${changePhrase(edits)}`,
        detail: { ...edits, stage: stageWord(String(before.stage ?? "NEW")) },
      });
    }
    return { ok: true, id: input.id };
  }

  // A hand-recorded prospect is a filing decision made now, so its role is
  // checked before the row exists rather than left to the picker's list.
  if (cleaned.fields.job_id) {
    const opening = await requireHireableOpening(restClient, cleaned.fields.job_id);
    if (!opening.ok) return { ok: false, error: opening.error };
  }

  const createdBy = await staffProfileId(restClient, user.authUserId);

  const { data, error } = await restClient
    .from("sourced_prospects")
    .insert({
      ...prospectPayload(cleaned.fields),
      origin: input.origin ?? "MANUAL",
      stage: "NEW",
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That profile is already in the pool." };
    }
    if (error.code === "23503") {
      return { ok: false, error: "The linked opening no longer exists — pick another." };
    }
    return { ok: false, error: error.message };
  }

  const id = String(data?.id ?? "");
  await recordActivity({
    area: "sourcing",
    action: "prospect_create",
    entity: "prospect",
    entityId: id,
    summary: `Added ${cleaned.fields.full_name} to the sourcing pool`,
    detail: {
      origin: input.origin ?? "MANUAL",
      stage: stageWord("NEW"),
      company: cleaned.fields.company,
      location: cleaned.fields.location,
      job_id: cleaned.fields.job_id,
      has_linkedin_url: Boolean(cleaned.fields.linkedin_url),
    },
  });

  return { ok: true, id };
}

export async function setProspectStage(id: string, stage: string): Promise<ProspectWriteResult> {
  await requireStaff("/sourcing");

  if (!STAGES.has(stage)) return { ok: false, error: "Unknown sourcing stage." };
  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Manage candidates permission." };
  }

  const restClient = await createServerRestClient();

  const { data: found, error: readError } = await restClient
    .from("sourced_prospects")
    .select("id, full_name, stage")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!found) return { ok: false, error: "That prospect is no longer in the pool." };

  const current = found as unknown as { id: string; full_name: string; stage: string };
  if (current.stage === stage) return { ok: true };

  const { error } = await restClient.from("sourced_prospects").update({ stage }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "sourcing",
    action: "prospect_stage",
    entity: "prospect",
    entityId: id,
    summary: `Moved ${current.full_name} from ${stageWord(current.stage)} to ${stageWord(stage)} on the sourcing board`,
    detail: { from: current.stage, to: stage },
  });

  return { ok: true };
}

export async function deleteProspect(id: string): Promise<ProspectWriteResult> {
  await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("candidates.delete"))) {
    return { ok: false, error: "You need the Delete candidates permission." };
  }

  const restClient = await createServerRestClient();

  // The name is read first: after the row is gone the trail would otherwise
  // record only a uuid, and "who deleted a prospect" could not be answered.
  const { data: found } = await restClient
    .from("sourced_prospects")
    .select("id, full_name, company, stage, application_id")
    .eq("id", id)
    .maybeSingle();
  if (!found) return { ok: true };

  const gone = found as unknown as {
    full_name: string;
    company: string | null;
    stage: string;
    application_id: string | null;
  };

  const { error } = await restClient.from("sourced_prospects").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await recordActivity({
    area: "sourcing",
    action: "prospect_delete",
    entity: "prospect",
    entityId: id,
    summary: `Removed ${gone.full_name}${gone.company ? ` from ${gone.company}` : ""} out of the sourcing pool`,
    detail: {
      company: gone.company,
      stage: gone.stage,
      application_id: gone.application_id,
      note: gone.application_id
        ? "Their application on the Candidates board was left alone."
        : "They had no application.",
    },
  });

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Outreach                                                                    */
/* -------------------------------------------------------------------------- */

export interface OutreachResult extends ProspectWriteResult {
  sent?: number;
  failed?: number;
  skipped?: number;
  /**
   * Openings the letters quoted by name that the group stopped hiring for.
   *
   * The send is not refused over it — a message is not a filing, and a recruiter
   * may legitimately reopen the role or rewrite the copy. The board's composer
   * warns before the send from the rows it already holds; this is the same warning
   * on the chat side, where the model only sees what the action returns.
   */
  closed_roles?: string[];
}

async function outreachVars(
  prospect: { full_name: string; job_title: string | null },
  companyName: string
): Promise<TemplateVars> {
  return {
    candidate_name: prospect.full_name,
    job_title: prospect.job_title ?? "one of our roles",
    company_name: companyName,
  };
}

type StaffClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * `sourced_prospects.created_by` references user_profiles(id), not auth.users(id),
 * so the signed-in user has to be resolved to their profile row first. Passing
 * the auth id straight would break the foreign key.
 */
async function staffProfileId(restClient: StaffClient, authUserId: string): Promise<string | null> {
  const { data } = await restClient
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function logOutbound(
  restClient: StaffClient,
  input: {
    prospectId: string;
    channel: OutreachChannel;
    recipient: string;
    subject?: string | null;
    body: string;
    delivered: boolean;
    error?: string | null;
  }
) {
  await restClient.from("communication_logs").insert({
    prospect_id: input.prospectId,
    channel: input.channel,
    direction: "OUTBOUND",
    recipient: input.recipient,
    subject: input.subject ?? null,
    body: input.body,
    delivered: input.delivered,
    error_message: input.error ?? null,
  });
}

/**
 * Sends a first touch to one or more prospects.
 *
 * Sent through the connectors directly rather than the candidate queue: this is
 * a recruiter pressing a button for named people, not a pipeline event, and the
 * bulk candidate action already behaves this way.
 */
export async function sendProspectOutreach(input: {
  ids: string[];
  channel: OutreachChannel;
  subject?: string;
  body: string;
}): Promise<OutreachResult> {
  await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("messages.send"))) {
    return { ok: false, error: "You need the Send messages permission." };
  }

  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: "Select at least one prospect." };
  if (ids.length > 200) return { ok: false, error: "Send to at most 200 prospects at a time." };

  const body = input.body?.trim();
  if (!body) return { ok: false, error: "The message cannot be empty." };

  const restClient = await createServerRestClient();
  const { data, error } = await restClient
    .from("sourced_prospects")
    .select("id, full_name, email, phone, stage, job_openings ( title, status )")
    .in("id", ids);

  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const companyName = await getStringSetting("organisation.name", "Sharm Dreams Group");
  const subject =
    input.channel === "EMAIL"
      ? (input.subject?.trim() || `A role at ${companyName}`)
      : null;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let firstError: string | undefined;
  /** The people a message actually reached — the rows the board moves on. */
  const touched: ProspectRow[] = [];
  /** Openings these letters quoted by name that nobody is hiring for. */
  const closedRoles = new Set<string>();

  for (const row of rows) {
    const prospect = toRow(row);
    if (prospect.job_id && prospect.job_status && !isHireable(prospect.job_status)) {
      closedRoles.add(
        openingOptionLabel(prospect.job_title ?? "an unnamed opening", prospect.job_status)
      );
    }
    const vars = await outreachVars(prospect, companyName);
    const text = renderTemplate(body, vars).trim();
    const letter = subject ? renderTemplate(subject, vars).trim() : null;

    const recipient = input.channel === "EMAIL" ? prospect.email : prospect.phone;
    if (!recipient) {
      skipped += 1;
      continue;
    }

    const outcome =
      input.channel === "EMAIL"
        ? await EmailConnector.send({ to: recipient, subject: letter ?? "", text })
        : await WhatsAppConnector.sendMessage(recipient, { text });

    if (outcome.success) {
      sent += 1;
      touched.push(prospect);
    } else {
      failed += 1;
      firstError ??= outcome.error;
    }

    await logOutbound(restClient, {
      prospectId: prospect.id,
      channel: input.channel,
      recipient,
      subject: letter,
      body: text,
      delivered: outcome.success,
      error: outcome.error ?? null,
    });
  }

  const contactedIds = touched.map((prospect) => prospect.id);

  if (contactedIds.length > 0) {
    const now = new Date().toISOString();
    // Every send stamps the date; only an untouched prospect moves to
    // CONTACTED, so a reply already on the board is never walked backwards.
    await restClient
      .from("sourced_prospects")
      .update({ last_contacted_at: now })
      .in("id", contactedIds);
    await restClient
      .from("sourced_prospects")
      .update({ stage: "CONTACTED" })
      .in("id", contactedIds)
      .eq("stage", "NEW");
  }

  // One row for the whole send, never one per prospect: a 200-name campaign that
  // wrote 200 trail rows would bury every other change of the day. The message
  // itself lives in `communication_logs` against each person, so the copy is not
  // lost — this row records that the pool was worked.
  if (sent + failed > 0) {
    const channelWord = input.channel === "EMAIL" ? "email" : "WhatsApp";
    const moved = touched.filter((prospect) => prospect.stage === "NEW").length;
    let trail =
      touched.length === 0
        ? `Tried ${failed} first ${channelWord} ${failed === 1 ? "touch" : "touches"} from the sourcing board — the channel refused them all`
        : touched.length === 1
          ? `Sent ${touched[0].full_name} a first ${channelWord} message`
          : `Sent first ${channelWord} messages to ${touched.length} prospects`;
    if (moved > 0) trail += `, moved ${moved} to ${stageWord("CONTACTED")}`;
    if (skipped > 0) {
      trail += `, skipped ${skipped} with no ${input.channel === "EMAIL" ? "email address" : "phone number"}`;
    }
    await recordActivity({
      area: "sourcing",
      action: "prospect_outreach",
      entity: "prospect",
      entityId: touched.length === 1 ? touched[0].id : null,
      summary: trail,
      detail: {
        channel: input.channel,
        sent: touched.length,
        refused: failed,
        skipped,
        moved_to_contacted: moved,
      },
    });
  }

  if (sent === 0) {
    if (skipped > 0 && failed === 0) {
      return {
        ok: false,
        error: `None of the selected prospects have ${input.channel === "EMAIL" ? "an email address" : "a phone number"} on file (${skipped} skipped).`,
        skipped,
      };
    }
    return { ok: false, error: firstError ?? "The channel refused every message.", failed, skipped };
  }

  return { ok: true, sent, failed, skipped, closed_roles: [...closedRoles] };
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turns a prospect into a real application.
 *
 * The person never applied, so the row is created on their behalf with source
 * LINKEDIN — which is what the pipeline's own filters read. No notification is
 * sent: a converted prospect has not agreed to anything yet beyond a
 * conversation, and the recruiter decides when to write to them.
 */
export async function convertProspect(input: {
  id: string;
  job_id: string;
}): Promise<ProspectWriteResult & { application_id?: string }> {
  await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Manage candidates permission." };
  }
  if (!input.job_id) return { ok: false, error: "Choose the opening to convert this prospect into." };

  const restClient = await createServerRestClient();

  const { data: found } = await restClient
    .from("sourced_prospects")
    .select("id, full_name, email, phone, stage, application_id, profile")
    .eq("id", input.id)
    .maybeSingle();

  const prospect = found as
    | {
        id: string;
        full_name: string;
        email: string | null;
        phone: string | null;
        stage: string;
        application_id: string | null;
        profile: unknown;
      }
    | null;

  if (!prospect) return { ok: false, error: "That prospect is no longer in the pool." };
  if (prospect.application_id) return { ok: false, error: "This prospect is already an application." };
  if (!prospect.email) {
    return {
      ok: false,
      error: "An application needs an email address. Add one to the prospect and convert again.",
    };
  }

  // A converted prospect never uploaded a CV, so the captured profile becomes
  // the document the screening step reads. Without a profile the application is
  // still created, exactly as it was before profile reading existed.
  const profile = prospect.profile ? normalizeProspectProfile(prospect.profile) : null;
  const cvText = profile && !profileIsEmpty(profile) ? renderProfileText(profile) : null;

  const opening = await requireHireableOpening(restClient, input.job_id);
  if (!opening.ok) return { ok: false, error: opening.error };

  const { data: created, error } = await restClient
    .from("applications")
    .insert({
      job_id: input.job_id,
      full_name: prospect.full_name,
      email: prospect.email,
      phone: prospect.phone,
      cv_text: cvText,
      source: "LINKEDIN",
      stage: "NEW",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "They already have a live application for that opening — it is on the Candidates board.",
      };
    }
    return { ok: false, error: error.message };
  }

  const applicationId = String(created?.id ?? "");
  const { error: linkError } = await restClient
    .from("sourced_prospects")
    .update({ application_id: applicationId, job_id: input.job_id, stage: "CONVERTED" })
    .eq("id", prospect.id);

  if (linkError) return { ok: false, error: linkError.message };

  let skills = 0;
  if (profile && profile.skills.length > 0) skills = await recordSkills(restClient, applicationId, profile);

  // Filed against the application, not the prospect: the converted person now
  // lives on the Candidates board, and that is where their history is read from.
  await recordActivity({
    area: "sourcing",
    action: "prospect_convert",
    entity: "application",
    entityId: applicationId,
    summary: `Converted ${prospect.full_name} out of the sourcing pool into an application for “${opening.title}”${cvText ? ", with their saved profile in place of a CV" : ""}`,
    detail: {
      prospect_id: prospect.id,
      job_id: input.job_id,
      source: "LINKEDIN",
      from_stage: prospect.stage,
      to_stage: stageWord("CONVERTED"),
      profile_carried: Boolean(cvText),
      skills_recorded: skills,
    },
  });

  // The new row lives on the Candidates board, which this mutation did not
  // trigger a refresh for, so tell the router that page is no longer current.
  revalidatePath("/candidates");
  revalidatePath("/sourcing");
  return { ok: true, application_id: applicationId };
}

/**
 * Copies the profile's skills onto the new application.
 *
 * `candidate_skills.skill_id` points at the seeded `skills` table, so only the
 * names the catalogue already knows are written — a profile skill with no
 * catalogue row is dropped rather than inventing master data on a convert click.
 * The rest still travels to the screening step through the rendered CV text.
 *
 * A failure here is not a failed conversion: the application exists, so the
 * board reports it and the skills are simply missing.
 */
async function recordSkills(
  restClient: StaffClient,
  applicationId: string,
  profile: ProspectProfile
): Promise<number> {
  const { data: catalogue } = await restClient.from("skills").select("id, name").eq("is_active", true);

  const rows = matchCatalogueSkills(profile, (catalogue ?? []) as { id: string; name: string }[]);
  if (rows.length === 0) return 0;

  await restClient.from("candidate_skills").insert(
    rows.map((row) => ({
      application_id: applicationId,
      skill_id: row.id,
      source: "SOURCED_PROFILE",
    }))
  );

  return rows.length;
}
