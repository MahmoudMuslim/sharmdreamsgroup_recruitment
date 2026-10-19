import { AsyncResource } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult, SdkMcpToolDefinition } from "@qoder-ai/qoder-agent-sdk";
import { resolveSecret } from "@/modules/settings/infrastructure/credentialResolver";
import {
  QODER_BUILTIN_TOOLS,
  describeQoderFailure,
  prepareQoderState,
  qoderRuntimeStatus,
} from "@/modules/screening/infrastructure/qoderCompletion";
import {
  ASSISTANT_TOOLS,
  asQuestion,
  questionAsReply,
  type AssistantQuestion,
  type AssistantTool,
  type ToolArgs,
} from "@/modules/assistant/domain/tools";
import {
  approvalAsReply,
  approvalToolResult,
  mintApproval,
  requiresApproval,
  type AssistantApproval,
} from "@/modules/assistant/domain/approvals";
import { chartForTool } from "@/modules/assistant/domain/charts";
import { fitResult } from "@/modules/assistant/domain/resultBudget";
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
 *
 * The one exception is deliberate, and the recruiter opens it per turn: the
 * web switch hands back the runtime's own `WebSearch` and `WebFetch`, which
 * read the public internet and can read nothing here. A fetched figure is
 * advice the panel prints with its source, never a value a tool writes into a
 * record — so the search is audited as a step and the boundary is stated in
 * the prompt rather than left to the model to infer.
 */

/** Thrown when Qoder cannot serve this turn, so the caller may fall back. */
export class QoderAssistantError extends Error {}

/**
 * The runtime's own tools. The list lives with the completion engine so the two
 * cannot drift apart; the assistant blocks all of it except the two names the
 * web switch hands back.
 */
const BUILTIN_AGENT_TOOLS = QODER_BUILTIN_TOOLS;

const MCP_SERVER_NAME = "talentsphere";

/**
 * The two tools the web switch unlocks — the runtime's own, so the search runs
 * on the Qoder account the token already pays for, and nothing in this portal
 * has to hold a key for a search provider. Every other builtin stays blocked,
 * including the file and shell tools.
 */
const WEB_AGENT_TOOLS: readonly string[] = ["WebSearch", "WebFetch"];

/**
 * Whether a name the runtime reported is one of those two.
 *
 * Builtins are named bare, but a namespace a future runtime adds would still be
 * the same tool, and a switch that only works until the name gains a prefix is a
 * switch that silently stops working.
 */
function webToolName(name: string): string | null {
  const bare = name.slice(name.lastIndexOf("__") + 2);
  return (WEB_AGENT_TOOLS as readonly string[]).includes(bare) ? bare : null;
}

/**
 * The scratch directory the agent starts in is its own, but a turn that reads
 * several pages needs longer than one that answers from the database, so a web
 * turn gets more of the clock before it is aborted.
 */
const TURN_TIMEOUT_MS = 120_000;
const WEB_TURN_TIMEOUT_MS = 210_000;
const MAX_AGENT_TURNS = 24;

const TYPE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  "string[]": z.array(z.string()),
  "number[]": z.array(z.number()),
  object: z.record(z.string(), z.unknown()),
  "object[]": z.array(z.record(z.string(), z.unknown())),
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

/**
 * The same envelope the completion engine uses, so neither engine can hand the
 * model a shorter answer than the other without saying so.
 */
function asText(value: unknown): string {
  return fitResult(value);
}

/**
 * What a turn ends on, in the order it was raised: a question the recruiter has
 * to answer, or a change they have to approve. The agent can raise either and
 * carry on talking, so the last one is the live card on the screen.
 */
type TurnEnder =
  | { kind: "ask"; question: AssistantQuestion }
  | { kind: "approval"; approval: AssistantApproval };

/** The transcript text for the turn's last card, fed back on the next turn. */
function enderAsReply(ender: TurnEnder): string {
  return ender.kind === "ask" ? questionAsReply(ender.question) : approvalAsReply(ender.approval);
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
  steps: AssistantStep[],
  enders: TurnEnder[],
  /** The recruiter this write is held for, so only their click can release it. */
  profileId: string
): SdkMcpToolDefinition {
  const handler = AsyncResource.bind(async (args: ToolArgs): Promise<CallToolResult> => {
    const input = (args ?? {}) as ToolArgs;

    // The human decides, not the model: a write stops here and comes back as a
    // card. The arguments are held server-side, so what the recruiter approves is
    // exactly what this call asked with.
    if (requiresApproval(tool.name)) {
      const approval = mintApproval(tool, input, profileId);
      enders.push({ kind: "approval", approval });
      const detail = approvalToolResult(approval);
      steps.push({
        tool: tool.name,
        label: tool.label,
        ok: false,
        detail: `Waiting for your approval — ${approval.summary}`.slice(0, 220),
        link: linkForTool(tool.name, input, null) ?? undefined,
        approval,
      });
      return { content: [{ type: "text", text: detail }], isError: false };
    }

    try {
      const value = await tool.run(input);
      const ask = tool.name === "ask_question" ? asQuestion(value) : null;
      if (ask) enders.push({ kind: "ask", question: ask });
      const detail = ask
        ? `{"ok":true,"shown_to_user":true,"question":${JSON.stringify(
            ask.question
          )},"options":${JSON.stringify(ask.options)},"instruction":"The question and its choices " +
            "are on the recruiter's screen now. End your turn — their click arrives as the next message."}`
        : asText(value);
      const ok =
        typeof value === "object" && value !== null && (value as { ok?: boolean }).ok !== false;
      steps.push({
        tool: tool.name,
        label: tool.label,
        ok,
        detail: detail.slice(0, 220),
        link: linkForTool(tool.name, input, value) ?? undefined,
        ask: ask ?? undefined,
        chart: chartForTool(tool.name, value) ?? undefined,
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
    // Named here for the same reason the gateway names it in its catalogue: a model
    // that cannot tell a read from a held write promises the change out loud.
    requiresApproval(tool.name)
      ? `${tool.description} This does not run when you call it: it raises an approval card for the recruiter and nothing changes unless they click Approve.`
      : tool.description,
    shapeFor(tool),
    handler,
    {
      // Without this the runtime hides the tools behind lazy discovery and spends
      // a turn on `mcp_get` before every single call, which exhausts the turn
      // budget before it can finish a three-step request.
      alwaysLoad: true,
      permissionPolicy: "always_allow",
      annotations: {
        // The runtime's own hint about what a call may do: only the tools on the
        // exception list change nothing. `destructiveHint` stays the delete switch,
        // which is a second gate on top of approval, not a replacement for it.
        readOnlyHint: !requiresApproval(tool.name),
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

/**
 * What a web lookup is worth saying out loud.
 *
 * The step is pushed when the runtime asks for the call and corrected when its
 * own result arrives, so a chip that says "searched the web" reflects what the
 * runtime reported rather than what the model intended.
 */
function webStepFor(name: string, input: unknown): AssistantStep | null {
  const args = (input ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  if (name === "WebSearch") {
    const query = text(args.query);
    if (!query) return null;
    return {
      tool: "web_search",
      label: "Searched the web",
      ok: true,
      detail: `Asked the public internet for: ${query} — outside this portal, so what came back is advice, not a record.`.slice(
        0,
        220
      ),
    };
  }

  const url = text(args.url);
  if (!url) return null;
  return {
    tool: "web_fetch",
    label: `Read ${hostOf(url)}`,
    ok: true,
    detail: `Read ${url} from the public internet — outside this portal, so the figure it names belongs to that page, not to any record here.`.slice(
      0,
      220
    ),
  };
}

/** The page's own domain, because a salary band means nothing without knowing where it was read. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

function systemPromptFor(allowDestructive: boolean, allowWeb: boolean): string {
  return [
    ...ASSISTANT_RULES,
    "",
    allowDestructive
      ? "Deleting tools are available. Delete only what the user explicitly named, and say what was deleted — the switch opens the door, but the delete still waits for them to click Approve."
      : "Deleting is not available in this session. If the user asks you to delete something, reply that they need to switch on “Allow deletions” in the assistant panel first.",
    "",
    "You have no file or shell tools. Your only way to read or change a record here is the portal tools.",
    allowWeb
      ? [
          "WebSearch and WebFetch are ON for this turn. They reach the public internet, which is outside this",
          "portal and is paid for by the organisation's Qoder account — so use them for what the records cannot",
          "answer: a market salary band, a pay survey, an industry benchmark, a competitor's job ad.",
          "What you fetch is advice, never data: name the source, its domain and the date or page it came from,",
          "say which market, currency and seniority the figure describes, and give a range rather than one",
          "number when the sources disagree. Never write a fetched figure into a job opening or any other",
          "record — the salary fields belong on the opening's own screen, typed in by a person who has read",
          "the band. If the search returns nothing usable, say so plainly; never dress a remembered number up",
          "as a search result, and never claim a lookup you did not make.",
        ].join("\n")
      : [
          "You have no way to reach the network this turn. If the user asks for something outside these records —",
          "a market salary band, a pay survey, a competitor's ad — reply that they need to switch on “Allow web",
          "search” in the assistant panel first, and never invent the figure yourself or present one you know",
          "from training as though you had looked it up.",
        ].join("\n"),
  ].join("\n");
}

/**
 * Whether this turn has any chance of reaching Qoder, before a turn is spent on
 * it: the runtime Qoder is driven by, and a stored token for it.
 *
 * `hostCannotRun` separates the two ways this fails. A missing token is a choice
 * the recruiter made; a missing runtime means they asked for Qoder, stored its
 * key, and the server underneath still has nothing to start — which is worth
 * saying out loud, and only on this host.
 */
export async function qoderEngineStatus(): Promise<{
  ok: boolean;
  reason: string;
  hostCannotRun: boolean;
}> {
  const runtime = qoderRuntimeStatus();
  if (!runtime.ok) {
    return { ok: false, reason: runtime.reason, hostCannotRun: true };
  }
  if (!(await resolveSecret("qoder"))) {
    return {
      ok: false,
      reason: "no Qoder token is stored in Settings → API keys",
      hostCannotRun: false,
    };
  }
  return { ok: true, reason: "", hostCannotRun: false };
}

export async function runQoderAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean,
  /** The panel's web switch: hands the runtime its own search and page-reader for one turn. */
  allowWeb: boolean,
  /** `user_profiles.id` of the signed-in recruiter, who must approve any write. */
  profileId: string
): Promise<AssistantTurn> {
  const token = await resolveSecret("qoder");
  if (!token) {
    throw new QoderAssistantError("No Qoder token is stored in Settings → API keys.");
  }

  const runtime = qoderRuntimeStatus();
  if (!runtime.ok) throw new QoderAssistantError(`Qoder cannot be started here: ${runtime.reason}.`);
  prepareQoderState();

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
  const enders: TurnEnder[] = [];
  const definitions = tools.map((tool) => definitionFor(sdk, tool, steps, enders, profileId));
  const server = sdk.createSdkMcpServer({ name: MCP_SERVER_NAME, tools: definitions });

  const allowed = tools.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool.name}`);
  const portalToolNames = new Set(allowed);

  // The web switch is the one thing that can lift a builtin, and it lifts two
  // names only: the shell, the file tools and sub-agents stay blocked whether or
  // not the recruiter is letting this turn search the internet.
  const webNames = allowWeb ? [...WEB_AGENT_TOOLS] : [];
  const blockedBuiltins = BUILTIN_AGENT_TOOLS.filter((name) => !webNames.includes(name));

  // A scratch directory only: the agent's file tools are blocked, and this way
  // nothing it does incidentally can touch the application's own tree.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sdg-assistant-"));
  const abortController = new AbortController();
  const timer = setTimeout(
    () => abortController.abort(),
    allowWeb ? WEB_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS
  );

  let model = "";
  let reply = "";

  try {
    const query = sdk.query({
      prompt: promptFor(history),
      options: {
        auth: sdk.accessToken(token),
        cwd,
        systemPrompt: systemPromptFor(allowDestructive, allowWeb),
        mcpServers: { [MCP_SERVER_NAME]: server },
        allowedTools: [...allowed, ...webNames],
        disallowedTools: blockedBuiltins,
        maxTurns: MAX_AGENT_TURNS,
        abortController,
        canUseTool: async (toolName: string) =>
          portalToolNames.has(toolName) || webToolName(toolName)
            ? { behavior: "allow" as const }
            : {
                behavior: "deny" as const,
                message: allowWeb
                  ? "Only this portal's tools and the two web tools are available here."
                  : "Only this portal's tools are available here, and the web switch is off.",
              },
      },
    });

    try {
      /** Web lookups still waiting for the runtime to report what came back. */
      const webLookups = new Map<string, AssistantStep>();

      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") {
          model = message.model ?? "";
        }

        if (message.type === "assistant") {
          const blocks: {
            type?: unknown;
            text?: unknown;
            id?: unknown;
            name?: unknown;
            input?: unknown;
          }[] =
            (
              message as {
                message?: {
                  content?: {
                    type?: unknown;
                    text?: unknown;
                    id?: unknown;
                    name?: unknown;
                    input?: unknown;
                  }[];
                };
              }
            ).message?.content ?? [];
          const text = blocks
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("\n")
            .trim();
          if (text) reply = text;

          for (const block of blocks) {
            if (block.type !== "tool_use" || typeof block.name !== "string") continue;
            const tool = webToolName(block.name);
            if (!tool) continue;
            const step = webStepFor(tool, block.input);
            if (!step) continue;
            steps.push(step);
            if (typeof block.id === "string") webLookups.set(block.id, step);
          }
        }

        // The result of the runtime's own tools arrives on the next message, and
        // this is the only place a failed lookup can stop being shown as one that
        // worked — a chip claiming the web was searched has to mean it was.
        if (message.type === "user" && webLookups.size > 0) {
          const blocks: { type?: unknown; tool_use_id?: unknown; is_error?: unknown }[] =
            (
              message as {
                message?: {
                  content?: { type?: unknown; tool_use_id?: unknown; is_error?: unknown }[];
                };
              }
            ).message?.content ?? [];
          for (const block of blocks) {
            if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
            const step = webLookups.get(block.tool_use_id);
            if (!step) continue;
            webLookups.delete(block.tool_use_id);
            if (block.is_error === true) {
              step.ok = false;
              step.detail = `${step.detail} — and the lookup came back failed.`.slice(0, 220);
            }
          }
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
    throw new QoderAssistantError(describeQoderFailure(error));
  } finally {
    clearTimeout(timer);
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  // A card the recruiter has to click is a whole answer here, whether it asks a
  // question or holds a change: an agent that raised one and then fell silent is
  // not an agent that failed to reply.
  const ending = enders[enders.length - 1];
  if (!reply.trim() && !ending) {
    throw new QoderAssistantError("Qoder answered without any text.");
  }

  const provider: AssistantProvider = "qoder";
  return {
    reply: reply.trim() || (ending ? enderAsReply(ending) : ""),
    steps,
    model: model || "qoder",
    provider,
  };
}
