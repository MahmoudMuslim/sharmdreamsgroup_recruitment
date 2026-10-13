"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ListTree,
  Loader2,
  Send,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAssistantCapabilities,
  sendAssistantMessage,
  type AssistantCapability,
} from "./actions";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";

/**
 * The admin assistant: a chat panel docked to the shell that reads and changes
 * records across the whole portal.
 *
 * It is deliberately a dock and not a page — the point is to ask about the
 * screen you are already looking at without leaving it.
 *
 * The transcript lives in component state only. Nothing is stored, so a refresh
 * starts a clean conversation; the audit trail for anything the assistant
 * changed is the same one the buttons write.
 */

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: AssistantStep[];
  model?: string;
}

const STARTERS = [
  "How is the pipeline looking this fortnight?",
  "Which openings have no applicants?",
  "Screen the newest applicant on my busiest role",
  "What model is resume screening using?",
] as const;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function StepChips({ steps }: { steps: AssistantStep[] }) {
  if (steps.length === 0) return null;

  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5">
      {steps.map((step, index) => (
        <li key={`${step.tool}-${index}`}>
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
        </li>
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  async function send(promptRaw?: string) {
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt || pending) return;

    // Snapshot before appending: the question being asked is sent separately.
    const history = messages.map((message) => ({
      role: message.role,
      content: message.text,
    }));

    setMessages((current) => [...current, { id: nextId(), role: "user", text: prompt }]);
    setDraft("");
    setError(null);
    setPending(true);
    setShowCapabilities(false);

    try {
      const result = await sendAssistantMessage({ history, prompt, allowDestructive });
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
        },
      ]);
    } catch {
      setError("The assistant could not be reached. Check the AI keys in Settings and try again.");
    } finally {
      setPending(false);
    }
  }

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
          className="fixed bottom-5 right-5 z-50 flex h-[min(38rem,calc(100vh-3rem))] w-[min(27rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-2xl"
        >
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
              className="rail-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
            >
              {messages.length === 0 && !pending && (
                <div>
                  <p className="text-xs leading-relaxed text-brand-ink/55">
                    I can read and analyse every screen here, and make the changes your role allows:
                    openings, candidates, screening, assessments, sourcing, the message outbox and
                    the AI model routing.
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
                  <p
                    key={message.id}
                    className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-ink px-3 py-2 text-sm text-brand-cream"
                  >
                    {message.text}
                  </p>
                ) : (
                  <div key={message.id} className="max-w-[92%]">
                    <StepChips steps={message.steps ?? []} />
                    <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-brand-line bg-brand-cream px-3 py-2 text-sm leading-relaxed text-brand-ink">
                      {message.text}
                    </p>
                    {message.model && (
                      <p className="mt-1 pl-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
                        {message.model}
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
          )}

          {!showCapabilities && (
            <footer className="shrink-0 border-t border-brand-line bg-white p-3">
              {error && <ErrorNote message={error} />}

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
                <textarea
                  ref={inputRef}
                  rows={2}
                  value={draft}
                  disabled={pending}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask or instruct…"
                  aria-label="Message the assistant"
                  className="rail-scroll min-h-[2.75rem] flex-1 resize-none rounded-xl border border-brand-line bg-white px-3 py-2 text-sm outline-none transition placeholder:text-brand-ink/35 focus:border-brand-gold disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={pending || draft.trim().length === 0}
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
