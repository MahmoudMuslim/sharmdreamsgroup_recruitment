"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock,
  CornerUpLeft,
  ExternalLink,
  FileText,
  History,
  Info,
  ListTree,
  Loader2,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RichReply } from "@/modules/assistant/presentation/RichReply";
import { ReplyChart } from "@/modules/assistant/presentation/ReplyChart";
import { cardsOfTurn } from "@/modules/assistant/presentation/turnCards";
import { whenLabel } from "@/modules/assistant/presentation/whenLabel";
import type { AssistantChart } from "@/modules/assistant/domain/charts";
import type { AssistantLink } from "@/modules/assistant/domain/links";
import type { AssistantEngine } from "@/modules/assistant/domain/engine";
import type { AssistantApproval } from "@/modules/assistant/domain/approvals";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";
import type { AssistantQuestion } from "@/modules/assistant/domain/tools";
import {
  approveAssistantChange,
  extractAssistantAttachmentText,
  getAssistantCapabilities,
  getAssistantModelChoices,
  getAssistantSessions,
  openAssistantSession,
  sendAssistantMessage,
  type AssistantAttachment,
  type AssistantCapability,
  type AssistantModelChoice,
  type AssistantSessionSummary,
} from "./actions";
import { AssistantSettings } from "./AssistantSettings";

/**
 * The assistant's conversation: transcript, tool-step chips, cards awaiting a
 * click, composer, engine picker, capability list and — in the dock — the list of
 * saved conversations.
 *
 * Both doors into the assistant render this — the panel docked to every admin
 * screen, and the full Assistant page with its history rail. The chat itself is
 * the same in each, so an answer cannot read differently depending on where it
 * was asked. Only the dock adds the saved-conversations panel, since the page
 * already carries that list beside the box.
 *
 * The transcript is stored as it is written (`sessionId` names the saved
 * conversation), which is what lets a question asked in the dock be picked up
 * tomorrow on the page. `sessionId` is owned by the caller: the dock keeps the
 * last one it used, the page keeps whichever row of the rail is selected.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: AssistantStep[];
  model?: string;
  provider?: string;
  /** Shown when the preferred engine failed and the other one answered. */
  note?: string;
  /** Held so later turns can still read the file the recruiter attached. */
  attachmentName?: string;
  attachmentText?: string;
}

const STARTERS = [
  "How is the pipeline looking this fortnight?",
  "Which openings have no applicants?",
  "Screen the newest applicant on my busiest role",
  "Show the interview-stage candidates as a table",
  "What model is resume screening using?",
] as const;

const ENGINES: readonly { id: AssistantEngine; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Qoder when this host can run it, the model gateway otherwise." },
  {
    id: "qoder",
    label: "Qoder",
    hint: "Always the Qoder agent. Needs a stored token and the Qoder agent runtime installed on the server.",
  },
  {
    id: "gateway",
    label: "Gateway",
    hint: "Always the model gateway — either the one routed in Settings → AI models, or the one picked below.",
  },
];

const ENGINE_KEY = "sdg-assistant-engine";

/** Matches the server's own clip, so history never arrives carrying more. */
const MAX_ATTACHMENT_IN_HISTORY = 12_000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED_FILES = ".pdf,.doc,.docx,.txt,.md";

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Read lazily rather than in an effect: a stored engine can be applied on the
 * first render instead of flashing the default.
 */
function readStoredEngine(): AssistantEngine {
  try {
    const raw = window.localStorage.getItem(ENGINE_KEY);
    return raw === "qoder" || raw === "gateway" || raw === "auto" ? raw : "auto";
  } catch {
    return "auto";
  }
}

function writeStoredEngine(value: AssistantEngine): void {
  try {
    window.localStorage.setItem(ENGINE_KEY, value);
  } catch {
    // Storage blocked (private mode) — the choice simply applies to this panel.
  }
}

/* ------------------------------- Web search ------------------------------- */

const WEB_KEY = "sdg-assistant-web";

/**
 * Whether this browser's assistant may leave the portal to look something up.
 *
 * A preference, like the engine, so it lives in `localStorage` and survives a new
 * conversation: switching it on to ask about pay bands should not have to be
 * re-clicked tomorrow. It is still never applied to a write — the switch only
 * opens the two read-only lookups, and the deletion switch is separate.
 */
function readStoredWeb(): boolean {
  try {
    return window.localStorage.getItem(WEB_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredWeb(value: boolean): void {
  try {
    window.localStorage.setItem(WEB_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked — the choice applies to this panel only.
  }
}

/* ----------------------------- Model override ----------------------------- */

const MODEL_KEY = "sdg-assistant-model";

/**
 * The model chosen for this conversation.
 *
 * `sessionStorage`, not `localStorage`, and nothing written to Settings: a model
 * picked to try an answer is a decision about this sitting-down, and closing the
 * tab hands the routing table back its authority. The engine the recruiter chose
 * is a preference and does live in `localStorage` — this is not.
 */
function readStoredModel(): string {
  try {
    return window.sessionStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredModel(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(MODEL_KEY, value);
    else window.sessionStorage.removeItem(MODEL_KEY);
  } catch {
    // Storage blocked — the choice simply applies to this panel.
  }
}

/* ------------------------------ Draft notes ------------------------------ */

const DRAFT_KEY = "sdg-assistant-draft";
/** Past a month the browser stops carrying it; it is a note, not a record. */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Exactly the longest question the server will accept, so nothing kept here is unsendable. */
const MAX_DRAFT_CHARS = 4_000;

function readDraft(): string {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { text?: unknown; at?: unknown };
    if (typeof parsed?.text !== "string" || typeof parsed.at !== "number") return "";
    if (Date.now() - parsed.at > DRAFT_TTL_MS || parsed.text.length > MAX_DRAFT_CHARS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return "";
    }
    return parsed.text;
  } catch {
    return "";
  }
}

/** An empty or over-long box stores nothing: the first is sent, the second refused. */
function writeDraft(text: string): void {
  try {
    if (text.trim().length === 0 || text.length > MAX_DRAFT_CHARS) {
      window.localStorage.removeItem(DRAFT_KEY);
    } else {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, at: Date.now() }));
    }
  } catch {
    // Storage blocked or full — the draft simply lives only in this panel.
  }
}

/** The headline of a failure, kept to one readable line. */
const MAX_HEADLINE_CHARS = 180;

/**
 * What to do next, read off what the server actually reported.
 *
 * A guessed instruction sends a recruiter hunting for a settings switch that is
 * not the problem, so anything unrecognised falls back to the one sentence that
 * is always true here: a failed turn changed nothing.
 */
function nextStepFor(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("429") || text.includes("rate") || text.includes("quota")) {
    return "That provider has spent its allowance for the moment. Pick another model below, or wait a minute and send it again.";
  }
  if (
    text.includes("502") ||
    text.includes("503") ||
    text.includes("overload") ||
    text.includes("unavailable") ||
    text.includes("timeout")
  ) {
    return "That provider is not answering right now. Send it again, or choose a different model below.";
  }
  if (text.includes("key") || text.includes("credential") || text.includes("token")) {
    return "Settings → API keys holds the credential this answer needed — check it is there and verified.";
  }
  if (text.includes("model")) {
    return "Choose another model below, or leave it on default routing, which uses the one named in Settings → AI models.";
  }
  if (text.includes("approval")) {
    return "Nothing has changed. Ask for the same change again and the card goes back up.";
  }
  if (text.includes("conversation")) {
    return "The conversation itself is still stored — try opening it again, or start a new one.";
  }
  if (text.includes("ask me something")) {
    return "Type the question in the box below, then send it.";
  }
  return "Nothing was changed by this. Send the question again, or ask for a smaller piece of it.";
}

/**
 * A failure the operator can read and act on.
 *
 * The gateway reports every provider hop it tried, which is the right thing for
 * diagnosing an outage and far too much to read in a chat bubble — so the first
 * hop is the headline, the rest sits behind a disclosure, and the line under it
 * names the next move rather than leaving the panel looking broken.
 */
function FailureNote({
  tone = "hard",
  message,
  hint,
  action,
}: {
  tone?: "hard" | "soft";
  message: string;
  /** Overrides the read-off next step when the caller knows better. */
  hint?: string;
  action?: { label: string; run: () => void } | null;
}) {
  const hops = message.split(" | ");
  const headline =
    hops[0].length <= MAX_HEADLINE_CHARS ? hops[0] : `${hops[0].slice(0, MAX_HEADLINE_CHARS)}…`;
  const raw = hops.slice(1).join(" | ").trim();

  return (
    <div
      role="alert"
      className={cn(
        "mb-2 rounded-xl border p-2.5",
        tone === "hard" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"
      )}
    >
      <p
        className={cn(
          "flex items-start gap-1.5 text-xs font-bold leading-snug",
          tone === "hard" ? "text-rose-700" : "text-amber-700"
        )}
      >
        {tone === "hard" ? (
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0">{headline}</span>
      </p>
      <p className="mt-1 pl-5 text-[11px] leading-relaxed text-brand-ink/65">{hint ?? nextStepFor(message)}</p>

      {raw && (
        <details className="mt-1 pl-5">
          <summary className="cursor-pointer text-[10px] font-semibold text-brand-ink/45">
            What the server reported
          </summary>
          <pre className="rail-scroll mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[10px] font-medium leading-relaxed text-brand-ink/60">
            {message}
          </pre>
        </details>
      )}

      {action && (
        <button
          type="button"
          onClick={action.run}
          className="mt-1.5 ml-5 inline-flex items-center gap-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[10px] font-bold text-brand-ink/65 transition hover:bg-brand-sand"
        >
          <CornerUpLeft className="h-3 w-3" aria-hidden />
          {action.label}
        </button>
      )}
    </div>
  );
}

function StepChip({ step }: { step: AssistantStep }) {
  const router = useRouter();
  const link: AssistantLink | null = step.link ?? null;
  // A held write is not a failed one. Rendering it in rose would tell the
  // recruiter the action went wrong, when the truth is that it has not run yet.
  const tone = step.approval ? "waiting" : step.ok ? "done" : "failed";

  return (
    <li className="flex items-center gap-1">
      <span
        title={step.detail}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          tone === "done" && "border-brand-line bg-white text-brand-ink/60",
          tone === "waiting" && "border-amber-200 bg-amber-50 text-amber-700",
          tone === "failed" && "border-rose-200 bg-rose-50 text-rose-700"
        )}
      >
        {tone === "done" ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : tone === "waiting" ? (
          <Clock className="h-3 w-3" aria-hidden />
        ) : (
          <AlertTriangle className="h-3 w-3" aria-hidden />
        )}
        {step.label}
      </span>
      {link && (
        <button
          type="button"
          onClick={() => router.push(link.href)}
          title={link.href}
          className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-gold/15 px-2 py-0.5 text-[11px] font-bold text-brand-gold-dark transition hover:bg-brand-gold/30"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {link.label}
        </button>
      )}
    </li>
  );
}

function StepChips({ steps }: { steps: AssistantStep[] }) {
  if (steps.length === 0) return null;

  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5">
      {steps.map((step, index) => (
        <StepChip key={`${step.tool}-${index}`} step={step} />
      ))}
    </ul>
  );
}

/**
 * The answer buttons for a question the assistant asked.
 *
 * Choosing sends that option as the next message, so the reply the model reads
 * is exactly what the recruiter picked — no id or index for it to reinterpret.
 * A question the conversation has moved past stays on screen, greyed and marked
 * with what was actually answered, so an old thread reads as a Q&A and not as a
 * list of open tasks.
 *
 * `showQuestion` prints the question above the buttons. The bubble normally
 * carries it, but a turn that asked twice or answered in prose before asking
 * has no copy of the second question outside this card — and a row of nameless
 * buttons is the thing that used to look broken.
 */
function QuestionChoices({
  ask,
  showQuestion,
  live,
  answered,
  pending,
  onChoose,
}: {
  ask: AssistantQuestion;
  showQuestion: boolean;
  live: boolean;
  answered: string | null;
  pending: boolean;
  onChoose: (option: string) => void;
}) {
  return (
    <div className="mt-1.5">
      {showQuestion && (
        <p className="mb-1 text-[11px] font-bold leading-snug text-brand-ink">{ask.question}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {ask.options.map((option, index) => {
          const chosen = answered === option;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              disabled={!live || pending}
              onClick={() => onChoose(option)}
              title={
                live
                  ? `Answer: ${option}`
                  : answered
                    ? `Already answered: ${answered}`
                    : "Answered by a later message — click through the composer instead"
              }
              aria-disabled={!live || pending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] font-semibold transition",
                chosen
                  ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
                  : live
                    ? "border-brand-line bg-white text-brand-ink/75 hover:border-brand-gold hover:bg-brand-gold/10"
                    : "border-brand-line/60 bg-brand-cream text-brand-ink/40"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  chosen ? "bg-brand-gold-dark text-brand-cream" : "bg-brand-sand text-brand-ink/60"
                )}
              >
                {chosen ? <Check className="h-2.5 w-2.5" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0">{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The question as a bubble: its text, not the numbered list the model was fed. */
function askBubble(ask: AssistantQuestion): string {
  return ask.context ? `${ask.context}\n\n${ask.question}` : ask.question;
}

/**
 * The notice for a live question that has no buttons.
 *
 * It happens for two reasons the recruiter cannot see: `ask_question` refused
 * the choices it was given, or the model wrote the question into its prose
 * instead of calling the tool. Either way the panel has nothing to click, and
 * saying so is the difference between a broken-looking chat and a question to
 * answer by typing.
 */
function TypedAnswerNote() {
  return (
    <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-brand-ink/70">
      <Info className="mr-1 inline h-3 w-3 text-amber-700" aria-hidden />
      This question has no buttons — the choices the assistant tried to offer were not usable.
      Answer it in the box below.
    </p>
  );
}

/**
 * The chart this turn earned, walked backwards: a turn can read the metrics more
 * than once, and the last read is the one the answer below it is built on.
 */
function chartOf(steps: AssistantStep[] | undefined): AssistantChart | null {
  if (!steps) return null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const chart = steps[index].chart;
    if (chart) return chart;
  }
  return null;
}

/**
 * The change the assistant wants to make, held until a person agrees to it.
 *
 * Nothing runs on the model's say-so: this card is the only way a chat write
 * reaches the database. The values on it are the ones the server holds for this
 * id, so what is described is exactly what the click applies — and ignoring it
 * is a real option, which is why the card says what ignoring does.
 */
function ApprovalCard({
  approval,
  live,
  busy,
  onApprove,
}: {
  approval: AssistantApproval;
  live: boolean;
  busy: boolean;
  onApprove: (approval: AssistantApproval) => void;
}) {
  return (
    <div
      className={cn(
        "mt-1.5 rounded-xl border p-2.5",
        approval.destructive ? "border-rose-200 bg-rose-50/70" : "border-brand-gold bg-brand-gold/10"
      )}
    >
      <p
        className={cn(
          "text-[10px] font-bold uppercase tracking-wide",
          approval.destructive ? "text-rose-700" : "text-brand-gold-dark"
        )}
      >
        {approval.destructive ? "Delete waiting for you" : "Change waiting for you"}
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug text-brand-ink">{approval.label}</p>
      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-brand-ink/65">
        {approval.summary}
      </p>
      {live ? (
        <>
          <button
            type="button"
            onClick={() => onApprove(approval)}
            disabled={busy}
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition",
              "disabled:cursor-not-allowed disabled:opacity-50",
              approval.destructive
                ? "bg-rose-600 text-brand-on-accent hover:bg-rose-700"
                : "bg-brand-gold text-brand-ink hover:bg-brand-gold/70"
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "Applying…" : approval.destructive ? "Approve the delete" : "Approve & run"}
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/45">
            {`Ignoring this leaves the record exactly as it is. The offer expires at ${new Date(
              approval.expiresAt
            ).toLocaleString("en-GB")}.`}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-brand-ink/40">
          {
            "No longer clickable — either you answered it below, or the conversation has moved past it."
          }
        </p>
      )}
    </div>
  );
}

function Capabilities({ onClose }: { onClose: () => void }) {
  const [tools, setTools] = useState<AssistantCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getAssistantCapabilities();
        if (!active) return;
        setTools(result);
      } catch {
        if (active) setError("The capability list could not be loaded.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">What I can do</h3>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            Every entry runs the same server action as the button on its screen, so your role
            permissions apply unchanged. Reads answer straight away; anything that changes a record
            is held here as a card and runs only if you approve it.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {error && <FailureNote message={error} />}

      {!error && tools === null && (
        <p className="mt-4 flex items-center gap-2 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      )}

      {tools && (
        <ul className="mt-4 space-y-2">
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="rounded-xl border border-brand-line bg-white p-3 shadow-soft"
            >
              <p className="flex items-center gap-1.5 font-display text-xs font-bold">
                <Wrench className="h-3 w-3 text-brand-gold-dark" aria-hidden />
                {tool.label}
                {tool.needsApproval && (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      tool.destructive ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {tool.destructive
                      ? "needs “Allow deletions”, then your approval"
                      : "waits for your approval"}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/60">
                {tool.description}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The saved conversations, inside the docked panel.
 *
 * The Assistant page has a rail beside the chat; the panel floats over whatever
 * screen the recruiter is on and had no way back into a past conversation
 * except by walking to that page. This is that way: every one of yours, newest
 * first, with the counts and the engine that answered it.
 *
 * Renaming and deleting stay on the page, which has room for those buttons —
 * the list says so rather than looking like a panel that forgot to offer them.
 */
function SessionList({
  current,
  onSelect,
  onClose,
}: {
  current: string | null;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<AssistantSessionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await getAssistantSessions();
        if (active) setSessions(rows);
      } catch {
        if (active) {
          setSessions([]);
          setListError("Your saved conversations could not be loaded.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">Your conversations</h3>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            Pick one to carry it on here, in the panel floating over the screen you are on. Only
            you see these.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {listError && (
        <div className="mt-3">
          <FailureNote
            message={listError}
            hint="Nothing was lost — the list simply did not arrive. Close this and open it again."
          />
        </div>
      )}
      {!listError && sessions === null && (
        <p className="mt-4 flex items-center gap-2 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      )}
      {sessions && sessions.length === 0 && !listError && (
        <p className="mt-4 text-xs leading-relaxed text-brand-ink/55">
          Nothing saved yet. Ask the assistant something and the conversation appears in this list
          as soon as it has an answer.
        </p>
      )}

      <ul className="mt-4 space-y-1.5">
        {(sessions ?? []).map((session) => {
          const isActive = session.id === current;
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-left transition",
                  isActive
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-brand-line bg-white hover:bg-brand-cream"
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-bold text-brand-ink">
                  <span className="min-w-0 truncate">{session.title}</span>
                  {isActive && (
                    <Check
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-gold-dark"
                      aria-hidden
                    />
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-brand-ink/50">
                  {session.messageCount} message{session.messageCount === 1 ? "" : "s"} ·{" "}
                  {whenLabel(session.updatedAt)}
                  {session.engine ? ` · ${session.engine}` : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {sessions && sessions.length > 0 && (
        <p className="mt-3 text-[10px] leading-relaxed text-brand-ink/45">
          Renaming or deleting a conversation happens on the{" "}
          <button
            type="button"
            onClick={() =>
              router.push(
                current ? `/assistant?session=${encodeURIComponent(current)}` : "/assistant"
              )
            }
            className="font-bold text-brand-gold-dark underline underline-offset-2"
          >
            Assistant page
          </button>
          , which has room for those two buttons.
        </p>
      )}
    </div>
  );
}

export interface AssistantChatProps {
  /** The saved conversation the transcript is written to, or null for a new one. */
  sessionId: string | null;
  /** Called with the id of a conversation the first turn just created. */
  onSessionChange: (sessionId: string) => void;
  onNewConversation: () => void;
  variant: "docked" | "page";
}

export function AssistantChat({
  sessionId,
  onSessionChange,
  onNewConversation,
  variant,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraftState] = useState(() => readDraft());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allowDestructive, setAllowDestructive] = useState(false);
  /**
   * Lets this assistant leave the portal for a lookup. Remembered in
   * `localStorage`, and sent whichever engine or model answers the turn — the
   * search is the portal's own tool, not a capability one engine happens to have.
   */
  const [allowWeb, setAllowWeb] = useState(false);
  /** The approval card being applied, so its button cannot fire twice. */
  const [approving, setApproving] = useState<string | null>(null);
  const [showCapabilities, setShowCapabilities] = useState(false);
  /** The docked panel's own way back into a saved conversation. */
  const [showSessions, setShowSessions] = useState(false);
  // The stored preference is applied in the restore effect below: reading it here
  // would make the first client render disagree with the server's, because the
  // server has no localStorage to read.
  const [engine, setEngine] = useState<AssistantEngine>("auto");
  /** "" means the routing table answers; anything else is this conversation's model. */
  const [model, setModel] = useState("");
  /** null while the catalogue is still being read, an empty list when it failed. */
  const [models, setModels] = useState<AssistantModelChoice[] | null>(null);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [routedModel, setRoutedModel] = useState("");
  const [attachment, setAttachment] = useState<AssistantAttachment | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [opening, setOpening] = useState(sessionId !== null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Which conversation the transcript on screen belongs to.
   *
   * Starts empty so mounting always reads the session the caller named — a
   * remount is exactly what "reload this from storage" means. A first turn then
   * makes the session and reports its id back, and that arriving here must not
   * trigger a reload of the exchange the panel just wrote.
   */
  const shownSession = useRef<string | null>(null);

  /**
   * The half-typed question, kept in the browser.
   *
   * Closing the docked panel unmounts this component, and so does walking to
   * another screen, so the composer's text would otherwise be thrown away and the
   * recruiter would retype it. One slot rather than one per conversation: the
   * question being written belongs to the person, not to the thread it will
   * land in, and a first turn renames the thread while the box is still empty.
   */
  const draftRef = useRef(draft);

  function setDraft(text: string) {
    draftRef.current = text;
    setDraftState(text);
    writeDraft(text);
  }

  // Keep the newest exchange in view, including while an answer is still coming.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, pending, showCapabilities]);

  // Restore a conversation when the caller names one that is not on screen.
  useEffect(() => {
    let active = true;

    const load = async () => {
      if (shownSession.current === sessionId) return;

      if (!sessionId) {
        shownSession.current = null;
        setMessages([]);
        setError(null);
        setSaveError(null);
        setOpening(false);
        setEngine(readStoredEngine());
        return;
      }

      setOpening(true);
      try {
        const opened = await openAssistantSession(sessionId);
        if (!active) return;

        // Only claimed once the turns are actually on screen. A load that gets
        // discarded on unmount must leave the next one free to fetch, or the
        // panel sits on "Opening…" for a conversation it never read.
        shownSession.current = sessionId;
        setMessages(
          (opened?.messages ?? []).map((message) => ({
            id: message.id,
            role: message.role,
            text: message.content,
            steps: message.steps,
            model: message.model ?? undefined,
            provider: message.provider ?? undefined,
            note: message.note ?? undefined,
            attachmentName: message.attachmentName ?? undefined,
            attachmentText: message.attachmentText ?? undefined,
          }))
        );
        setError(null);
        setSaveError(null);
        // The engine this thread was answered by wins over the stored default.
        if (opened?.engine) setEngine(opened.engine);
      } catch {
        if (active) setError("That conversation could not be opened.");
      } finally {
        if (active) setOpening(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [sessionId]);

  function chooseEngine(next: AssistantEngine) {
    setEngine(next);
    writeStoredEngine(next);
  }

  /**
   * A named model is served by the gateway, which is the engine that takes a
   * model id, so the control above moves with the choice rather than leaving a
   * selected Qoder that would quietly answer with something else.
   */
  function chooseModel(next: string) {
    setModel(next);
    writeStoredModel(next);
    if (next && engine !== "gateway") chooseEngine("gateway");
  }

  // Read the catalogue this panel is allowed to offer, once, and restore whatever
  // this browser session was already using.
  useEffect(() => {
    let active = true;

    const load = async () => {
      setModel(readStoredModel());
      setAllowWeb(readStoredWeb());

      try {
        const result = await getAssistantModelChoices();
        if (!active) return;
        if (result.ok) {
          setModels(result.models);
          setRoutedModel(result.defaultModel);
          setModelListError(
            result.degraded
              ? "Some providers did not answer just now, so this list may be shorter than usual."
              : null
          );
        } else {
          setModels([]);
          setModelListError(result.error ?? "The model list could not be read.");
        }
      } catch {
        if (active) {
          setModels([]);
          setModelListError("The model list could not be read.");
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function attachFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 8 MB.");
      return;
    }
    setError(null);
    setExtracting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await extractAssistantAttachmentText(body);
      if (!result.ok || !result.text) {
        setError(result.error ?? "That file could not be read.");
        return;
      }
      setAttachment({ name: result.name ?? file.name, text: result.text });
    } catch {
      setError("The file could not be read. Check it is a PDF, Word document, .txt or .md.");
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** The turn as the model sees it: the question with any attached text under it. */
  function contentOf(message: ChatMessage): string {
    if (message.role !== "user" || !message.attachmentText) return message.text;
    return `${message.text}\n\nAttached file “${message.attachmentName ?? "file"}” — extracted text:\n"""\n${message.attachmentText.slice(
      0,
      MAX_ATTACHMENT_IN_HISTORY
    )}\n"""`;
  }

  /**
   * Put a question that was already sent back into the composer — after a failed
   * answer, or to ask the same thing of a different candidate. Only the click
   * does this: a turn that failed leaves the question where it is and nothing is
   * typed into the recruiter's box unasked.
   */
  function reuse(message: ChatMessage) {
    setDraft(message.text);
    if (message.attachmentName && message.attachmentText) {
      setAttachment({ name: message.attachmentName, text: message.attachmentText });
    }
    setError(null);
    requestAnimationFrame(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }

  async function send(promptRaw?: string) {
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt || pending || extracting) return;

    // Snapshot before appending: the question being asked is sent separately.
    const history = messages.map((message) => ({
      role: message.role,
      content: contentOf(message),
    }));
    const attached = attachment;

    setMessages((current) => [
      ...current,
      {
        id: nextId(),
        role: "user",
        text: prompt,
        attachmentName: attached?.name,
        attachmentText: attached?.text,
      },
    ]);
    setDraft("");
    setAttachment(null);
    setError(null);
    setSaveError(null);
    setPending(true);
    setShowCapabilities(false);
    setShowSessions(false);

    try {
      const result = await sendAssistantMessage({
        history,
        prompt,
        allowDestructive,
        allowWeb,
        engine,
        model: model || null,
        attachment: attached ?? undefined,
        sessionId,
      });
      if (!result.ok) {
        setError(result.error ?? "The assistant could not answer that.");
        return;
      }
      if (result.sessionId) {
        shownSession.current = result.sessionId;
        onSessionChange(result.sessionId);
      }
      setSaveError(result.saveError ?? null);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: result.reply ?? "",
          steps: result.steps,
          model: result.model,
          provider: result.provider,
          note: result.note,
        },
      ]);
    } catch {
      setError("The assistant could not be reached. Check the AI keys in Settings and try again.");
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  /**
   * Run the one change an approval card was holding.
   *
   * Only the id travels. The server keeps the arguments it minted the card with,
   * so this click cannot be steered at another record, and the outcome is
   * appended as its own turn — which is what makes the card stop being clickable.
   */
  async function approve(approval: AssistantApproval) {
    if (approving || pending) return;
    setApproving(approval.id);
    setError(null);

    try {
      const result = await approveAssistantChange({
        approvalId: approval.id,
        sessionId: sessionId ?? null,
      });
      if (!result.reply) {
        setError(result.error ?? "The approval could not be applied. Nothing has changed.");
        return;
      }
      const outcome = result.reply;
      if (result.saveError) setSaveError(result.saveError);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: outcome,
          steps: result.steps,
        },
      ]);
    } catch {
      setError("The approval could not be applied. Nothing has changed.");
    } finally {
      setApproving(null);
    }
  }

  const wide = variant === "page";

  /** The question a failure can put back in the box, newest first. */
  const lastQuestion = [...messages].reverse().find((message) => message.role === "user") ?? null;

  return (
    <>
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-brand-line bg-white px-3 py-2",
          variant === "page" && "px-4"
        )}
      >
        <div role="group" aria-label="Answering engine" className="flex items-center gap-0.5 rounded-lg border border-brand-line bg-brand-cream p-0.5">
          {ENGINES.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              onClick={() => chooseEngine(option.id)}
              aria-pressed={engine === option.id}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-bold transition",
                engine === option.id
                  ? "bg-brand-ink text-brand-cream"
                  : "text-brand-ink/55 hover:bg-brand-sand"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2 py-1 text-[11px] font-bold text-brand-ink/60 transition hover:bg-brand-sand"
          title="Start another conversation — this one stays in your history"
        >
          <Plus className="h-3 w-3" aria-hidden />
          New
        </button>

        {/*
          The page has a rail beside the chat; the panel floats over someone's
          work and had no way back into a conversation it saved. Only the dock
          gets this button — on the page the list would sit twice on screen.
        */}
        {variant === "docked" && (
          <button
            type="button"
            onClick={() => {
              setShowSessions((current) => !current);
              setShowCapabilities(false);
            }}
            aria-label="Your saved conversations"
            title="Your saved conversations"
            aria-pressed={showSessions}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition",
              showSessions
                ? "border-brand-gold bg-brand-gold/20 text-brand-gold-dark"
                : "border-brand-line text-brand-ink/60 hover:bg-brand-sand"
            )}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setShowCapabilities((current) => !current);
            setShowSessions(false);
          }}
          aria-label="What can the assistant do?"
          title="What can the assistant do?"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {showSessions ? (
        <SessionList
          current={sessionId}
          onSelect={(id) => {
            onSessionChange(id);
            setShowSessions(false);
          }}
          onClose={() => setShowSessions(false)}
        />
      ) : showCapabilities ? (
        <Capabilities onClose={() => setShowCapabilities(false)} />
      ) : (
        <div
          ref={scrollRef}
          className={cn("rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain", variant === "page" ? "px-6 py-5" : "p-4")}
        >
          <div className={cn("space-y-3", wide && "mx-auto max-w-3xl")}>
            {messages.length === 0 && !pending && !opening && (
              <div>
                <p className="text-xs leading-relaxed text-brand-ink/55">
                  I read and change the same data the screens do — openings, candidates, screening,
                  assessments, interviews, onboarding, the apply questions, sourcing, stored files,
                  the message outbox, the analytics report, the row-level reports, and the settings,
                  team, model-routing, API-keys and change-trail consoles — by calling the very
                  actions those pages call, so the permissions on your role apply here unchanged.
                  Time Tracker and the hiring-data activity trail are the two screens I cannot read:
                  neither table is on the database yet. The “What can the assistant do?” button
                  above lists every one.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
                  Attach a CV and I read it — PDF, Word or plain text, through the same parser the
                  apply form uses, so it reads the way it did when it arrived. Only the first 12,000
                  characters reach the model and the file is not stored. Anything I change comes back
                  with a link to where you can see it: the record when the page opens one, the page
                  itself otherwise.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-ink/45">
                  <Sparkles className="mr-1 inline h-3 w-3 text-brand-gold" aria-hidden />
                  Every conversation you start here is saved — open an older one from{" "}
                  {variant === "docked"
                    ? "the saved-conversations button above"
                    : "the rail beside this box"}
                  , or close this panel and carry on where you left off. Anything you have typed but
                  not sent comes back with it, and when a request could mean several records I ask
                  and put the choices under the question for you to click.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {STARTERS.map((starter) => (
                    <li key={starter}>
                      <button
                        type="button"
                        onClick={() => void send(starter)}
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-left text-xs font-semibold text-brand-ink/75 transition hover:bg-brand-sand"
                      >
                        {starter}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {opening && (
              <p className="flex items-center gap-2 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Opening this conversation…
              </p>
            )}

            {messages.map((message, index) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="ml-auto max-w-[85%] space-y-1">
                    <p className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-ink px-3 py-2 text-sm text-brand-cream">
                      {message.text}
                    </p>
                    {message.attachmentName && (
                      <p className="flex items-center justify-end gap-1.5 pr-1 text-[11px] font-semibold text-brand-ink/50">
                        <FileText className="h-3 w-3" aria-hidden />
                        {message.attachmentName}
                      </p>
                    )}
                    <p className="flex justify-end pr-1">
                      <button
                        type="button"
                        onClick={() => reuse(message)}
                        disabled={pending || extracting}
                        title="Put this question back in the box to edit and send again"
                        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink/70 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CornerUpLeft className="h-3 w-3" aria-hidden />
                        Edit and send again
                      </button>
                    </p>
                  </div>
                );
              }

              // Every card this turn raised, not only the last — see turnCards.
              const live = !pending && index === messages.length - 1;
              const { cards, asks, bubbleAsk, needsTypedAnswer } = cardsOfTurn(
                message.text,
                message.steps,
                live
              );
              const chart = chartOf(message.steps);
              const answered = asks.length
                ? (messages.slice(index + 1).find((entry) => entry.role === "user")?.text ?? null)
                : null;

              return (
                <div key={message.id} className="max-w-[92%]">
                  <StepChips steps={message.steps ?? []} />
                  <div className="rounded-2xl rounded-bl-sm border border-brand-line bg-brand-cream px-3 py-2.5 text-sm leading-relaxed text-brand-ink">
                    <RichReply text={bubbleAsk ? askBubble(bubbleAsk) : message.text} />
                    {chart && !bubbleAsk && (
                      <>
                        <ReplyChart chart={chart} className="mt-2.5" />
                        <p className="mt-1.5 text-[10px] leading-snug text-brand-ink/40">
                          These bars are drawn by the portal from the figures this answer read —
                          the model chose the view, not the numbers.
                        </p>
                      </>
                    )}
                  </div>
                  {cards.map((step, cardIndex) =>
                    step.ask ? (
                      <QuestionChoices
                        key={`${step.tool}-${cardIndex}`}
                        ask={step.ask}
                        showQuestion={step.ask !== bubbleAsk}
                        live={live}
                        answered={answered}
                        pending={pending}
                        onChoose={(option) => void send(option)}
                      />
                    ) : step.approval ? (
                      <ApprovalCard
                        key={`${step.tool}-${cardIndex}`}
                        approval={step.approval}
                        live={live}
                        busy={approving === step.approval.id}
                        onApprove={(entry) => void approve(entry)}
                      />
                    ) : null
                  )}
                  {needsTypedAnswer && <TypedAnswerNote />}
                  {message.note && (
                    <p className="mt-1 pl-1 text-[11px] leading-relaxed text-amber-700">
                      {message.note}
                    </p>
                  )}
                  {message.model && (
                    <p className="mt-1 pl-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
                      {message.provider ? `${message.provider} · ${message.model}` : message.model}
                    </p>
                  )}
                </div>
              );
            })}

            {pending && (
              <p className="flex items-center gap-2 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Working…
              </p>
            )}
          </div>
        </div>
      )}

      {!showCapabilities && !showSessions && (
        <footer className={cn("shrink-0 border-t border-brand-line bg-white", variant === "page" ? "px-6 py-4" : "p-3")}>
          <div className={cn(wide && "mx-auto max-w-3xl")}>
            {error && (
              <FailureNote
                message={error}
                action={
                  lastQuestion
                    ? { label: "Put my question back in the box", run: () => reuse(lastQuestion) }
                    : null
                }
              />
            )}

            {saveError && (
              <FailureNote
                tone="soft"
                message={saveError}
                hint="The answer above is real — it is only missing from the list you open tomorrow."
              />
            )}

            {attachment && (
              <p className="mb-2 flex items-center gap-2 rounded-xl border border-brand-gold bg-brand-gold/15 px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink">
                <FileText className="h-3.5 w-3.5 shrink-0 text-brand-gold-dark" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.name} — {attachment.text.length.toLocaleString()} characters ready
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label={`Remove ${attachment.name}`}
                  className="rounded-md p-1 text-brand-ink/55 transition hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </p>
            )}

            {/*
              The model choice and the two switches used to sit above the box, and
              their copy is long enough to push the transcript out of a short dock.
              They are behind a button now — same controls, same words.
            */}
            <AssistantSettings
              model={model}
              routedModel={routedModel}
              models={models}
              onChooseModel={chooseModel}
              allowWeb={allowWeb}
              onAllowWeb={(next) => {
                setAllowWeb(next);
                writeStoredWeb(next);
              }}
              allowDestructive={allowDestructive}
              onAllowDestructive={setAllowDestructive}
            />

            {modelListError && (
              <FailureNote
                tone="soft"
                message={modelListError}
                hint="Leave the choice on default routing and the model named in Settings → AI models answers — that route does not depend on this list."
              />
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_FILES}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attachFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending || extracting}
                aria-label="Attach a document"
                title="Attach a CV or document to read"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-40"
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="h-4 w-4" aria-hidden />
                )}
              </button>
              <textarea
                ref={inputRef}
                rows={wide ? 3 : 2}
                value={draft}
                disabled={pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={attachment ? "Ask about the attached file…" : "Ask or instruct…"}
                aria-label="Message the assistant"
                className="rail-scroll min-h-[2.75rem] flex-1 resize-none rounded-xl border border-brand-line bg-white px-3 py-2 text-sm outline-none transition placeholder:text-brand-ink/35 focus:border-brand-gold disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={pending || extracting || draft.trim().length === 0}
                aria-label="Send"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-ink text-brand-cream transition hover:bg-brand-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            {draft.trim().length > 0 && !pending && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/40">
                {draft.trim().length.toLocaleString()} characters kept in this browser — close the
                panel or go and look at another screen, and this question is still here when you
                come back. An attached file is not.
              </p>
            )}
          </div>
        </footer>
      )}
    </>
  );
}
