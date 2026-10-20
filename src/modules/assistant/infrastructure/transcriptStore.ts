import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AssistantEngine } from "@/modules/assistant/domain/engine";
import { MAX_HISTORY_ATTACHMENT_CHARS } from "@/modules/assistant/domain/attachments";
import { withoutStepFileBytes, type AssistantStep } from "@/modules/assistant/infrastructure/agent";

/**
 * Saved assistant conversations.
 *
 * Every statement here runs on the signed-in staff member's own client, so Row
 * Level Security decides what is readable and writable — a session belongs to one
 * recruiter and other admins cannot see it, which is why no query in this file
 * filters by owner. The callers are server actions that have already passed
 * `requireStaff`.
 *
 * Nothing in here throws at the chat. A conversation that cannot be stored (the
 * tables are not applied yet, the network is down, the session was deleted from
 * under the panel) is still a real answer, so it is returned as an honest
 * "not saved" and the recruiter keeps what the model gave them.
 */

export interface AssistantSessionSummary {
  id: string;
  title: string;
  engine: AssistantEngine | null;
  updatedAt: string;
  messageCount: number;
}

export interface StoredAssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: AssistantStep[];
  model: string | null;
  provider: string | null;
  note: string | null;
  attachmentName: string | null;
  attachmentText: string | null;
}

export type SaveTurnResult = { ok: true; sessionId: string } | { ok: false; error: string };

/** Session titles are a label in a list, not a copy of the question. */
const MAX_TITLE_CHARS = 80;

type Row = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function titleFrom(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (!flat) return "New conversation";
  return flat.length > MAX_TITLE_CHARS ? `${flat.slice(0, MAX_TITLE_CHARS - 1)}…` : flat;
}

function stepsFrom(value: unknown): AssistantStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (step): step is AssistantStep =>
      typeof step === "object" && step !== null && typeof (step as Row).tool === "string"
  );
}

/** The signed-in staff member's `user_profiles` row, which owns the session. */
async function currentProfileId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Stores one exchange — the question and the answer it produced — and returns the
 * session it now belongs to, creating that session from the question when the
 * panel does not have one yet.
 */
export async function saveAssistantTurn(input: {
  sessionId: string | null;
  engine: AssistantEngine;
  prompt: string;
  attachment?: { name: string; text: string } | null;
  reply: string;
  steps: AssistantStep[];
  model: string;
  provider: string;
  note?: string | null;
}): Promise<SaveTurnResult> {
  const ownerId = await currentProfileId();
  if (!ownerId) return { ok: false, error: "No staff profile is attached to this session." };

  const supabase = await createSupabaseServerClient();

  let sessionId = input.sessionId;
  if (sessionId) {
    const { data: existing } = await supabase
      .from("assistant_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    // Either it was deleted or it belongs to someone else; appending to either
    // would put this recruiter's question where they cannot read it back.
    if (!existing) return { ok: false, error: "That conversation no longer exists." };
  } else {
    const { data: created, error } = await supabase
      .from("assistant_sessions")
      .insert({ owner_id: ownerId, title: titleFrom(input.prompt), engine: input.engine })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: error?.message ?? "The conversation could not be started." };
    }
    sessionId = asString((created as Row).id);
  }

  // Both stamps are set here rather than left to `now()`: a restored transcript
  // is ordered by `created_at`, and a question and its answer inserted in the
  // same millisecond would come back in either order.
  const askedAt = new Date();
  const answeredAt = new Date(askedAt.getTime() + 1);

  // Every row carries every column. In a bulk insert PostgREST takes the column
  // list from the first object, so a key only the second row has — `steps`,
  // `model`, `note` — would be dropped on the way in and hit a not-null column.
  const rows: Row[] = [
    {
      session_id: sessionId,
      owner_id: ownerId,
      role: "user",
      content: input.prompt,
      steps: [],
      model: null,
      provider: null,
      note: null,
      attachment_name: input.attachment?.name ?? null,
      // The same number an earlier turn's file still contributes to a live
      // question, so reopening a thread gives the model what it was given then.
      attachment_text: input.attachment
        ? input.attachment.text.slice(0, MAX_HISTORY_ATTACHMENT_CHARS)
        : null,
      created_at: askedAt.toISOString(),
    },
    {
      session_id: sessionId,
      owner_id: ownerId,
      role: "assistant",
      content: input.reply,
      steps: withoutStepFileBytes(input.steps ?? []),
      model: input.model,
      provider: input.provider,
      note: input.note ?? null,
      attachment_name: null,
      attachment_text: null,
      created_at: answeredAt.toISOString(),
    },
  ];

  const { error: inserted } = await supabase.from("assistant_messages").insert(rows);
  if (inserted) return { ok: false, error: inserted.message };

  // Touches the row so the history rail orders this conversation to the top and
  // remembers the engine the recruiter last chose for it.
  await supabase
    .from("assistant_sessions")
    .update({ engine: input.engine, updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  return { ok: true, sessionId };
}

/**
 * Records what an approval click actually did, as its own turn in the thread.
 *
 * The chat cannot be the only place this exists. An approved change that lived
 * only in component state would come back tomorrow as a conversation ending on
 * "waiting for your approval" — and a recruiter who then asks the assistant about
 * that candidate would be answered from a transcript that says the change never
 * happened.
 */
export async function appendApprovalOutcome(input: {
  sessionId: string;
  reply: string;
  steps: AssistantStep[];
}): Promise<SaveTurnResult> {
  const ownerId = await currentProfileId();
  if (!ownerId) return { ok: false, error: "No staff profile is attached to this session." };

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("assistant_sessions")
    .select("id")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That conversation no longer exists." };

  const { error } = await supabase.from("assistant_messages").insert({
    session_id: input.sessionId,
    owner_id: ownerId,
    role: "assistant",
    content: input.reply,
    steps: input.steps,
    model: null,
    provider: null,
    note: null,
    attachment_name: null,
    attachment_text: null,
    created_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };

  await supabase
    .from("assistant_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.sessionId);

  return { ok: true, sessionId: input.sessionId };
}

/** The recruiter's conversations, most recently spoken in first. */
export async function listAssistantSessions(limit = 60): Promise<AssistantSessionSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("assistant_sessions")
    .select("id, title, engine, updated_at, assistant_messages(count)")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("listAssistantSessions failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const embedded = row.assistant_messages as { count?: number }[] | null;
    return {
      id: asString(row.id),
      title: asString(row.title, "New conversation"),
      engine:
        row.engine === "auto" || row.engine === "qoder" || row.engine === "gateway"
          ? row.engine
          : null,
      updatedAt: asString(row.updated_at),
      messageCount: embedded?.[0]?.count ?? 0,
    };
  });
}

/** One conversation in full, oldest turn first. Null when it is not readable. */
export async function readAssistantSession(
  sessionId: string
): Promise<{ title: string; engine: AssistantEngine | null; messages: StoredAssistantMessage[] } | null> {
  const supabase = await createSupabaseServerClient();

  const { data: session } = await supabase
    .from("assistant_sessions")
    .select("id, title, engine")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;

  const { data, error } = await supabase
    .from("assistant_messages")
    .select(
      "id, role, content, steps, model, provider, note, attachment_name, attachment_text, created_at"
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(400);

  if (error) {
    console.error("readAssistantSession failed:", error.message);
    return null;
  }

  const engine = (session as Row).engine;
  return {
    title: asString((session as Row).title, "New conversation"),
    engine:
      engine === "auto" || engine === "qoder" || engine === "gateway" ? engine : null,
    messages: ((data ?? []) as unknown as Row[]).map((row) => ({
      id: asString(row.id),
      role: row.role === "user" ? "user" : "assistant",
      content: asString(row.content),
      steps: stepsFrom(row.steps),
      model: typeof row.model === "string" ? row.model : null,
      provider: typeof row.provider === "string" ? row.provider : null,
      note: typeof row.note === "string" ? row.note : null,
      attachmentName: typeof row.attachment_name === "string" ? row.attachment_name : null,
      attachmentText: typeof row.attachment_text === "string" ? row.attachment_text : null,
    })),
  };
}

/** Renames a conversation. False when it is not one the caller can write. */
export async function renameAssistantSession(sessionId: string, title: string): Promise<boolean> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  if (!clean) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assistant_sessions")
    .update({ title: clean })
    .eq("id", sessionId)
    .select("id");

  return !error && (data?.length ?? 0) > 0;
}

/** Deletes a conversation; its messages go with it. */
export async function deleteAssistantSession(sessionId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assistant_sessions")
    .delete()
    .eq("id", sessionId)
    .select("id");

  return !error && (data?.length ?? 0) > 0;
}
