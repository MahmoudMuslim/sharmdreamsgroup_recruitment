import {
  complete,
  parseJsonResponse,
  TruncatedJsonResponseError,
  type GatewayProvider,
} from "@/modules/screening/infrastructure/aiGateway";
import {
  ASSISTANT_TOOLS,
  toolByName,
  type ToolArgs,
} from "@/modules/assistant/domain/tools";
import { linkForTool, type AssistantLink } from "@/modules/assistant/domain/links";
import type { ChatCompletionMessage } from "@/types";

/**
 * The assistant's agent loop.
 *
 * The gateway speaks plain completions — no provider in this stack is called
 * with a native tool schema — so the protocol is JSON over `complete()`: the
 * model answers with either a tool call or a final reply, the tool runs on the
 * server, and its result is fed back as the next turn. That keeps every
 * provider in the routing table usable by the assistant rather than only the
 * ones that happen to implement function calling.
 */

export interface AssistantStep {
  tool: string;
  label: string;
  ok: boolean;
  /** The tool's answer, or why it refused — short enough to render as a chip. */
  detail: string;
  /** Where to inspect the record this step touched, when there is one. */
  link?: AssistantLink;
}

/** Which engine actually served the turn, shown in the chat footer. */
export type AssistantProvider = GatewayProvider;

export interface AssistantTurn {
  reply: string;
  steps: AssistantStep[];
  model: string;
  provider: AssistantProvider;
}

/** Model turns spent on tools before the loop gives up and asks for a retry. */
const MAX_TOOL_ROUNDS = 6;
/** A tool result is context, not a document — clip it so one read cannot eat the budget. */
const MAX_RESULT_CHARS = 6000;

/**
 * The behaviour contract, shared by both engines: the gateway's JSON protocol
 * and the Qoder agent get the same rules, so switching engines cannot change
 * what the assistant is willing to claim or touch.
 */
export const ASSISTANT_RULES: readonly string[] = [
  "You are the operations assistant inside the Sharm Dreams Talent Cloud admin portal.",
  "You act on behalf of the signed-in staff member. Every tool runs the same server action the",
  "matching button runs, so their role permissions apply to you exactly as they do to that person.",
  "A tool that refuses for lack of permission is not a bug — report the refusal plainly.",
  "",
  "RULES",
  "1. One tool per turn. Read the result, then decide the next step.",
  "2. Never invent an id, a name or a setting key. Look it up with a read tool first.",
  "3. Before editing a job, call get_job and send the whole record back with only the intended change.",
  "4. Before creating or editing a job, call get_master_data for valid company, department, location and currency values.",
  "5. Anything that changes data must come from what the user actually asked for. If a request is",
  "   ambiguous about which record to change, ask instead of guessing.",
  "6. Quote real numbers from tool results. If a tool returned nothing, say so — do not fill the gap.",
  "7. Replies are read by recruiters: short, plain, specific. Use the record's real name and id.",
  "8. Format the answer for the chat panel, which renders markdown: a table when the answer has",
  "   more than two rows of the same shape (| Stage | Count | Conversion |), a bullet list of",
  "   **Label**: value lines for one record, and **bold** on the number being asked for.",
  "9. Point at screens with real links so the recruiter can click through:",
  "   [the opening](/jobs?job=<id>), [this candidate](/candidates?application=<id>),",
  "   [the prospect](/sourcing?prospect=<id>), [the outbox](/whatsapp),",
  "   [the model routing](/settings?area=integrations&section=models).",
  "   A filtered board is the same idea: [interview stage](/dashboard?stage=INTERVIEW) —",
  "   /dashboard takes ?stage=, ?source=, ?bucket= and ?q=; /candidates takes ?q= and ?stage=.",
  "10. Only put an id in a link that a tool actually returned this conversation.",
];

function toolCatalogue(allowDestructive: boolean): string {
  return ASSISTANT_TOOLS.filter((tool) => allowDestructive || !tool.destructive)
    .map((tool) => {
      const args = Object.entries(tool.args)
        .map(([name, spec]) => `${name}: ${spec}`)
        .join("; ");
      return `- ${tool.name}${tool.destructive ? " (destructive)" : ""}: ${tool.description}${
        args ? `\n  args → ${args}` : "\n  args → none"
      }`;
    })
    .join("\n");
}

function destructiveNote(allowDestructive: boolean): string {
  return allowDestructive
    ? "DESTRUCTIVE TOOLS ARE ENABLED for this session. Delete only what the user explicitly named, and say what was deleted."
    : "DESTRUCTIVE TOOLS ARE DISABLED for this session. If the user asks you to delete something, reply that they need to switch on “Allow deletions” in the assistant panel first.";
}

function systemPrompt(allowDestructive: boolean): string {
  return [
    ...ASSISTANT_RULES,
    "",
    "PROTOCOL — answer with exactly one JSON object and nothing else:",
    '- to use a tool: {"tool": "<name>", "args": {…}}',
    '- to answer the user: {"reply": "<your answer>"}',
    "Never put both keys in one object. Never answer in prose outside the JSON.",
    "",
    destructiveNote(allowDestructive),
    "",
    "TOOLS",
    toolCatalogue(allowDestructive),
  ].join("\n");
}

/** The shape the model is asked for. Anything else is treated as prose. */
interface ModelAnswer {
  reply?: unknown;
  tool?: unknown;
  args?: unknown;
}

type Parsed =
  | { kind: "reply"; text: string }
  | { kind: "tool"; name: string; args: ToolArgs }
  | { kind: "broken"; reason: string };

function parseAnswer(content: string, truncated: boolean): Parsed {
  let answer: ModelAnswer;
  try {
    answer = parseJsonResponse<ModelAnswer>(content, { truncated });
  } catch (error) {
    if (error instanceof TruncatedJsonResponseError) {
      return { kind: "broken", reason: error.message };
    }
    // A model that ignored the protocol but answered usefully is still an answer.
    const prose = content.trim();
    if (!prose.includes("{")) return { kind: "reply", text: prose };
    return {
      kind: "broken",
      reason: error instanceof Error ? error.message : "The reply was not valid JSON.",
    };
  }

  if (typeof answer.reply === "string" && answer.reply.trim()) {
    return { kind: "reply", text: answer.reply.trim() };
  }
  if (typeof answer.tool === "string" && answer.tool.trim()) {
    const args = answer.args;
    return {
      kind: "tool",
      name: answer.tool.trim(),
      args: typeof args === "object" && args !== null && !Array.isArray(args)
        ? (args as ToolArgs)
        : {},
    };
  }
  return { kind: "broken", reason: "The reply contained neither a tool call nor an answer." };
}

function detailFor(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "null";
  } catch {
    text = String(value);
  }
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}

async function runTool(
  name: string,
  args: ToolArgs,
  allowDestructive: boolean
): Promise<{ step: AssistantStep; result: string }> {
  const tool = toolByName(name);

  if (!tool) {
    return {
      step: { tool: name, label: "Unknown tool", ok: false, detail: `No tool is called "${name}".` },
      result: `{"error":"No tool is called ${JSON.stringify(name)}. Use one of: ${ASSISTANT_TOOLS.map(
        (entry) => entry.name
      ).join(", ")}.", "ok":false}`,
    };
  }

  if (tool.destructive && !allowDestructive) {
    const detail = "Deletions are switched off in the assistant panel.";
    return {
      step: { tool: tool.name, label: tool.label, ok: false, detail },
      result: `{"ok":false,"error":"${detail} Ask the user to enable “Allow deletions”."}`,
    };
  }

  try {
    const value = await tool.run(args);
    const detail = detailFor(value);
    return {
      step: {
        tool: tool.name,
        label: tool.label,
        ok: typeof value === "object" && value !== null && (value as { ok?: boolean }).ok !== false,
        detail: detail.slice(0, 220),
        link: linkForTool(tool.name, args, value) ?? undefined,
      },
      result: detail,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The tool failed.";
    return {
      step: { tool: tool.name, label: tool.label, ok: false, detail },
      result: `{"ok":false,"error":${JSON.stringify(detail)}}`,
    };
  }
}

/**
 * Runs one user turn: as many model calls and tool executions as the answer
 * needs, up to `MAX_TOOL_ROUNDS`, then the model's final reply.
 */
export async function runAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean
): Promise<AssistantTurn> {
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt(allowDestructive) },
    ...history,
  ];
  const steps: AssistantStep[] = [];
  let model = "";
  let provider: AssistantProvider = "openrouter";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const completion = await complete({
      capability: "assistant",
      messages,
      temperature: 0.2,
      // A reply is now a markdown document — a pipeline table inside the JSON
      // protocol is longer than the prose it replaced — so the chat asks for its
      // own budget instead of inheriting the routing row's.
      maxTokens: 2200,
      jsonMode: true,
    });
    model = completion.model;
    provider = completion.provider;

    const answer = parseAnswer(completion.content, completion.truncated);

    if (answer.kind === "reply") {
      return { reply: answer.text, steps, model, provider };
    }

    if (answer.kind === "broken") {
      return {
        reply:
          "I could not read my own answer back — the model's reply was cut off or malformed. " +
          `Ask again and I will retry. (${answer.reason})`,
        steps,
        model,
        provider,
      };
    }

    const { step, result } = await runTool(answer.name, answer.args, allowDestructive);
    steps.push(step);

    // The call and its result are appended as a normal exchange: the protocol
    // has no tool role, and echoing the model's own JSON back keeps it on format.
    messages.push({ role: "assistant", content: completion.content });
    messages.push({ role: "user", content: `Tool result for ${answer.name}:\n${result}` });
  }

  return {
    reply:
      "I used up my step budget on that one without reaching an answer. Try asking for a smaller " +
      "piece of it, or tell me the record's id directly.",
    steps,
    model,
    provider,
  };
}
