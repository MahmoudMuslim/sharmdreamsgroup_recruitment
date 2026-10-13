"use server";

import { requireStaff } from "@/lib/auth/session";
import {
  runAssistantTurn,
  type AssistantStep,
  type AssistantTurn,
} from "@/modules/assistant/infrastructure/agent";
import {
  isQoderConfigured,
  runQoderAssistantTurn,
} from "@/modules/assistant/infrastructure/qoderAgent";
import { ASSISTANT_TOOLS } from "@/modules/assistant/domain/tools";
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
}

export interface AssistantCapability {
  name: string;
  label: string;
  description: string;
  destructive: boolean;
}

/**
 * Which engine the recruiter wants for this turn.
 *
 * `auto` prefers Qoder and falls back to the gateway, which is the normal case.
 * The other two are for when one engine is being compared against the other, or
 * when the fallback itself is what is being diagnosed — a forced engine reports
 * its own failure instead of silently answering from the other one.
 */
export type AssistantEngine = "auto" | "qoder" | "gateway";

export interface AssistantAttachment {
  name: string;
  text: string;
}

/** Turns kept from the client's transcript — enough for context, not for a novel. */
const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 4000;
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
  engine?: AssistantEngine;
  attachment?: AssistantAttachment;
}): Promise<AssistantReply> {
  await requireStaff("/dashboard");

  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "Ask me something first." };
  if (prompt.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Keep the question under ${MAX_MESSAGE_CHARS} characters.` };
  }

  const engine: AssistantEngine =
    input.engine === "qoder" || input.engine === "gateway" ? input.engine : "auto";

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

  try {
    let turn: AssistantTurn | null = null;
    let note: string | undefined;

    if (engine !== "gateway") {
      if (await isQoderConfigured()) {
        try {
          turn = await runQoderAssistantTurn(history, allowDestructive);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (engine === "qoder") {
            return { ok: false, error: `Qoder could not serve this turn: ${message}` };
          }
          note = `Qoder could not serve this turn (${message}); answered through the model gateway instead.`;
        }
      } else if (engine === "qoder") {
        return {
          ok: false,
          error: "That engine needs a Qoder token in Settings → API keys.",
        };
      }
    }

    if (!turn) {
      try {
        turn = await runAssistantTurn(history, allowDestructive);
      } catch (error) {
        // The gateway's own message already names the models it tried and why each
        // failed, which is what an operator needs when no key is configured.
        const gatewayError =
          error instanceof Error ? error.message : "The assistant could not be reached.";
        throw new Error(note ? `${note} ${gatewayError}` : gatewayError);
      }
    }

    return {
      ok: true,
      reply: turn.reply,
      steps: turn.steps,
      model: turn.model,
      provider: turn.provider,
      note,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The assistant could not be reached.",
    };
  }
}

/** What the assistant can actually do — rendered in the panel's capability list. */
export async function getAssistantCapabilities(): Promise<AssistantCapability[]> {
  await requireStaff("/dashboard");

  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    destructive: tool.destructive === true,
  }));
}
