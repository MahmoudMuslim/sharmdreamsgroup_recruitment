import { randomUUID } from "node:crypto";
import { READ_ONLY_TOOLS, type AssistantTool, type ToolArgs } from "./tools";

/**
 * A change the assistant wants to make, held back until a person approves it.
 *
 * The registry has always run every write through the same server action the
 * screen's button calls, so a chat change had exactly the recruiter's permissions
 * and nothing else. Permissions are not the question this answers: "move her to
 * Interview and tell her" is answered by the model, and the model can be wrong
 * about which Aisha, about the date, or about whether a message should go out at
 * all — and a stage move messages the candidate the moment it lands. The
 * orgarise-shaped fix is the one their assistant page states plainly: an action is
 * confirmed before it is submitted.
 *
 * So a gated tool does not run. The server mints an approval that holds the tool
 * name and the arguments, and the only way those arguments ever reach the database
 * is the recruiter's click carrying the id back. Two consequences worth stating,
 * because both look like bugs from the outside:
 *
 * - the arguments never leave the server, so nothing on the page can be edited
 *   into a different action; the card shows words, the id selects the payload;
 * - the store is per-process. On a host that runs each request in a fresh
 *   isolate, the click cannot find its approval and says so — the change does
 *   not happen, and the recruiter is told to ask again. Silence would be the
 *   worse failure, since it reads as an approval that did nothing.
 */

/** How long an approval stays clickable. Past it the recruiter asks again. */
const APPROVAL_TTL_MS = 20 * 60_000;

/** A list this long is a campaign, and a campaign is worth reading before it goes. */
const MAX_LISTED_IDS = 6;

export interface AssistantApproval {
  /** The only thing the browser ever holds about this change. */
  id: string;
  tool: string;
  /** The registry's own chip label, so the card names the verb the tool is. */
  label: string;
  /** The change in the recruiter's words, with the values they asked for. */
  summary: string;
  /** ISO instant the card stops being clickable. */
  expiresAt: string;
  destructive: boolean;
}

interface PendingApproval extends AssistantApproval {
  profileId: string;
  args: ToolArgs;
  expiresMs: number;
}

const pending = new Map<string, PendingApproval>();

/** Whether this tool must wait for a click before it runs. */
export function requiresApproval(toolName: string): boolean {
  return !READ_ONLY_TOOLS.includes(toolName);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * One argument as the card shows it.
 *
 * Ids are printed because a stage move is approved against a specific record, and
 * a card that hid the id would be approving an action the recruiter cannot check.
 * A long body is clipped — the recruiter wrote it or read it already; the card is
 * there to catch a wrong record, not to re-paste a paragraph.
 */
function describeValue(value: unknown): string {
  if (Array.isArray(value)) {
    const listed = value.slice(0, MAX_LISTED_IDS).map((entry) => clip(String(entry), 40));
    const rest = value.length - listed.length;
    return `${value.length} [${listed.join(", ")}${rest > 0 ? `, +${rest} more` : ""}]`;
  }
  if (typeof value === "object" && value !== null) return clip(JSON.stringify(value), 160);
  return clip(String(value), 200);
}

function summaryFor(tool: AssistantTool, args: ToolArgs): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${describeValue(value)}`);

  return parts.length > 0 ? parts.join(" · ") : tool.description;
}

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.expiresMs <= now) pending.delete(id);
  }
}

/** Hold one write back for a click, bound to the person who is signed in. */
export function mintApproval(tool: AssistantTool, args: ToolArgs, profileId: string): AssistantApproval {
  prune();

  const expiresMs = Date.now() + APPROVAL_TTL_MS;
  const approval: PendingApproval = {
    id: randomUUID(),
    tool: tool.name,
    label: tool.label,
    summary: summaryFor(tool, args),
    expiresAt: new Date(expiresMs).toISOString(),
    destructive: tool.destructive === true,
    profileId,
    args,
    expiresMs,
  };

  pending.set(approval.id, approval);
  return {
    id: approval.id,
    tool: approval.tool,
    label: approval.label,
    summary: approval.summary,
    expiresAt: approval.expiresAt,
    destructive: approval.destructive,
  };
}

/** What the click hands back: the card's own words plus the payload behind it. */
export interface ApprovedChange extends AssistantApproval {
  args: ToolArgs;
}

/**
 * The payload behind a click, consumed on the way out.
 *
 * Single use, so a double click cannot send a campaign twice; owner-bound, so an
 * id seen by one recruiter is not a way to run another's queued change.
 */
export function takeApproval(id: string, profileId: string): ApprovedChange | null {
  const entry = pending.get(id);
  if (!entry) return null;
  pending.delete(id);
  if (entry.profileId !== profileId || entry.expiresMs <= Date.now()) return null;

  return {
    id: entry.id,
    tool: entry.tool,
    label: entry.label,
    summary: entry.summary,
    expiresAt: entry.expiresAt,
    destructive: entry.destructive,
    args: entry.args,
  };
}

/** What the chat says when a turn ends on an approval rather than on an answer. */
export function approvalAsReply(approval: AssistantApproval): string {
  return [
    `**Nothing has run yet — this is waiting for you.**`,
    "",
    `${approval.label}: ${approval.summary}`,
    "",
    approval.destructive
      ? "Approving runs the delete you already switched on in this panel. Ignore this and the record stays as it is."
      : "Approve below and it runs the moment you click, through the same action the button on that screen runs. Ignore it and nothing changes.",
    "",
    `The offer expires at ${new Date(approval.expiresAt).toLocaleString("en-GB")}.`,
  ].join("\n");
}

/**
 * What the model is told instead of a result.
 *
 * Without this an agent that asked for a stage move would read a quiet tool call
 * as success and reply "done" — which is the exact false claim this whole pass
 * exists to stop.
 */
export function approvalToolResult(approval: AssistantApproval): string {
  return JSON.stringify({
    ok: false,
    pending_approval: true,
    approval_id: approval.id,
    summary: approval.summary,
    instruction:
      "NOTHING WAS CHANGED. The action is on the recruiter's screen as an approval card and runs only if they click Approve. End your turn now and say it is waiting for their approval — never report it as done.",
  });
}
