"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The floating assistant: one component owning three states.
 *
 *  1. Closed and moving  — a fixed avatar whose eyes follow the cursor.
 *  2. Closed and idle    — a context-aware offer about whatever the pointer is resting on.
 *  3. Open               — a chat drawer stacked above the same toggle.
 *
 * The eye tracking writes Framer Motion values and never touches React state, so
 * a 100 Hz `mousemove` costs zero renders. The idle offer is the only thing here
 * that can re-render, and it is guarded to fire on a *change* of message rather
 * than on every movement.
 */

/** How long a still pointer must hold before an offer is made. */
const IDLE_MS = 2_500;

/** The pupil never travels further than this from its own centre, in px. */
const MAX_LOOK = 6;
/** Cursor distance that buys one pixel of pupil travel. */
const LOOK_FALLOFF = 14;

/** Slightly underdamped: the eyes arrive with a small overshoot, like a real gaze. */
const EYE_SPRING = { stiffness: 250, damping: 25 };

/**
 * Ceiling on the text that counts as a surface.
 *
 * A page's root wrapper holds every workflow in it — a CV, an application, a
 * requirement — so a pointer that rests on its padding or background would be
 * answered with whichever copy the page happens to mention first. Anything that
 * long is not the thing being looked at, and the general offer is the honest
 * answer. The cap also bounds the work: the scan never reads a whole subtree.
 */
const MAX_SURFACE_CHARS = 220;

/* -------------------------------------------------------------------------- */
/* Idle scanner                                                                */
/* -------------------------------------------------------------------------- */

const RESUME_WORKFLOW = /\b(resume|cv|curriculum vitae)\b/;
const APPLY_WORKFLOW = /\b(apply|application|salary|expected salary)\b/;
const SPEC_WORKFLOW = /\b(require|requirements|experience|stack)\b/;
const ACTION_WORDS = /\b(apply|submit|send my application)\b/;

interface HelpSurface {
  /** The actual control under the pointer, if one is part of the pointer's chain. */
  control: Element | null;
  /** The smallest sensible block around it — the thing being looked at. */
  block: Element;
  /** Lower-cased, bounded text of the most specific of the two. */
  text: string;
}

/**
 * What the pointer is resting on.
 *
 * The text read for a match is the pointer's own element first, then the control
 * it belongs to, then the smallest block around it. The climbed block is kept for
 * the structural questions a label alone cannot answer — is this inside a form, is
 * there a file picker in this row.
 */
function surfaceUnder(point: Element): HelpSurface | null {
  if (point.closest("[data-assistant-surface]")) return null;

  const control = point.closest("button, a, input, select, textarea, label");
  const block = point.closest("form, article, section, li, tr, td, div") ?? document.body;

  return { control, block, text: surfaceText(point) || surfaceText(control) || surfaceText(block) };
}

/** Lower-cased text, but only while the node holds one surface worth of it. */
function surfaceText(node: Element | null): string {
  if (!node) return "";
  const text = (node.textContent ?? "").slice(0, MAX_SURFACE_CHARS + 1).toLowerCase();
  return text.length > MAX_SURFACE_CHARS ? "" : text;
}

/**
 * True when the pointer is on the upload affordance itself.
 *
 * A row's own group is checked rather than the climbed block, because the block
 * for every field of an apply form is that form, and a form with a CV attachment
 * would otherwise answer "how is your resume?" to someone pointing at their phone
 * number.
 */
function isUploadControl(control: Element | null): boolean {
  if (!control) return false;
  if (control instanceof HTMLInputElement && control.type === "file") return true;
  if (control instanceof HTMLLabelElement) {
    const bound = control.htmlFor ? document.getElementById(control.htmlFor) : null;
    if (bound instanceof HTMLInputElement && bound.type === "file") return true;
  }
  const group = control.closest("label") ?? control.parentElement;
  return group?.tagName !== "FORM" && !!group?.querySelector('input[type="file"]');
}

/** True when the pointer is on the control that actually sends an application. */
function isActionControl(control: Element | null): boolean {
  if (!control) return false;
  const tag = control.tagName;
  if (tag !== "BUTTON" && tag !== "A" && tag !== "INPUT") return false;
  return (
    ACTION_WORDS.test(surfaceText(control)) ||
    ACTION_WORDS.test(control.getAttribute("aria-label") ?? "")
  );
}

/**
 * The recruitment workflows, most specific first. Only the first match speaks.
 *
 * An explicit Apply button is answered before the upload rule because a job's
 * apply form holds both, and a candidate parked on the submit control is not
 * wondering about their CV.
 */
const HELP_RULES: readonly { readonly test: (surface: HelpSurface) => boolean; readonly message: string }[] = [
  {
    test: (s) => isActionControl(s.control),
    message: "Want me to draft a custom cover letter for this position? 📝",
  },
  {
    test: (s) => isUploadControl(s.control) || RESUME_WORKFLOW.test(s.text),
    message: "Need a quick AI review of your resume before uploading? 📄",
  },
  {
    test: (s) => s.block.closest("form") !== null || APPLY_WORKFLOW.test(s.text),
    message: "Want me to draft a custom cover letter for this position? 📝",
  },
  {
    test: (s) => SPEC_WORKFLOW.test(s.text),
    message: "Confused about a required skill? Let me explain it! 💡",
  },
];

const GENERAL_OFFER = "Looking for your dream job? Let me narrow it down! 🚀";

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function RecruitmentAssistant() {
  const reduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const [offer, setOffer] = useState<string | null>(null);

  /** The avatar itself, so its centre can be measured rather than assumed. */
  const anchor = useRef<HTMLDivElement>(null);
  const center = useRef({ x: 0, y: 0 });
  const idleTimer = useRef<number | null>(null);

  /**
   * Mirrors `offer` for the mousemove handler. A handler that called `setOffer`
   * unconditionally would re-render the tree on every mouse movement; this makes
   * the cost one render per appearance and one per disappearance.
   */
  const offered = useRef<string | null>(null);

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const eyeX = useSpring(rawX, EYE_SPRING);
  const eyeY = useSpring(rawY, EYE_SPRING);

  /**
   * Both eyes are driven by the same pair of springs: they are one gaze, and two
   * independent sets would let the face drift cross-eyed.
   */
  const pupils = { x: eyeX, y: eyeY };

  useEffect(() => {
    if (isOpen) return;

    const node = anchor.current;
    if (!node) return;

    const measure = () => {
      const box = node.getBoundingClientRect();
      center.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    measure();

    const settle = () => {
      rawX.set(0);
      rawY.set(0);
    };

    const onMouseMove = (event: MouseEvent) => {
      const { clientX: x, clientY: y } = event;

      if (!reduceMotion) {
        const dx = x - center.current.x;
        const dy = y - center.current.y;
        const angle = Math.atan2(dy, dx);
        // Full travel only once the cursor is far enough away to be worth a glance.
        const reach = Math.min(MAX_LOOK, Math.hypot(dx, dy) / LOOK_FALLOFF);
        rawX.set(Math.cos(angle) * reach);
        rawY.set(Math.sin(angle) * reach);
      }

      // Browsing is not the moment for a bubble: kill it and its countdown first.
      window.clearTimeout(idleTimer.current ?? undefined);
      if (offered.current !== null) {
        offered.current = null;
        setOffer(null);
      }

      idleTimer.current = window.setTimeout(() => {
        const under = document.elementFromPoint(x, y);
        const surface = under ? surfaceUnder(under) : null;
        if (!surface) return;
        const next = HELP_RULES.find((rule) => rule.test(surface))?.message ?? GENERAL_OFFER;
        if (next === offered.current) return;
        offered.current = next;
        setOffer(next);
      }, IDLE_MS);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true, capture: true });

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      window.clearTimeout(idleTimer.current ?? undefined);
      settle();
      if (offered.current !== null) {
        offered.current = null;
        setOffer(null);
      }
    };
    // `open` is the only thing that genuinely restarts this: the motion values and
    // `setOffer` keep their identity between renders.
  }, [isOpen, reduceMotion, rawX, rawY]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  return (
    <div
      data-assistant-surface
      className={cn("fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4", "print:hidden")}
    >
      {/* ----------------------------------------------------------------open-- */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.section
            role="dialog"
            aria-label="Recruitment assistant"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            style={{ originX: 1, originY: 1 }}
            className="flex h-96 w-80 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-brand-line bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-line bg-brand-cream px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Assistant
              </p>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close the assistant"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </header>

            {/* ──────────────────────────────────────────────────────────────────
                PLUG-IN 1 — the transcript.
                Replace this block with the existing message list. It needs to be
                the scroll container so the composer below stays reachable, and it
                should scroll to the bottom when a new turn arrives.

                  <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                    {messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                    {pending && <TypingIndicator />}
                  </div>

                In this repository the equivalent is already written:
                <AssistantChat variant="docked" sessionId={…} onSessionChange={…}
                onNewConversation={…} /> from src/app/(admin)/assistant/AssistantChat.tsx
                carries transcript, tool steps and composer together — drop it in
                place of PLUG-IN 1 and 2 and delete this placeholder markup.
                ────────────────────────────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-xs leading-relaxed text-brand-ink/50">
                Your conversation history renders here.
              </p>
            </div>

            {/* ──────────────────────────────────────────────────────────────────
                PLUG-IN 2 — the composer.
                  <form onSubmit={send} className="shrink-0 border-t border-brand-line p-3">
                    <textarea value={draft} onChange={…} rows={2}
                      placeholder="Ask about a role, a resume, or an application…" />
                    <button type="submit" disabled={pending || !draft.trim()}>Send</button>
                  </form>
                ────────────────────────────────────────────────────────────────── */}
            <form
              className="shrink-0 border-t border-brand-line p-3"
              onSubmit={(event) => event.preventDefault()}
            >
              <textarea
                rows={2}
                aria-label="Message the assistant"
                placeholder="Ask about a role, a resume, or an application…"
                className="w-full resize-none rounded-xl border border-brand-line bg-brand-cream/60 p-2.5 text-sm text-brand-ink outline-none placeholder:text-brand-ink/40 focus:border-brand-gold"
              />
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------------------closed-- */}
      <div className="relative flex items-center">
        {/* The bubble sits beside the button, never above it: above is where the
            drawer opens, and the two would fight for the same pixels. */}
        <AnimatePresence initial={false}>
          {offer && !isOpen && (
            <motion.p
              key={offer}
              role="status"
              initial={{ opacity: 0, x: 8, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="absolute right-full top-1/2 mr-3 w-max max-w-[15rem] -translate-y-1/2 rounded-2xl rounded-br-md border border-brand-line bg-white/90 p-3 text-xs leading-relaxed text-brand-ink/75 shadow-lift backdrop-blur-md"
            >
              {offer}
            </motion.p>
          )}
        </AnimatePresence>

        <div ref={anchor} className="relative">
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Close the assistant" : "Open the assistant"}
            className={cn(
              "relative inline-flex h-14 w-14 items-center justify-center rounded-full",
              "bg-[radial-gradient(120%_120%_at_30%_20%,#22d3ee_0%,#4f46e5_55%,#1e1b4b_100%)]",
              "ring-1 ring-white/50 shadow-lift transition hover:scale-[1.04] active:scale-95",
              isOpen && "opacity-0 pointer-events-none"
            )}
          >
            {/* The face. Each pupil is translated by the same spring pair, clamped
                to 6px, so the avatar appears to watch the cursor across the page. */}
            <span className="flex items-center gap-2" aria-hidden>
              <motion.span
                style={pupils}
                className="block h-4 w-1.5 rounded-full bg-cyan-50 shadow-[0_0_10px_rgba(186,230,253,0.95)]"
              />
              <motion.span
                style={pupils}
                className="block h-4 w-1.5 rounded-full bg-cyan-50 shadow-[0_0_10px_rgba(186,230,253,0.95)]"
              />
            </span>
            <span
              className="absolute bottom-3 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-white/90"
              aria-hidden
            />
          </button>
        </div>
      </div>
    </div>
  );
}
