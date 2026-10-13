import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatCompletionMessage } from "@/types";

/**
 * Qoder as a completion provider.
 *
 * Qoder exposes no endpoint that answers a chat completion: the stored personal
 * access token authorises its agent API, and the only thing in this repository
 * that turns a prompt into Qoder text is the Agent SDK runtime. This is that
 * runtime with the portal tools taken away — one prompt in, one reply out.
 *
 * Two behaviours found by probing the live account shape the code below.
 * Folding the system message into the prompt makes the agent answer as a coding
 * assistant ("give me something concrete") because its own persona prompt is
 * still in front of it, so the system block has to go through
 * `options.systemPrompt`. And a systemPrompt that is nothing but a bare
 * instruction gets acknowledged instead of obeyed, so the actual task always
 * stays in the prompt.
 */

/**
 * The runtime's own tools. A name here that does not exist is ignored, so the
 * list is deliberately wider than what the current build initialises. Shared
 * with the assistant engine: both must run Qoder with nothing but their own
 * reachable surface.
 */
export const QODER_BUILTIN_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "TodoWrite",
  "AskUserQuestion",
  "ExitPlanMode",
  "Plan",
];

/** Raised when Qoder cannot serve this completion, so the gateway can move on. */
export class QoderCompletionError extends Error {}

/** One text-only agent turn; a few extra in case the runtime needs to settle. */
const MAX_COMPLETION_TURNS = 4;

/**
 * Bound the way the assistant engine bounds its turns: this runtime starts a
 * worker per call, so a wedged one must not hold a screening request open
 * forever. Longer than the other providers' hops because it is an agent, not a
 * completion — measured live at roughly ten seconds for a scored answer.
 */
export const QODER_COMPLETION_TIMEOUT_MS = 120_000;

export async function callQoderCompletion(
  model: string,
  messages: ChatCompletionMessage[],
  token: string,
  controller: AbortController
): Promise<{ content: string; model: string }> {
  let sdk: typeof import("@qoder-ai/qoder-agent-sdk");
  try {
    sdk = await import("@qoder-ai/qoder-agent-sdk");
  } catch (error) {
    throw new QoderCompletionError(
      `The Qoder runtime could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();

  if (!prompt) throw new QoderCompletionError("Qoder was given nothing to answer.");

  // A scratch directory only: the runtime's file tools are blocked, and this way
  // nothing it does incidentally can touch the application's own tree.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sdg-completion-"));

  try {
    const query = sdk.query({
      prompt,
      options: {
        auth: sdk.accessToken(token),
        cwd,
        model,
        ...(systemPrompt ? { systemPrompt } : {}),
        allowedTools: [],
        disallowedTools: QODER_BUILTIN_TOOLS,
        maxTurns: MAX_COMPLETION_TURNS,
        abortController: controller,
        canUseTool: async () => ({
          behavior: "deny" as const,
          message: "Completions run without tools.",
        }),
      },
    });

    let servedModel = "";
    let reply = "";

    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") {
          servedModel = message.model ?? "";
        }

        if (message.type === "assistant") {
          const blocks: { type?: unknown; text?: unknown }[] =
            (message as { message?: { content?: { type?: unknown; text?: unknown }[] } }).message
              ?.content ?? [];
          const text = blocks
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("\n")
            .trim();
          if (text) reply = text;
        }

        if (message.type === "result") {
          const result = message as {
            subtype?: string;
            is_error?: boolean;
            errors?: string[];
          };
          if (result.is_error || (result.subtype && result.subtype !== "success")) {
            throw new QoderCompletionError(
              result.errors?.join(" ").trim() ||
                `Qoder ended the completion with "${result.subtype ?? "error"}".`
            );
          }
        }
      }
    } finally {
      await query.close().catch(() => undefined);
    }

    if (!reply.trim()) throw new QoderCompletionError("Qoder answered without any text.");

    return {
      content: reply.trim(),
      // The routing table holds the alias the admin picked; the runtime reports
      // the model behind it, and both belong in the answer's provenance.
      model: servedModel ? `${model} (${servedModel})` : model,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
