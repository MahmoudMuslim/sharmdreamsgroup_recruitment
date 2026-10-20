"use server";

import { requireStaff } from "@/lib/auth/session";
import { withActivityContext } from "@/modules/activity/application/record";
import {
  runApprovedChange,
  runAssistantTurn,
  type AssistantStep,
  type AssistantTurn,
} from "@/modules/assistant/infrastructure/agent";
import {
  qoderEngineStatus,
  runQoderAssistantTurn,
} from "@/modules/assistant/infrastructure/qoderAgent";
import {
  appendApprovalOutcome,
  deleteAssistantSession,
  listAssistantSessions,
  readAssistantSession,
  renameAssistantSession,
  saveAssistantTurn,
  type AssistantSessionSummary,
  type StoredAssistantMessage,
} from "@/modules/assistant/infrastructure/transcriptStore";
import { isAssistantEngine, type AssistantEngine } from "@/modules/assistant/domain/engine";
import { ASSISTANT_TOOLS } from "@/modules/assistant/domain/tools";
import { requiresApproval, takeApproval } from "@/modules/assistant/domain/approvals";
import { resolveModelRouting } from "@/modules/settings/infrastructure/credentialResolver";
import { getModelCatalogue } from "@/modules/settings/application/credential-actions";
import {
  CvExtractionError,
  describeExtractionFailure,
  extractCvText,
} from "@/modules/screening/infrastructure/cvParser";
import type { ChatCompletionMessage } from "@/types";

/**
 * The assistant's single entry point.
 *
 * Auth is checked here and again inside every tool, because the tools are the
 * existing screen actions and they do not trust their caller. What this layer
 * adds is sanitising the transcript: the client owns the history it sends, so
 * system messages are dropped and the rest is clipped before any of it reaches
 * a model or a tool.
 *
 * Two engines sit behind it. When a Qoder token is stored, the turn runs on the
 * Qoder agent, which calls the portal tools natively. Otherwise, or when that
 * runtime cannot be reached, the same tools are driven through the completion
 * gateway's JSON protocol, so a Qoder outage degrades the assistant instead of
 * switching it off.
 *
 * A finished turn is stored as a saved conversation (see `transcriptStore`),
 * which is what lets a recruiter close the panel and pick the question up
 * tomorrow — from the dock or from the Assistant page.
 */

export interface AssistantReply {
  ok: boolean;
  error?: string;
  reply?: string;
  steps?: AssistantStep[];
  model?: string;
  provider?: string;
  /** Set when the preferred engine failed and the other one answered instead. */
  note?: string;
  /** The saved conversation this turn went into — null while nothing is stored. */
  sessionId?: string;
  /** Why the turn was not saved. The answer above it is still real. */
  saveError?: string;
}

export interface AssistantCapability {
  name: string;
  label: string;
  description: string;
  destructive: boolean;
  /** True for every entry that changes data: it waits for a click before it runs. */
  needsApproval: boolean;
}

export interface OpenedAssistantSession {
  title: string;
  engine: AssistantEngine | null;
  messages: StoredAssistantMessage[];
}

/**
 * Which engine the recruiter wants for this turn. See
 * `@/modules/assistant/domain/engine` — the same choice is stored on the session.
 */
export type { AssistantEngine, AssistantSessionSummary, StoredAssistantMessage };

export interface AssistantAttachment {
  name: string;
  text: string;
}

/** Turns kept from the client's transcript — enough for context, not for a novel. */
const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 4000;
/** Long enough for any real routing id, short enough that a stuffed one is refused. */
const MAX_MODEL_ID_CHARS = 160;
/**
 * The shape every provider publishes its ids in — `vendor/name:variant`, a bare
 * Google name, or a `provider:`-prefixed routing id. Nothing that could steer a
 * request somewhere else (a space, a `?`, a slash-dot) is allowed through.
 */
const MODEL_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
/** An approval id is a `randomUUID`, so anything else was never issued by this server. */
const APPROVAL_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An attached document is read, not stored; this is the part the model sees. */
const MAX_ATTACHMENT_CHARS = 12_000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function normalizeMimeType(name: string, declared: string): string {
  const kind = declared.trim().toLowerCase();
  // The parser speaks PDF, Word and plain text. A .md file is plain text under a
  // different label, and browsers are inconsistent about which label they send
  // for one, so markdown is folded onto text/plain here rather than in the
  // shared CV parser, which the screening path depends on.
  if (kind === "text/markdown" || /\.(md|txt)$/i.test(name)) return "text/plain";
  if (kind && ATTACHMENT_MIME_TYPES.has(kind)) return kind;
  return kind || "";
}

/**
 * The recruiter's question, with the attached document's text underneath it.
 *
 * Fenced so the model reads the file as material rather than as instructions,
 * which matters because its content is whatever somebody uploaded.
 */
function composePrompt(prompt: string, attachment?: AssistantAttachment): string {
  const text = typeof attachment?.text === "string" ? attachment.text.trim() : "";
  if (!text) return prompt;

  const clipped = text.slice(0, MAX_ATTACHMENT_CHARS);
  const omitted =
    text.length > clipped.length
      ? `\n[… ${attachment?.name ?? "file"}: ${text.length - clipped.length} more characters not shown]`
      : "";

  return `${prompt}\n\nAttached file “${attachment?.name ?? "file"}” — extracted text:\n"""\n${clipped}${omitted}\n"""`;
}

function sanitize(history: unknown): ChatCompletionMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY)
    .filter(
      (message): message is { role: string; content: string } =>
        typeof message === "object" &&
        message !== null &&
        typeof (message as { content?: unknown }).content === "string" &&
        // A system message from the browser would be the client writing the
        // assistant's own instructions, so only the two conversational roles pass.
        ((message as { role?: unknown }).role === "user" ||
          (message as { role?: unknown }).role === "assistant")
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      // A user turn that carried an attachment arrives with that text in it.
      content: message.content.slice(0, MAX_MESSAGE_CHARS + MAX_ATTACHMENT_CHARS),
    }))
    .filter((message) => message.content.trim().length > 0);
}

/**
 * Reads a file the recruiter attached and returns the text the model will see.
 *
 * Extraction is the same PDF/Word/plain-text path the screening engine uses, so
 * a CV parsed here reads the same as one parsed on apply. Nothing is stored —
 * the text lives in this request and in the chat history the next turn sends.
 */
export async function extractAssistantAttachmentText(
  formData: FormData
): Promise<{ ok: boolean; error?: string; name?: string; text?: string }> {
  await requireStaff("/dashboard");

  const entry = formData.get("file");
  if (!(entry instanceof File)) return { ok: false, error: "No file was received." };
  if (entry.size === 0) return { ok: false, error: "That file is empty." };
  if (entry.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is larger than 8 MB." };

  const mimeType = normalizeMimeType(entry.name, entry.type);
  if (!ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "Attach a PDF, Word document, .txt or .md file." };
  }

  try {
    const extracted = await extractCvText(Buffer.from(await entry.arrayBuffer()), mimeType);
    const text = extracted.text.trim().slice(0, MAX_ATTACHMENT_CHARS);
    if (text.length < 40) {
      return {
        ok: false,
        error:
          "No readable text could be taken from that file — a scanned PDF has no text layer, " +
          "so paste the important parts into the chat instead.",
      };
    }
    return { ok: true, name: entry.name, text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof CvExtractionError ? error.message : describeExtractionFailure(error),
    };
  }
}

export async function sendAssistantMessage(input: {
  history: ChatCompletionMessage[];
  prompt: string;
  allowDestructive: boolean;
  /**
   * Opens the two lookups that leave the portal. They are the portal's own —
   * search_web and read_web_page — so whichever engine answers the turn, the
   * Qoder runtime's own WebSearch and WebFetch are lifted as well.
   */
  allowWeb: boolean;
  engine?: AssistantEngine;
  /**
   * A model chosen for this conversation, tried on its own instead of through
   * the routing table. Nothing in Settings is written by it, and it applies to
   * the gateway engine, which is the one that takes a model id.
   */
  model?: string | null;
  attachment?: AssistantAttachment;
  /** The saved conversation to append to; a first turn with none starts one. */
  sessionId?: string | null;
}): Promise<AssistantReply> {
  const staff = await requireStaff("/dashboard");

  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "Ask me something first." };
  if (prompt.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Keep the question under ${MAX_MESSAGE_CHARS} characters.` };
  }

  let engine: AssistantEngine = isAssistantEngine(input.engine) ? input.engine : "auto";

  const chosen = typeof input.model === "string" ? input.model.trim() : "";
  if (chosen && (chosen.length > MAX_MODEL_ID_CHARS || !MODEL_ID_SHAPE.test(chosen))) {
    return { ok: false, error: "That is not a model id this portal can call." };
  }
  const model = chosen || null;

  // Qoder runs on its own model and takes no direction from the catalogue, so a
  // chosen model has to be served by the gateway. Saying nothing here would let
  // the recruiter believe the engine they left selected answered.
  let modelNote: string | undefined;
  if (model && engine !== "gateway") {
    modelNote = `${model} answers through the model gateway — the Qoder engine picks its own model and cannot be pointed at one.`;
    engine = "gateway";
  }

  const history: ChatCompletionMessage[] = [
    ...sanitize(input.history),
    {
      role: "user",
      content: composePrompt(prompt, input.attachment).slice(
        0,
        MAX_MESSAGE_CHARS + MAX_ATTACHMENT_CHARS
      ),
    },
  ];

  const allowDestructive = input.allowDestructive === true;
  const allowWeb = input.allowWeb === true;

  try {
    let turn: AssistantTurn | null = null;
    let note: string | undefined = modelNote ?? undefined;

    if (engine !== "gateway") {
      const status = await qoderEngineStatus();
      if (!status.ok) {
        if (engine === "qoder") {
          return { ok: false, error: `Qoder could not serve this turn: ${status.reason}.` };
        }
        // A missing token is what "Auto" already says it works around, so the
        // gateway simply answers. A host that cannot run the runtime is different:
        // the key is stored and Qoder was clearly intended, so the recruiter is
        // told which engine actually answered.
        if (status.hostCannotRun) {
          note = `Qoder was not tried (${status.reason}); answered through the model gateway instead.`;
        }
      } else {
        try {
          turn = await withActivityContext({ via: "assistant" }, () =>
            runQoderAssistantTurn(history, allowDestructive, allowWeb, staff.profileId)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (engine === "qoder") {
            return { ok: false, error: `Qoder could not serve this turn: ${message}` };
          }
          note = `Qoder could not serve this turn (${message}); answered through the model gateway instead.`;
        }
      }
    }

    if (!turn) {
      try {
        turn = await withActivityContext({ via: "assistant" }, () =>
          runAssistantTurn(history, allowDestructive, staff.profileId, model, allowWeb)
        );
      } catch (error) {
        // The gateway's own message already names the models it tried and why each
        // failed, which is what an operator needs when no key is configured.
        const gatewayError =
          error instanceof Error ? error.message : "The assistant could not be reached.";
        throw new Error(note ? `${note} ${gatewayError}` : gatewayError);
      }
    }

    // Nothing is said here about the web switch, because there is nothing left to
    // warn about: the lookups are the portal's own, so whichever engine answered
    // could search. A search that could not run refuses in its own chip, with the
    // provider's reason in it, and the rules make the assistant report that refusal.

    const saved = await saveAssistantTurn({
      sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
      engine,
      prompt,
      attachment: input.attachment,
      reply: turn.reply,
      steps: turn.steps,
      model: turn.model,
      provider: turn.provider,
      note,
    });

    return {
      ok: true,
      reply: turn.reply,
      steps: turn.steps,
      model: turn.model,
      provider: turn.provider,
      note,
      sessionId: saved.ok ? saved.sessionId : undefined,
      // Saying nothing here would leave the recruiter believing a conversation
      // they cannot open tomorrow is in fact saved.
      saveError: saved.ok ? undefined : saved.error,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The assistant could not be reached.",
    };
  }
}

/**
 * The recruiter's click on an approval card: run the one change it held.
 *
 * Nothing the browser can edit selects what happens. The id looks up arguments
 * this process kept when the card was raised, so a tampered or replayed click
 * cannot ask for a different record, and a used id has nothing left to run.
 *
 * A click that finds no approval says so out loud rather than doing nothing
 * quietly: an applied-looking card whose change never landed is the exact false
 * claim this gate exists to prevent, and it is what happens on a host that starts
 * a fresh isolate per request.
 */
export async function approveAssistantChange(input: {
  approvalId: string;
  sessionId?: string | null;
}): Promise<AssistantReply> {
  const staff = await requireStaff("/dashboard");

  const id = typeof input?.approvalId === "string" ? input.approvalId.trim() : "";
  if (!APPROVAL_ID_SHAPE.test(id)) {
    return { ok: false, error: "That is not an approval this assistant issued." };
  }

  const held = takeApproval(id, staff.profileId);
  if (!held) {
    return {
      ok: false,
      error:
        "That approval is no longer on the server — it was already used, it expired, or this answer is " +
        "being served by a different process than the one that wrote it. Nothing has changed. Ask me " +
        "again and I will put the card up once more.",
    };
  }

  const { step } = await withActivityContext({ via: "assistant" }, () =>
    runApprovedChange(held.tool, held.args)
  );

  const reply = step.ok
    ? `**Approved — ${held.label} ran.**\n\n${held.summary}\n\nThe same action the button on that screen ran, recorded in the activity trail as the assistant's change you approved.`
    : `**Not applied — ${held.label} refused.**\n\n${held.summary}\n\n${step.detail}`;

  const sessionId = typeof input.sessionId === "string" ? input.sessionId : null;
  const saved = sessionId
    ? await appendApprovalOutcome({ sessionId, reply, steps: [step] })
    : null;

  return {
    ok: step.ok,
    reply,
    steps: [step],
    sessionId: sessionId ?? undefined,
    saveError: saved && !saved.ok ? saved.error : undefined,
  };
}

/** The recruiter's own saved conversations, newest first. */
export async function getAssistantSessions(): Promise<AssistantSessionSummary[]> {
  await requireStaff("/assistant");
  return listAssistantSessions();
}

/**
 * One saved conversation, or null when it is not this person's to read.
 *
 * Turns come back oldest first and clipped to what the model is allowed to be
 * shown, so opening an old thread costs the same as starting it fresh.
 */
export async function openAssistantSession(sessionId: string): Promise<OpenedAssistantSession | null> {
  await requireStaff("/assistant");
  if (typeof sessionId !== "string" || sessionId.length < 8) return null;
  return readAssistantSession(sessionId);
}

export async function renameSavedSession(
  sessionId: string,
  title: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff("/assistant");
  if (typeof title !== "string" || title.trim().length === 0) {
    return { ok: false, error: "Give the conversation a name first." };
  }
  const renamed = await renameAssistantSession(sessionId, title);
  return renamed
    ? { ok: true }
    : { ok: false, error: "That conversation could not be renamed — it may have been deleted." };
}

/**
 * Deletes one saved conversation.
 *
 * This is the assistant's own history, not a portal record: no job, candidate or
 * message goes with it, and the audit trail for anything the assistant *changed*
 * stays where the buttons that changed it write it.
 */
export async function deleteSavedSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  await requireStaff("/assistant");
  const deleted = await deleteAssistantSession(sessionId);
  return deleted
    ? { ok: true }
    : { ok: false, error: "That conversation could not be deleted — it may already be gone." };
}

/** What the assistant can actually do — rendered in the panel's capability list. */
export async function getAssistantCapabilities(): Promise<AssistantCapability[]> {
  await requireStaff("/dashboard");

  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    destructive: tool.destructive === true,
    needsApproval: requiresApproval(tool.name),
  }));
}

/** One model the assistant can be pointed at for a conversation. */
export interface AssistantModelChoice {
  id: string;
  name: string;
  /** Which provider publishes it, so the picker can group the list. */
  provider: string;
  /** That provider's own name, as the AI models console spells it. */
  providerLabel: string;
  free: boolean;
}

export interface AssistantModelChoices {
  ok: boolean;
  error?: string;
  models: AssistantModelChoice[];
  /** The model the routing table answers with when nothing is chosen here. */
  defaultModel: string;
  /** True when at least one provider could not be listed, so the list is short. */
  degraded: boolean;
}

/**
 * The picker's list: every model this portal can actually call.
 *
 * The catalogue is the one Settings → AI models reads, cached for a few minutes,
 * so opening the picker costs one read however many turns follow. Rows are
 * dropped when the portal stores no code path to call them (`routable`) or when
 * the provider lists them but this account cannot use them (`enabled: false`) —
 * offering either would be a model that fails on the first question.
 */
export async function getAssistantModelChoices(): Promise<AssistantModelChoices> {
  await requireStaff("/assistant");

  try {
    const [catalogue, routing] = await Promise.all([
      getModelCatalogue(),
      resolveModelRouting("assistant"),
    ]);

    // The catalogue labels its own sources, so the picker groups under the same
    // names the AI models console shows without reaching into the provider registry.
    const labels = new Map(catalogue.sources.map((source) => [source.id, source.displayName]));

    return {
      ok: true,
      models: catalogue.models
        .filter((model) => model.routable && model.enabled !== false)
        .map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
          providerLabel: labels.get(model.provider) ?? model.provider,
          free: model.free,
        }))
        .sort(
          (a, b) =>
            a.provider.localeCompare(b.provider) ||
            a.name.localeCompare(b.name, undefined, { numeric: true })
        ),
      defaultModel: routing.enabled ? routing.primaryModel : "",
      degraded: catalogue.degraded,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The model list could not be read — the assistant keeps using its routing.",
      models: [],
      defaultModel: "",
      degraded: false,
    };
  }
}
