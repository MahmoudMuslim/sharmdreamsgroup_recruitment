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
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RichReply } from "@/modules/assistant/presentation/RichReply";
import {
  extractAssistantAttachmentText,
  getAssistantCapabilities,
  sendAssistantMessage,
  type AssistantAttachment,
  type AssistantCapability,
  type AssistantEngine,
} from "./actions";
import type { AssistantLink } from "@/modules/assistant/domain/links";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";

/**
 * The admin assistant: a chat panel docked to the shell that reads and changes
 * records across the whole portal.
 *
 * It is deliberately a dock and not a page — the point is to ask about the
 * screen you are already looking at without leaving it. Because an answer often
 * describes a record somewhere else, every step that touched one carries a link
 * that lands on it.
 *
 * The transcript lives in component state only. Nothing is stored, so a refresh
 * starts a clean conversation; the audit trail for anything the assistant
 * changed is the same one the buttons write. An attached file's extracted text
 * is kept in that state too, so "and his Python experience?" still refers to the
 * CV that was pasted one turn earlier.
 */

interface Message {
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

/** Dock sizing. The panel is anchored bottom-right, so a drag grows it up-left. */
const MIN_WIDTH = 26 * 16;
const MIN_HEIGHT = 22 * 16;
const DEFAULT_WIDTH = 27 * 16;
const DEFAULT_HEIGHT = 38 * 16;

const SIZE_KEY = "sdg-assistant-size";
const MODE_KEY = "sdg-assistant-mode";
const ENGINE_KEY = "sdg-assistant-engine";

/** Matches the server's own clip, so history never arrives carrying more. */
const MAX_ATTACHMENT_IN_HISTORY = 12_000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED_FILES = ".pdf,.doc,.docx,.txt,.md";

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Read lazily rather than in an effect: the panel only mounts after a click, so
 * these never take part in hydration, and a stored size can be applied on the
 * first render instead of flashing the default.
 */
function readStored<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode) — the panel simply starts at its defaults.
  }
}

function parseSize(raw: string): { w: number; h: number } | null {
  try {
    const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown };
    if (typeof parsed.w !== "number" || typeof parsed.h !== "number") return null;
    return { w: clamp(parsed.w, MIN_WIDTH, 1600), h: clamp(parsed.h, MIN_HEIGHT, 1400) };
  } catch {
    return null;
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

export function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowDestructive, setAllowDestructive] = useState(false);

  const [mode, setMode] = useState<"docked" | "full">(() =>
    readStored(MODE_KEY, "docked", (raw) => (raw === "full" ? "full" : "docked"))
  );
  const [size, setSize] = useState(() =>
    readStored(SIZE_KEY, { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }, parseSize)
  );
  const [engine, setEngine] = useState<AssistantEngine>(() =>
    readStored(ENGINE_KEY, "auto", (raw) =>
      raw === "qoder" || raw === "gateway" || raw === "auto" ? raw : null
    )
  );

  const [attachment, setAttachment] = useState<AssistantAttachment | null>(null);
  const [extracting, setExtracting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the newest exchange in view, including while an answer is still coming.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, pending, showCapabilities, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function chooseEngine(next: AssistantEngine) {
    setEngine(next);
    writeStored(ENGINE_KEY, next);
  }

  function toggleMode() {
    const next = mode === "full" ? "docked" : "full";
    setMode(next);
    writeStored(MODE_KEY, next);
  }

  /**
   * Drag the top-left corner. The panel is anchored to the bottom-right, so the
   * pointer moving away from that corner is what grows it.
   */
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...size };
    const limitW = window.innerWidth - 24;
    const limitH = window.innerHeight - 24;

    const onMove = (move: PointerEvent) => {
      setSize({
        w: clamp(start.w + (start.x - move.clientX), MIN_WIDTH, limitW),
        h: clamp(start.h + (start.y - move.clientY), MIN_HEIGHT, limitH),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSize((current) => {
        writeStored(SIZE_KEY, JSON.stringify(current));
        return current;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
  function contentOf(message: Message): string {
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
    setPending(true);
    setShowCapabilities(false);

    try {
      const result = await sendAssistantMessage({
        history,
        prompt,
        allowDestructive,
        engine,
        attachment: attached ?? undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "The assistant could not answer that.");
        return;
      }
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

  const wide = mode === "full";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        className={cn(
          "fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 font-display text-sm font-bold text-brand-cream shadow-lift transition",
          "bg-gradient-to-r from-brand-ink to-brand-ink/85 hover:from-brand-ink/90 hover:to-brand-ink/75",
          open && "opacity-0 pointer-events-none"
        )}
      >
        <Sparkles className="h-4 w-4 text-brand-gold-light" aria-hidden />
        <span className="hidden sm:inline">Assistant</span>
      </button>

      {open && (
        <section
          aria-label="Operations assistant"
          style={
            mode === "docked" ? { width: size.w, height: size.h } : undefined
          }
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-2xl",
            mode === "full"
              ? "inset-3"
              : "bottom-5 right-5 min-h-[22rem] min-w-[26rem] max-w-[calc(100vw-1.5rem)]"
          )}
        >
          {mode === "docked" && (
            <div
              role="separator"
              aria-label="Resize the assistant"
              onPointerDown={startResize}
              className="absolute left-0 top-0 z-10 h-6 w-6 cursor-nwse-resize touch-none"
              title="Drag to resize"
            >
              <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-tl-lg border-l-2 border-t-2 border-brand-line" />
            </div>
          )}

          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-line bg-brand-cream p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Operations assistant
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">
                Ask about anything in the portal, or tell me what to change.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div
                role="group"
                aria-label="Answering engine"
                className="flex items-center gap-0.5 rounded-lg border border-brand-line bg-white p-0.5"
              >
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
                onClick={() => setShowCapabilities((current) => !current)}
                aria-label="What can the assistant do?"
                title="What can the assistant do?"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <ListTree className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={toggleMode}
                aria-label={wide ? "Restore the assistant to its docked size" : "Use the whole window"}
                title={wide ? "Restore" : "Full window"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand"
              >
                {wide ? (
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the assistant"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </header>

          {showCapabilities ? (
            <Capabilities onClose={() => setShowCapabilities(false)} />
          ) : (
            <div
              ref={scrollRef}
              className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
            >
              <div className={cn("space-y-3", wide && "mx-auto max-w-3xl")}>
                {messages.length === 0 && !pending && (
                  <div>
                    <p className="text-xs leading-relaxed text-brand-ink/55">
                      I can read and analyse every screen here, and make the changes your role
                      allows: openings, candidates, screening, assessments, sourcing, the message
                      outbox and the AI model routing. Attach a CV or any document and I will read
                      it, and anything I change comes back with a link to the record.
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
            <footer className="shrink-0 border-t border-brand-line bg-white p-3">
              {error && <ErrorNote message={error} />}

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
                  Allow deletions — lets me delete an opening, a prospect or a queued message when
                  you name it.
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
            </footer>
          )}
        </section>
      )}
    </>
  );
}
