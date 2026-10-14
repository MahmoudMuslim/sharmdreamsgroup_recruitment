"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  ListTree,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RichReply } from "@/modules/assistant/presentation/RichReply";
import type { AssistantLink } from "@/modules/assistant/domain/links";
import type { AssistantEngine } from "@/modules/assistant/domain/engine";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";
import {
  extractAssistantAttachmentText,
  getAssistantCapabilities,
  openAssistantSession,
  sendAssistantMessage,
  type AssistantAttachment,
  type AssistantCapability,
} from "./actions";

/**
 * The assistant's conversation: transcript, tool-step chips, composer, engine
 * picker and capability list.
 *
 * Both doors into the assistant render this — the panel docked to every admin
 * screen, and the full Assistant page with its history rail. The chat itself is
 * the same in each, so an answer cannot read differently depending on where it
 * was asked.
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
  { id: "auto", label: "Auto", hint: "Qoder when it is configured, the model gateway otherwise." },
  { id: "qoder", label: "Qoder", hint: "Always the Qoder agent. Fails if no token is stored." },
  {
    id: "gateway",
    label: "Gateway",
    hint: "Always the routed model in Settings → AI models, through the gateway.",
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

/**
 * A failure the operator can act on.
 *
 * The gateway reports every provider hop it tried, which is the right thing for
 * diagnosing an outage and far too much to read in a chat bubble — so the first
 * hop is the summary and the rest sits behind a disclosure.
 */
function ErrorNote({ message }: { message: string }) {
  const summary = message.split(" | ")[0];
  const short = summary.length <= 180 ? summary : `${summary.slice(0, 180)}…`;

  if (message === short) {
    return (
      <p role="alert" className="mb-2 text-xs font-semibold leading-relaxed text-rose-700">
        {message}
      </p>
    );
  }

  return (
    <details role="alert" className="mb-2 text-xs font-semibold text-rose-700">
      <summary className="cursor-pointer leading-relaxed">{short}</summary>
      <pre className="rail-scroll mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-2 text-[11px] font-medium leading-relaxed">
        {message}
      </pre>
    </details>
  );
}

function StepChip({ step }: { step: AssistantStep }) {
  const router = useRouter();
  const link: AssistantLink | null = step.link ?? null;

  return (
    <li className="flex items-center gap-1">
      <span
        title={step.detail}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          step.ok
            ? "border-brand-line bg-white text-brand-ink/60"
            : "border-rose-200 bg-rose-50 text-rose-700"
        )}
      >
        {step.ok ? (
          <Check className="h-3 w-3" aria-hidden />
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
            permissions apply unchanged.
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

      {error && (
        <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
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
                {tool.destructive && (
                  <span className="ml-auto rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                    needs “Allow deletions”
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
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  // The stored preference is applied in the restore effect below: reading it here
  // would make the first client render disagree with the server's, because the
  // server has no localStorage to read.
  const [engine, setEngine] = useState<AssistantEngine>("auto");
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

    try {
      const result = await sendAssistantMessage({
        history,
        prompt,
        allowDestructive,
        engine,
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

  const wide = variant === "page";

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

        <button
          type="button"
          onClick={() => setShowCapabilities((current) => !current)}
          aria-label="What can the assistant do?"
          title="What can the assistant do?"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {showCapabilities ? (
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
                  I can read and analyse every screen here, and make the changes your role allows:
                  openings, candidates, screening, assessments, sourcing, the message outbox and the
                  AI model routing. Attach a CV or any document and I will read it, and anything I
                  change comes back with a link to the record.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-ink/45">
                  <Sparkles className="mr-1 inline h-3 w-3 text-brand-gold" aria-hidden />
                  Every conversation you start here is saved — pick it up from the Assistant page,
                  or close this panel and carry on where you left off.
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

            {messages.map((message) =>
              message.role === "user" ? (
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
                </div>
              ) : (
                <div key={message.id} className="max-w-[92%]">
                  <StepChips steps={message.steps ?? []} />
                  <div className="rounded-2xl rounded-bl-sm border border-brand-line bg-brand-cream px-3 py-2.5 text-sm leading-relaxed text-brand-ink">
                    <RichReply text={message.text} />
                  </div>
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
              )
            )}

            {pending && (
              <p className="flex items-center gap-2 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Working…
              </p>
            )}
          </div>
        </div>
      )}

      {!showCapabilities && (
        <footer className={cn("shrink-0 border-t border-brand-line bg-white", variant === "page" ? "px-6 py-4" : "p-3")}>
          <div className={cn(wide && "mx-auto max-w-3xl")}>
            {error && <ErrorNote message={error} />}

            {saveError && (
              <p className="mb-2 text-[11px] font-semibold leading-relaxed text-amber-700">
                This answer is not saved to your history: {saveError}
              </p>
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

            <label className="mb-2 flex items-start gap-2 text-[11px] leading-snug text-brand-ink/55">
              <input
                type="checkbox"
                checked={allowDestructive}
                onChange={(event) => setAllowDestructive(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-gold-dark"
              />
              <span>
                Allow deletions — lets me delete an opening, a prospect or a queued message when you
                name it. It is never remembered between conversations.
              </span>
            </label>

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
          </div>
        </footer>
      )}
    </>
  );
}
