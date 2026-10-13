"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { EmailConnector } from "@/modules/omnichannel/infrastructure/emailConnector";
import { WhatsAppConnector } from "@/modules/omnichannel/infrastructure/connectors";
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

/**
 * Server actions behind the Sourcing board.
 *
 * A prospect is not a candidate: these rows have no tracking code and no portal
 * access, so nothing here touches `applications` until a recruiter explicitly
 * converts one. Every write goes through the session's RLS-scoped client rather
 * than the service role, so the `candidates.write` grant is the real gate and
 * not just a check the UI performs.
 */

/** Sourcing ladder — see the `stage` check constraint in migration 017. */
const PROSPECT_STAGES = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "INTERVIEW",
  "CONVERTED",
  "PASSED",
] as const;

export type ProspectStage = (typeof PROSPECT_STAGES)[number];

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

interface ProspectWriteResult {
  ok: boolean;
  error?: string;
}

const PROSPECT_SELECT = `
  id, full_name, headline, company, location, email, phone, linkedin_url, notes,
  origin, stage, job_id, application_id, last_contacted_at, created_at,
  job_openings ( title ),
  communication_logs ( channel )
`;

const STAGES = new Set<string>(PROSPECT_STAGES);

function toRow(row: Record<string, unknown>): ProspectRow {
  const job = row.job_openings as { title?: string } | { title?: string }[] | null;
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

export async function getProspects(): Promise<ProspectRow[]> {
  await requireStaff("/sourcing");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sourced_prospects")
    .select(PROSPECT_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return [];
  return (data ?? []).map((row) => toRow(row as unknown as Record<string, unknown>));
}

/** Openings a prospect can be linked to or converted against. */
export async function getProspectJobs(): Promise<JobOption[]> {
  await requireStaff("/sourcing");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("job_openings")
    .select("id, title, status")
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []) as JobOption[];
}

export async function getProspectHistory(id: string): Promise<ProspectHistoryRow[]> {
  await requireStaff("/sourcing");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
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

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
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

  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("sourced_prospects")
    .select("linkedin_url, email")
    .limit(5000);

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

  const createdBy = await staffProfileId(supabase, user.authUserId);

  const { error } = await supabase.from("sourced_prospects").insert(
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
  origin?: "LINKEDIN" | "CSV" | "MANUAL";
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

  const supabase = await createSupabaseServerClient();

  if (input.id) {
    const { error } = await supabase
      .from("sourced_prospects")
      .update(prospectPayload(cleaned.fields))
      .eq("id", input.id);
    return error ? { ok: false, error: error.message } : { ok: true, id: input.id };
  }

  const createdBy = await staffProfileId(supabase, user.authUserId);

  const { data, error } = await supabase
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

  return { ok: true, id: String(data?.id ?? "") };
}

export async function setProspectStage(id: string, stage: string): Promise<ProspectWriteResult> {
  await requireStaff("/sourcing");

  if (!STAGES.has(stage)) return { ok: false, error: "Unknown sourcing stage." };
  if (!(await hasPermissionForUser("candidates.write"))) {
    return { ok: false, error: "You need the Manage candidates permission." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sourced_prospects").update({ stage }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteProspect(id: string): Promise<ProspectWriteResult> {
  await requireStaff("/sourcing");

  if (!(await hasPermissionForUser("candidates.delete"))) {
    return { ok: false, error: "You need the Delete candidates permission." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sourced_prospects").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Outreach                                                                    */
/* -------------------------------------------------------------------------- */

export interface OutreachResult extends ProspectWriteResult {
  sent?: number;
  failed?: number;
  skipped?: number;
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

type StaffClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * `sourced_prospects.created_by` references user_profiles(id), not auth.users(id),
 * so the signed-in user has to be resolved to their profile row first. Passing
 * the auth id straight would break the foreign key.
 */
async function staffProfileId(supabase: StaffClient, authUserId: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function logOutbound(
  supabase: StaffClient,
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
  await supabase.from("communication_logs").insert({
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sourced_prospects")
    .select("id, full_name, email, phone, stage, job_openings ( title )")
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
  const contacted: string[] = [];

  for (const row of rows) {
    const prospect = toRow(row);
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
      contacted.push(prospect.id);
    } else {
      failed += 1;
      firstError ??= outcome.error;
    }

    await logOutbound(supabase, {
      prospectId: prospect.id,
      channel: input.channel,
      recipient,
      subject: letter,
      body: text,
      delivered: outcome.success,
      error: outcome.error ?? null,
    });
  }

  if (contacted.length > 0) {
    const now = new Date().toISOString();
    // Every send stamps the date; only an untouched prospect moves to
    // CONTACTED, so a reply already on the board is never walked backwards.
    await supabase
      .from("sourced_prospects")
      .update({ last_contacted_at: now })
      .in("id", contacted);
    await supabase
      .from("sourced_prospects")
      .update({ stage: "CONTACTED" })
      .in("id", contacted)
      .eq("stage", "NEW");
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

  return { ok: true, sent, failed, skipped };
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

  const supabase = await createSupabaseServerClient();

  const { data: found } = await supabase
    .from("sourced_prospects")
    .select("id, full_name, email, phone, application_id")
    .eq("id", input.id)
    .maybeSingle();

  const prospect = found as
    | { id: string; full_name: string; email: string | null; phone: string | null; application_id: string | null }
    | null;

  if (!prospect) return { ok: false, error: "That prospect is no longer in the pool." };
  if (prospect.application_id) return { ok: false, error: "This prospect is already an application." };
  if (!prospect.email) {
    return {
      ok: false,
      error: "An application needs an email address. Add one to the prospect and convert again.",
    };
  }

  const { data: created, error } = await supabase
    .from("applications")
    .insert({
      job_id: input.job_id,
      full_name: prospect.full_name,
      email: prospect.email,
      phone: prospect.phone,
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
  const { error: linkError } = await supabase
    .from("sourced_prospects")
    .update({ application_id: applicationId, job_id: input.job_id, stage: "CONVERTED" })
    .eq("id", prospect.id);

  if (linkError) return { ok: false, error: linkError.message };
  return { ok: true, application_id: applicationId };
}
