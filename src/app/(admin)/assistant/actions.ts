"use server";

import { requireStaff } from "@/lib/auth/session";
import { runAssistantTurn, type AssistantStep } from "@/modules/assistant/infrastructure/agent";
import { ASSISTANT_TOOLS } from "@/modules/assistant/domain/tools";
import type { ChatCompletionMessage } from "@/types";

/**
 * The assistant's single entry point.
 *
 * Auth is checked here and again inside every tool, because the tools are the
 * existing screen actions and they do not trust their caller. What this layer
 * adds is sanitising the transcript: the client owns the history it sends, so
 * system messages are dropped and the rest is clipped before any of it reaches
 * a model or a tool.
 */

export interface AssistantReply {
  ok: boolean;
  error?: string;
  reply?: string;
  steps?: AssistantStep[];
  model?: string;
  provider?: string;
}

export interface AssistantCapability {
  name: string;
  label: string;
  description: string;
  destructive: boolean;
}

/** Turns kept from the client's transcript — enough for context, not for a novel. */
const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 4000;

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
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content.trim().length > 0);
}

export async function sendAssistantMessage(input: {
  history: ChatCompletionMessage[];
  prompt: string;
  allowDestructive: boolean;
}): Promise<AssistantReply> {
  await requireStaff("/dashboard");

  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "Ask me something first." };
  if (prompt.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Keep the question under ${MAX_MESSAGE_CHARS} characters.` };
  }

  const history: ChatCompletionMessage[] = [
    ...sanitize(input.history),
    { role: "user", content: prompt },
  ];

  try {
    const turn = await runAssistantTurn(history, input.allowDestructive === true);
    return {
      ok: true,
      reply: turn.reply,
      steps: turn.steps,
      model: turn.model,
      provider: turn.provider,
    };
  } catch (error) {
    // The gateway's own message already names the models it tried and why each
    // failed, which is what an operator needs when no key is configured.
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
