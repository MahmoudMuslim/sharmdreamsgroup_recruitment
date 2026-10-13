import { AsyncResource } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult, SdkMcpToolDefinition } from "@qoder-ai/qoder-agent-sdk";
import { resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";
import { QODER_BUILTIN_TOOLS } from "@/modules/screening/infrastructure/qoderCompletion";
import {
  ASSISTANT_TOOLS,
  type AssistantTool,
  type ToolArgs,
} from "@/modules/assistant/domain/tools";
import {
  ASSISTANT_RULES,
  type AssistantProvider,
  type AssistantStep,
  type AssistantTurn,
} from "@/modules/assistant/infrastructure/agent";
import { linkForTool } from "@/modules/assistant/domain/links";
import type { ChatCompletionMessage } from "@/types";

/**
 * The Qoder engine.
 *
 * The gateway has to fake tool use with a JSON protocol because no raw
 * completion API in this stack is called with a native tool schema. The Qoder
 * Agent SDK does have one: the portal's tools are published as an in-process
 * MCP server, so Qoder decides when to call them, passes structured arguments,
 * and reads the result back as a real tool result.
 *
 * The agent arrives with a coding toolset — shell, file read/write, web fetch —
 * which has no place answering questions about candidate records. Every one of
 * those is disallowed and `canUseTool` denies anything that is not a portal
 * tool, so the model can only ever reach the database through the same server
 * actions the screens use, with the same permissions and the same RLS.
 */

/** Thrown when Qoder cannot serve this turn, so the caller may fall back. */
export class QoderAssistantError extends Error {}

/**
 * The runtime's own tools, blocked the same way the completion path blocks them.
 * The list lives with the completion engine so the two cannot drift apart.
 */
const BUILTIN_AGENT_TOOLS = QODER_BUILTIN_TOOLS;

const MCP_SERVER_NAME = "talentsphere";

/** Bound so a wedged runtime cannot hold a request open forever. */
const TURN_TIMEOUT_MS = 120_000;
const MAX_AGENT_TURNS = 12;
const MAX_RESULT_CHARS = 6000;

const TYPE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  "string[]": z.array(z.string()),
  "number[]": z.array(z.number()),
};

/**
 * The registry keeps one human-readable spec per argument
 * (`"number — optional, defaults to 15, maximum 50"`) because the gateway
 * prompt renders it verbatim. The agent needs the same information as a schema,
 * so the leading token is read as the type and the word "optional" in the note
 * makes the field optional — one source of truth rather than two that can drift.
 */
function shapeFor(tool: AssistantTool): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, spec] of Object.entries(tool.args)) {
    const typeToken = spec.trim().split(/[\s—-]/)[0] ?? "string";
    const base = TYPE_SCHEMAS[typeToken] ?? z.string();
    const described = base.describe(spec);
    shape[name] = /\boptional\b/i.test(spec) ? described.optional() : described;
  }

  return shape;
}

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}

function asText(value: unknown): string {
  try {
    return clip(JSON.stringify(value) ?? "null");
  } catch {
    return clip(String(value));
  }
}

/**
 * The tool is bound to the request's async context at construction time. Qoder
 * invokes the handler when its worker reports the call, which is outside the
 * async chain that `sendAssistantMessage` started, and `cookies()` resolves the
 * session from that chain — without the bind, every action the tool delegates
 * to would lose the signed-in staff member and refuse.
 */
function definitionFor(
  sdk: typeof import("@qoder-ai/qoder-agent-sdk"),
  tool: AssistantTool,
  steps: AssistantStep[]
): SdkMcpToolDefinition {
  const handler = AsyncResource.bind(async (args: ToolArgs): Promise<CallToolResult> => {
    const input = (args ?? {}) as ToolArgs;
    try {
      const value = await tool.run(input);
      const detail = asText(value);
      const ok =
        typeof value === "object" && value !== null && (value as { ok?: boolean }).ok !== false;
      steps.push({
        tool: tool.name,
        label: tool.label,
        ok,
        detail: detail.slice(0, 220),
        link: linkForTool(tool.name, input, value) ?? undefined,
      });
      return { content: [{ type: "text", text: detail }], isError: !ok };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The tool failed.";
      steps.push({ tool: tool.name, label: tool.label, ok: false, detail });
      return {
        content: [{ type: "text", text: `{"ok":false,"error":${JSON.stringify(detail)}}` }],
        isError: true,
      };
    }
  });

  return sdk.tool(
    tool.name,
    tool.description,
    shapeFor(tool),
    handler,
    {
      // Without this the runtime hides the tools behind lazy discovery and spends
      // a turn on `mcp_get` before every single call, which exhausts the turn
      // budget before it can finish a three-step request.
      alwaysLoad: true,
      permissionPolicy: "always_allow",
      annotations: {
        readOnlyHint: !tool.destructive,
        destructiveHint: tool.destructive === true,
      },
    }
  ) as SdkMcpToolDefinition;
}

/**
 * The gateway engine keeps the transcript as messages; an agent turn is a
 * single prompt, so the earlier turns are flattened ahead of the new request.
 */
function promptFor(history: ChatCompletionMessage[]): string {
  const last = history[history.length - 1];
  const prior = history.slice(0, -1);

  if (prior.length === 0) return last?.content ?? "";

  return [
    "Earlier in this conversation:",
    ...prior.map((message) => `${message.role === "user" ? "Recruiter" : "You"}: ${message.content}`),
    "",
    `Recruiter: ${last?.content ?? ""}`,
  ].join("\n");
}

function systemPromptFor(allowDestructive: boolean): string {
  return [
    ...ASSISTANT_RULES,
    "",
    allowDestructive
      ? "Deleting tools are available. Delete only what the user explicitly named, and say what was deleted."
      : "Deleting is not available in this session. If the user asks you to delete something, reply that they need to switch on “Allow deletions” in the assistant panel first.",
    "",
    "You have no file, shell or web tools. Your only way to act is the portal tools.",
  ].join("\n");
}

/** True when a Qoder token exists, so the caller can skip the engine entirely. */
export async function isQoderConfigured(): Promise<boolean> {
  return Boolean(await resolveSecret("qoder"));
}

export async function runQoderAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean
): Promise<AssistantTurn> {
  const token = await resolveSecret("qoder");
  if (!token) {
    throw new QoderAssistantError("No Qoder token is stored in Settings → API keys.");
  }

  let sdk: typeof import("@qoder-ai/qoder-agent-sdk");
  try {
    sdk = await import("@qoder-ai/qoder-agent-sdk");
  } catch (error) {
    throw new QoderAssistantError(
      `The Qoder runtime could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  const tools = ASSISTANT_TOOLS.filter((tool) => allowDestructive || !tool.destructive);
  const steps: AssistantStep[] = [];
  const definitions = tools.map((tool) => definitionFor(sdk, tool, steps));
  const server = sdk.createSdkMcpServer({ name: MCP_SERVER_NAME, tools: definitions });

  const allowed = tools.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool.name}`);
  const portalToolNames = new Set(allowed);

  // A scratch directory only: the agent's file tools are blocked, and this way
  // nothing it does incidentally can touch the application's own tree.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sdg-assistant-"));
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TURN_TIMEOUT_MS);

  let model = "";
  let reply = "";

  try {
    const query = sdk.query({
      prompt: promptFor(history),
      options: {
        auth: sdk.accessToken(token),
        cwd,
        systemPrompt: systemPromptFor(allowDestructive),
        mcpServers: { [MCP_SERVER_NAME]: server },
        allowedTools: allowed,
        disallowedTools: BUILTIN_AGENT_TOOLS,
        maxTurns: MAX_AGENT_TURNS,
        abortController,
        canUseTool: async (toolName: string) =>
          portalToolNames.has(toolName)
            ? { behavior: "allow" as const }
            : { behavior: "deny" as const, message: "Only portal tools are available here." },
      },
    });

    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") {
          model = message.model ?? "";
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
            result?: string;
            total_cost_usd?: number;
          };
          if (result.is_error || (result.subtype && result.subtype !== "success")) {
            throw new QoderAssistantError(
              `Qoder ended the turn with "${result.subtype ?? "error"}".`
            );
          }
        }
      }
    } finally {
      await query.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof QoderAssistantError) throw error;
    throw new QoderAssistantError(
      error instanceof Error ? error.message : "The Qoder runtime could not be reached."
    );
  } finally {
    clearTimeout(timer);
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  if (!reply.trim()) {
    throw new QoderAssistantError("Qoder answered without any text.");
  }

  const provider: AssistantProvider = "qoder";
  return { reply: reply.trim(), steps, model: model || "qoder", provider };
}
