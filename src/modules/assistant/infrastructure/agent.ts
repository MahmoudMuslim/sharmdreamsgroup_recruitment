import {
  complete,
  parseJsonResponse,
  TruncatedJsonResponseError,
} from "@/modules/screening/infrastructure/aiGateway";
import { type GatewayProvider } from "@/modules/settings/domain/modelRouting";
import {
  ASSISTANT_TOOLS,
  asQuestion,
  questionAsReply,
  toolByName,
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
import { chartForTool, type AssistantChart } from "@/modules/assistant/domain/charts";
import {
  fileChipLine,
  splitFilePayload,
  withoutFileBytes,
  type GeneratedFileManifest,
} from "@/modules/assistant/domain/generatedFiles";
import { fitResult } from "@/modules/assistant/domain/resultBudget";
import { SETTINGS_SCHEMA } from "@/modules/settings/domain/schema";
import {
  SETTINGS_TRAIL_GROUPS,
  SETTINGS_TRAIL_LIMIT,
  SETTINGS_TRAIL_SEARCH_SCAN,
} from "@/modules/settings/domain/settingsTrail";
import {
  TRAIL_LIMIT,
  TRAIL_SEARCH_SCAN,
} from "@/modules/settings/domain/credentialTrail";
import { settingSearchWords } from "@/modules/settings/domain/settingSearch";
import { linkForTool, type AssistantLink } from "@/modules/assistant/domain/links";
import { BUCKETS } from "@/app/(admin)/files/file-browser-types";
import { OUTBOX_BUCKETS } from "@/app/(admin)/whatsapp/outbox-model";
import {
  MODEL_CONSOLE_TAB_IDS,
  SETTINGS_NAV,
  TEMPLATES_TAB_IDS,
} from "@/modules/settings/domain/settingsNav";
import { PROVIDER_GROUPS, PROVIDERS } from "@/modules/settings/domain/providers";
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
  /** Set when the step is a question: the choices are rendered as buttons. */
  ask?: AssistantQuestion;
  /**
   * Set when the step is a write held back for a click. The chat renders it as
   * an approval card; the arguments themselves stay on the server.
   */
  approval?: AssistantApproval;
  /**
   * A chart built from this tool's own result. The model names the view and the
   * server draws it, so the bars can only ever show figures the read returned —
   * and they never travel back into the model's context.
   */
  chart?: AssistantChart;
  /**
   * A file this call built, with its bytes. The download button lives on this
   * step; `withoutStepFileBytes` removes the bytes on the way to the transcript,
   * so a reloaded conversation still names the file and can build it again.
   */
  file?: GeneratedFileManifest;
}

/**
 * The transcript copy of a turn's steps: every card intact, no file bytes.
 *
 * A stored base64 string is replayed into the panel on every load of that
 * conversation and bought nobody anything — the file it holds was downloadable
 * once, from the answer that built it.
 */
export function withoutStepFileBytes(steps: AssistantStep[]): AssistantStep[] {
  return steps.map((step) => (step.file ? { ...step, file: withoutFileBytes(step.file) } : step));
}

/** Which engine actually served the turn, shown in the chat footer. */
export type AssistantProvider = GatewayProvider;

export interface AssistantTurn {
  reply: string;
  steps: AssistantStep[];
  model: string;
  provider: AssistantProvider;
}

/**
 * Model turns spent on tools before the loop gives up and asks for a retry.
 * Authoring a record is a chain — read the master data, read the record, write
 * it, add its parts, read it back — so the budget has to cover a whole one.
 */
const MAX_TOOL_ROUNDS = 12;

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
  "4. Before creating or editing a job, read the vocabularies with get_master_data — it answers one list per call, so ask it for companies, then departments, locations and currencies. Use a row that is in use: a row marked is_active:false is retired and the pickers leave it out.",
  "5. Anything that changes data must come from what the user actually asked for. If a request is",
  "   ambiguous about which record to change, ask instead of guessing — with ask_question, listing the",
  "   real candidates from a tool result as the choices rather than asking an open question.",
  "6. Quote real numbers from tool results. If a tool returned nothing, say so — do not fill the gap.",
  "   When a result opens with \"result_budget\", the answer was shortened to fit one turn: the budget line",
  "   is the truth about how much arrived, whatever the rest of the answer claims. Tell the recruiter how",
  "   many rows or characters were left out, quote only the rows that came, and offer the narrower read the",
  "   budget line names — never present a shortened answer as the whole set.",
  "7. Replies are read by recruiters: short, plain, specific. Use the record's real name and id.",
  "8. Format the answer for the chat panel, which renders markdown: a table when the answer has",
  "   more than two rows of the same shape (| Stage | Count | Conversion |), a bullet list of",
  "   **Label**: value lines for one record, and **bold** on the number being asked for.",
  "9. Point at screens with real links so the recruiter can click through:",
  "   [the opening](/jobs?job=<id>), [this candidate](/candidates/<id>) — their one profile, holding",
  "   every application they hold — or [one application's desk](/candidates?application=<id>) when the",
  "   answer is about the work on a single opening (stage buttons, the CV, the marks),",
  "   [the prospect](/sourcing?prospect=<id>), [the outbox](/whatsapp),",
  "   [the model routing](/settings?area=providers&section=models), [the suites](/assessments),",
  "   [the interview agenda](/interviews), [the checklists](/onboarding), [the file manager](/files),",
  "   [the apply-form questions](/questions?store=gate), [the templates](/settings?area=access&section=templates),",
  "   [the team](/settings?area=access&section=team), [the change trail console](/activity) — that one",
  "   is get_activity_trail's screen: it reads the hiring-data trail and takes the console's own filters",
  "   (window=24h|7d|30d|90d|all, area=, actorKind=STAFF|AI|CANDIDATE|SYSTEM, surface=, entity=,",
  "   entityId=, q= and page=), so [the AI-made changes](/activity?window=30d&actorKind=AI) is a real",
  "   link. That is a different table from the settings change trail get_audit_log reads; never mix the two.",
  "   A filtered board is the same idea: [interview stage](/dashboard?stage=INTERVIEW) —",
  "   /dashboard takes ?stage=, ?source=, ?bucket= and ?q=; /candidates takes ?q=, ?stage=,",
  "   ?source=, ?company=<id>, ?application=<id>, ?c=<tracking code>, ?ungraded=1 (the grading queue — attempts",
  "   submitted and never scored) and ?archived=1; /jobs takes ?job=<id>, ?q= and",
  "   ?status=DRAFT|PUBLISHED|PAUSED|CLOSED|HIREABLE — the grid's own rails, HIREABLE being every",
  "   role a person may still be filed under — so [the draft openings](/jobs?status=DRAFT) and",
  "   [what is still live](/jobs?status=HIREABLE) are real links; on either grid ?company=<id> lights that",
  "   company's rail, so only an id get_master_data returned belongs in it;",
  "   /sourcing takes ?prospect=;",
  `   /settings takes ?area=${SETTINGS_NAV.map((area) => area.id).join("|")}&section=<one of that area's sections>,`,
  `   and on the AI models console ?tab=${MODEL_CONSOLE_TAB_IDS.join("|")} plus ?q= for its catalogue box — so`,
  "   [the gemini models](/settings?area=providers&section=models&tab=catalogue&q=gemini) is a real link.",
  `   On the templates console ?tab=${TEMPLATES_TAB_IDS.join("|")} is the channel whose rows it lists — so`,
  "   [the email letters](/settings?area=access&section=templates&tab=email) is a real link, and an empty tab",
  "   says it holds no rows rather than opening a different channel;",
  `   The Platform area's sections are ${SETTINGS_SCHEMA.map((section) => section.id).join("|")}, and its console box`,
  `   searches them by ${settingSearchWords()}, so [the password rule](/settings?area=platform&section=security&q=password)`,
  "   is a real link — words belong in it only when one section holds every setting the answer names;",
  `   The Platform area's last section is the change trail, /settings?area=platform&section=trail, and ?trail=`,
  `   scopes it to ${SETTINGS_TRAIL_GROUPS.map((group) => group.id).join("|")} — the same ids get_audit_log's group`,
  "   argument takes and the console's own row chips write, so",
  `   [the security changes](/settings?area=platform&section=trail&trail=security) is a real link. Both read that`,
  `   scope ${SETTINGS_TRAIL_LIMIT} rows a page, newest first, and ?page=<2 or more> walks to the rows before them —`,
  `   a page of get_audit_log and a page of the console are the same read, so the note's "page 2 of 11" is a thing`,
  `   the recruiter can click. Quote the row numbers the note names, rather than calling any one page the whole history.`,
  `   Its search box is ?find=<words> — the same words get_audit_log's query argument takes, matched over the printed`,
  `   row (key, its name in the console, either value, the actor) across the newest ${SETTINGS_TRAIL_SEARCH_SCAN} rows`,
  `   of the scope, so [the timeout change](/settings?area=platform&section=trail&find=timeout) is a real link. Say`,
  `   which rows it searched when the note says the scope is deeper than that, and never report an empty search as`,
  `   "no such change was made" — a match older than the window is a different sentence;`,
  "   Most rows name no person, because the doors that wrote them recorded no actor: say how many do, and never",
  "   fill a blank in with a name;",
  `   On the API keys console ?tab=${PROVIDER_GROUPS.map((group) => group.id).join("|")} is the group whose providers it lists, so`,
  `   [the messaging keys](/settings?area=providers&section=credentials&tab=communication) is a real link. It covers all`,
  `   ${PROVIDERS.length} providers the portal knows, and says where each key comes from. A key is shown only as its`,
  "   last characters, and no tool of yours can store one: save_credential refuses a key field outright, because",
  "   anything typed into this chat is sent to the model answering it. A new or rotated key is typed into that",
  "   screen's own field, which encrypts it. A provider served from the environment has no stored row, so",
  "   save_credential and delete_credential refuse for it and say so; verify_credential tests either kind.",
  `   The trail under those cards is scoped by ?provider=<one of ${PROVIDERS.map((provider) => provider.id).join("|")}>, the`,
  "   same ids list_credentials returns, so [OpenRouter's key history](/settings?area=providers&section=credentials&provider=openrouter)",
  "   is a real link — and get_credential_audit reads those rows, which is where a Test of an environment-served key",
  `   survives. It walks ${TRAIL_LIMIT} rows a page and the trail is deeper than one page, so ?page=<2 or more> reaches the`,
  `   rows before the ones on screen and ?find=<words> runs its search box — the same arguments get_credential_audit's`,
  `   page and query take, matched over the row as printed (the action, the provider id and its name, what it reported,`,
  `   the actor) across the newest ${TRAIL_SEARCH_SCAN} rows of the scope, so`,
  `   [the rejected OpenRouter test](/settings?area=providers&section=credentials&provider=openrouter&find=401) is a real`,
  "   link too. Name the page an answer read rather than calling any one page the whole history, and never report an",
  "   empty search as \"nobody tested this key\" — the note says how far it looked, and a match past that window is a",
  "   different sentence. A VERIFIED row says somebody ran the test and what came back; it is not a claim that it passed.",
  "   Provider health only probes when a person opens that tab itself, so a link there shows nothing run;",
  "   /assessments takes ?q= for its own suite box and ?stats=<the suite id get_item_statistics read>,",
  "   so [how those questions scored](/assessments?stats=<that id>) opens that suite's item table; /files takes ?q=,",
  `   ?bucket=${BUCKETS.map((bucket) => bucket.key).join("|")} and ?prefix=<a stored folder path it listed>;`,
  "   /time takes ?window=today|7d|14d|30d and ?scope=mine|team, so",
  "   [the team's hours this month](/time?window=30d&scope=team) is a real link — the ledger's own pills;",
  "   /interviews takes ?range=today|week|month|upcoming|past",
  "   and ?status=SCHEDULED|COMPLETED|NO_SHOW|CANCELLED, so [awaiting an outcome](/interviews?range=upcoming&status=SCHEDULED)",
  `   is a real link; /whatsapp takes ?bucket=${OUTBOX_BUCKETS.join("|")}, ?failed=1 and ?q= for the WhatsApp`,
  "   queue, and ?email_q= for the email log beside it, so",
  "   [the parked alerts](/whatsapp?bucket=FAILED) and [what the channels refused](/whatsapp?failed=1)",
  "   are real links too.",
  "   Those are the screens that read a query string; every other page ignores one, so never dress it",
  "   with a parameter it would drop — link to the plain page and name the record in the words beside it.",
  "10. Only put an id in a link that a tool actually returned this conversation.",
  "11. ask_question ends your turn. Ask once with 2 to 6 choices, then wait for the answer — never",
  "    ask a question in prose and answer it yourself in the same turn.",
  "12. Authoring reads before it writes. Before save_assessment_suite, send get_assessment_suite back",
  "    whole with only the intended change; add its questions one at a time with save_question, giving",
  "    each one the real template_id the read returned. The same holds for gate questions, notification",
  "    templates, onboarding tasks and staff records — read the row, then write that row.",
  "13. Ids come from reads, never from memory: application ids from search_candidates or the dossier,",
  "    attempt ids from the dossier, response ids from get_attempt_grades, interview ids from",
  "    list_interviews, plan ids from list_onboarding_plans, staff profile ids from list_team,",
  "    file keys from list_files.",
  "14. Dates and times carry their own UTC offset (…T10:30:00+03:00, or Z). A time the recruiter gave in",
  "    words is read against the organisation timezone from get_settings, then converted before you send it.",
  "15. Nothing that changes data is done when you ask for it. Every write is held on the recruiter's screen",
  "    as an approval card and runs only if they click Approve. Reads answer immediately. So after a write",
  "    say what is waiting for approval and stop — never report it as applied, and never chain another",
  "    change on top of it, because the one you asked for has not happened.",
  "16. A file built with create_file is made of rows a read tool returned in this conversation or lines from",
  "    a file the recruiter attached — never of figures you worked out yourself. Building one changes no",
  "    record, so it waits for no approval card and the recruiter can download it from your answer. There is",
  "    no link, stored path or expiry date to quote: the button on that answer is the whole of it. Say out",
  "    loud whatever a ceiling cut short — the tool's `notes` names what was left out.",
];

function toolCatalogue(allowDestructive: boolean, allowWeb: boolean): string {
  return ASSISTANT_TOOLS.filter(
    (tool) => (allowDestructive || !tool.destructive) && (allowWeb || !tool.web)
  )
    .map((tool) => {
      const args = Object.entries(tool.args)
        .map(([name, spec]) => `${name}: ${spec}`)
        .join("; ");
      // The catalogue names the gate the call will hit, because a model that
      // cannot tell a read from a held write promises a change out loud.
      const gate = tool.destructive
        ? " (destructive — waits for your approval)"
        : requiresApproval(tool.name)
          ? " (waits for the recruiter's approval)"
          : "";
      return `- ${tool.name}${gate}: ${tool.description}${
        args ? `\n  args → ${args}` : "\n  args → none"
      }`;
    })
    .join("\n");
}

function destructiveNote(allowDestructive: boolean): string {
  return allowDestructive
    ? "DESTRUCTIVE TOOLS ARE ENABLED for this session. Delete only what the user explicitly named, and say what was deleted — the switch opens the door, but the delete still waits for them to click Approve."
    : "DESTRUCTIVE TOOLS ARE DISABLED for this session. If the user asks you to delete something, reply that they need to switch on “Allow deletions” in the assistant panel first.";
}

/**
 * What the web switch buys, said the same way to both engines.
 *
 * The rule that matters is the one a model will otherwise break: a page read
 * from the internet is advice, and this portal's own records are data. Without
 * the sentence, a fetched figure arrives in a reply as though the opening carried it.
 */
function webNote(allowWeb: boolean): string {
  return allowWeb
    ? [
        "THE WEB IS AVAILABLE for this turn through search_web and read_web_page. They are the portal's own",
        "lookups, not this model's, so the subject is unrestricted — a pay band, a law, a product, a company,",
        "a competitor's ad, a release note. Every lookup you make shows the recruiter as a chip naming the",
        "query. Quote a fetched figure with its source: the host, the URL, and the market, currency and date it",
        "describes. Give a range when the pages disagree, and say which page each number came from. Never write",
        "a fetched figure into a job opening or any other record — those fields belong on the record's own",
        "screen, typed by a person who has read the source. If a search returns nothing usable, say that:",
        "a figure you remember is not a search result, and never claim a lookup you did not run.",
      ].join("\n")
    : [
        "THE WEB IS NOT AVAILABLE for this turn. If the recruiter asks for something outside these records — a",
        "market band, a survey, a rule, a competitor's page — reply that they need to switch on “Allow web",
        "search” in the assistant panel first, and never invent the figure or present one you remember as though",
        "you had looked it up.",
      ].join("\n");
}

function systemPrompt(allowDestructive: boolean, allowWeb: boolean): string {
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
    webNote(allowWeb),
    "",
    "TOOLS",
    toolCatalogue(allowDestructive, allowWeb),
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

/**
 * What the model is handed for one tool result. A tool result is context, not a
 * document, so it is bounded — but bounded by reshaping the answer and saying what
 * came off it, never by cutting the string where the budget happens to end.
 */
function detailFor(value: unknown): string {
  return fitResult(value);
}

async function runTool(
  name: string,
  args: ToolArgs,
  allowDestructive: boolean,
  /** The recruiter this write is held for, so only their click can release it. */
  profileId: string,
  /** The panel's web switch — the only thing that lets a lookup leave the portal. */
  allowWeb: boolean
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

  // Refused here rather than left out of the catalogue alone, because a model that
  // has learned this tool from an earlier turn in the same conversation will still
  // ask for it after the recruiter switches the panel back off.
  if (tool.web && !allowWeb) {
    const detail = "Web search is switched off in the assistant panel.";
    return {
      step: { tool: tool.name, label: tool.label, ok: false, detail },
      result: `{"ok":false,"error":"${detail} Ask the user to enable “Allow web search”."}`,
    };
  }

  // The human decides, not the model. Held before `tool.run`, so the arguments
  // the recruiter approves are the arguments this turn asked with — nothing that
  // happens afterwards can rewrite them.
  if (requiresApproval(tool.name)) {
    const approval = mintApproval(tool, args, profileId);
    return {
      step: {
        tool: tool.name,
        label: tool.label,
        ok: false,
        detail: `Waiting for your approval — ${approval.summary}`,
        link: linkForTool(tool.name, args, null) ?? undefined,
        approval,
      },
      result: approvalToolResult(approval),
    };
  }

  return executeTool(tool, args);
}

/**
 * A lookup's own chip line, shared by both engines so the same search draws the
 * same words on screen whichever answered.
 *
 * A web answer is a list of pages, so the JSON clip would show the recruiter a
 * brace and a truncated host. What they need on the chip is the query that ran and
 * whose pages came back — the same words the answer has to name anyway.
 */
export function webChip(value: unknown): string {
  const read = value as {
    query?: string;
    url?: string;
    host?: string;
    error?: string | null;
    sources?: { host: string }[];
  };
  if (read?.error) return read.error.slice(0, 200);
  if (read?.query) {
    const hosts = (read.sources ?? []).map((source) => source.host).slice(0, 3).join(", ");
    return `Searched “${read.query}” — ${(read.sources?.length ?? 0)} pages${hosts ? `: ${hosts}` : ""}`;
  }
  if (read?.url) return `Read ${read.host ?? hostOfUrl(read.url)}`;
  return "Web lookup finished.";
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "a web page";
  }
}

/** Runs one registry tool and shapes its answer for the chip and the model. */
async function executeTool(
  tool: AssistantTool,
  args: ToolArgs
): Promise<{ step: AssistantStep; result: string }> {
  try {
    const built = splitFilePayload(await tool.run(args));
    const value = built.forModel;
    const detail = detailFor(value);
    return {
      step: {
        tool: tool.name,
        label: tool.label,
        ok: typeof value === "object" && value !== null && (value as { ok?: boolean }).ok !== false,
        detail: (
          built.file ? fileChipLine(built.file) : tool.web ? webChip(value) : detail
        ).slice(0, 220),
        link: linkForTool(tool.name, args, value) ?? undefined,
        ask: tool.name === "ask_question" ? asQuestion(value) ?? undefined : undefined,
        chart: chartForTool(tool.name, value) ?? undefined,
        file: built.file,
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
 * The click-through of an approval: the held write, run.
 *
 * Nothing here re-reads the arguments — they are the ones `mintApproval` stored —
 * so what lands in the database is what the card described. The step comes back
 * in the same shape the refused call was shown in, so the chip the recruiter
 * watched turn amber turns green on the row it names.
 */
export async function runApprovedChange(
  toolName: string,
  args: ToolArgs
): Promise<{ step: AssistantStep; result: string }> {
  const tool = toolByName(toolName);
  if (!tool) {
    return {
      step: { tool: toolName, label: "Unknown tool", ok: false, detail: `No tool is called "${toolName}".` },
      result: `{"ok":false,"error":"No such tool."}`,
    };
  }
  return executeTool(tool, args);
}

/**
 * Runs one user turn: as many model calls and tool executions as the answer
 * needs, up to `MAX_TOOL_ROUNDS`, then the model's final reply.
 */
export async function runAssistantTurn(
  history: ChatCompletionMessage[],
  allowDestructive: boolean,
  /** `user_profiles.id` of the signed-in recruiter, who must approve any write. */
  profileId: string,
  /** A model the recruiter chose for this conversation, or nothing to route as usual. */
  modelOverride?: string | null,
  /**
   * The panel's web switch.
   *
   * This belongs to the portal, not to either engine: `search_web` and
   * `read_web_page` do their own fetching through OpenRouter's web search, so the
   * model answering this conversation is free to be Gemini, DeepSeek or whatever
   * the routing table names while the lookup still happens.
   */
  allowWeb = false
): Promise<AssistantTurn> {
  const chosen = modelOverride?.trim() || undefined;
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt(allowDestructive, allowWeb) },
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
      modelOverride: chosen,
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

    const { step, result } = await runTool(
      answer.name,
      answer.args,
      allowDestructive,
      profileId,
      allowWeb
    );
    steps.push(step);

    // A question is an answer as far as this turn is concerned: the choices go on
    // screen and the recruiter's click arrives as the next user message, so
    // feeding the tool's own result back would only invite the model to answer
    // its own question.
    if (step.ask) {
      return { reply: questionAsReply(step.ask), steps, model, provider };
    }

    // An approval is the same shape of turn-end for the same reason: the card is
    // on screen, the click is a separate request, and a model that kept going
    // would chain the next change onto one that has not happened.
    if (step.approval) {
      return { reply: approvalAsReply(step.approval), steps, model, provider };
    }

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
