import { getSupabaseServiceClient } from "@/lib/data-api/service";
import { recordActivity } from "@/modules/activity/application/record";
import { parseTurns, renderTranscript, type ChatTurn } from "@/modules/careers/chatbot/conversation";
import { getPublicJob } from "@/app/careers/actions";

/**
 * A visitor asks the careers assistant to be remembered.
 *
 * What lands here is a lead, not an application: no CV was read, no viability
 * question was answered and nothing has been screened, so the row goes to the
 * sourcing pool — the board recruiters already use for people worth working on
 * who have not applied — with the conversation in its notes. Converting it into
 * a real application stays a recruiter's decision, made with the form the
 * candidate still has to fill.
 *
 * One person, one row. The owner has been explicit that a candidate must not be
 * filed twice, so a returning email updates the existing chatbot lead rather
 * than adding a second copy of the same person to the pool.
 *
 * The service role writes this, as the application submit does: the insert is
 * validated here (a published role, a shaped email, a bounded transcript), and
 * reading the row back is not something an anonymous caller should be able to do.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NOTES_CHARS = 4000;

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Could not read that request.");
  }

  const input = body as {
    jobId?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    messages?: unknown;
  };

  const fullName = typeof input.name === "string" ? input.name.trim().slice(0, 160) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 160) : "";
  const phone = typeof input.phone === "string" ? input.phone.trim().slice(0, 40) : "";

  if (fullName.length < 2) return bad("Enter your full name.");
  if (!email && !phone) return bad("Leave an email address or a phone number to be reached on.");
  if (email && !EMAIL.test(email)) return bad("That email address does not look right.");

  // An absent or empty transcript is allowed — someone may fill the details in
  // without asking anything — but a malformed one is refused rather than
  // half-saved. Whatever the panel holds is stored as it stands, including the
  // assistant's last answer, which is how a real conversation ends.
  let turns: ChatTurn[] | null = null;
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    turns = parseTurns(input.messages, { requireQuestion: false });
    if (!turns) return bad("That conversation could not be read. Try again.");
  }

  const jobId = typeof input.jobId === "string" && UUID.test(input.jobId) ? input.jobId : null;

  let jobTitle: string | null = null;
  if (jobId) {
    const job = await getPublicJob(jobId);
    if (!job) return bad("This role is no longer accepting applications.", 404);
    jobTitle = job.title;
  }

  const notes = [
    turns
      ? renderTranscript(turns)
      : "Details left on the careers page without a conversation with the assistant.",
    jobTitle ? `\n\nRole asked about: ${jobTitle}` : "",
  ]
    .join("")
    .slice(0, NOTES_CHARS);

  const supabase = getSupabaseServiceClient();

  // Only an email identifies a person here: plenty of visitors leave a phone and
  // nothing else, and matching those on an empty string would merge strangers.
  const { data: prior } = email
    ? await supabase
        .from("sourced_prospects")
        .select("id, full_name, stage")
        .eq("origin", "CHATBOT")
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const existing = prior as { id: string; full_name: string; stage: string } | null;
  const patch = {
    full_name: fullName,
    email: email || null,
    phone: phone || null,
    notes,
    job_id: jobId,
    updated_at: new Date().toISOString(),
  };

  let id: string | null = null;

  if (existing) {
    const { data: updated, error } = await supabase
      .from("sourced_prospects")
      .update(patch)
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();
    if (error || !updated) {
      console.error("[careers] chatbot lead update failed:", error?.message ?? "no row returned");
      return bad("Your details could not be saved. Please use the application form.", 500);
    }
    id = (updated as { id: string }).id;
  } else {
    const { data: created, error } = await supabase
      .from("sourced_prospects")
      .insert({ ...patch, origin: "CHATBOT", stage: "NEW" })
      .select("id")
      .maybeSingle();
    if (error || !created) {
      console.error("[careers] chatbot lead insert failed:", error?.message ?? "no row returned");
      return bad("Your details could not be saved. Please use the application form.", 500);
    }
    id = (created as { id: string }).id;
  }

  if (id) {
    await recordActivity({
      actorKind: "CANDIDATE",
      actorLabel: fullName,
      via: "career site",
      area: "sourcing",
      action: existing ? "chatbot_lead_updated" : "chatbot_lead",
      entity: "prospect",
      entityId: id,
      summary: `${fullName} left their details with the careers assistant${
        jobTitle ? ` about ${jobTitle}` : ""
      }${turns ? `, after ${turns.filter((t) => t.role === "candidate").length} question${
        turns.filter((t) => t.role === "candidate").length === 1 ? "" : "s"
      }` : ""}`,
      detail: {
        origin: "CHATBOT",
        email: email || null,
        phone: phone || null,
        job_id: jobId,
        turns: turns?.length ?? 0,
        repeated: Boolean(existing),
      },
    });
  }

  return Response.json(
    { ok: true, repeated: Boolean(existing) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
