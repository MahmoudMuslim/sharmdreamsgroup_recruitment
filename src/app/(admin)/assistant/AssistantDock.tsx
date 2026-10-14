"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./AssistantChat";
import { AssistantCompanion } from "./AssistantCompanion";

/**
 * The admin assistant as a panel: a dock you can pull up over any screen, so a
 * question about the page in front of you does not cost you that page.
 *
 * The conversation itself — transcript, tool steps, engine picker, composer —
 * lives in `AssistantChat`, which the full Assistant page renders too. This file
 * is only the panel's chrome: where it opens, how big it is, and whether it
 * fills the window.
 *
 * Turns are stored as they are written, so closing the panel or refreshing the
 * page is not the end of a conversation: this reopens the last one, and all of
 * them are listed on the Assistant page.
 *
 * `open` is also the companion orb's switch: it trails the pointer while this is
 * closed and holds perfectly still while the panel is up.
 */

/** Dock sizing. The panel is anchored bottom-right, so a drag grows it up-left. */
const MIN_WIDTH = 26 * 16;
const MIN_HEIGHT = 22 * 16;
const DEFAULT_WIDTH = 27 * 16;
const DEFAULT_HEIGHT = 38 * 16;

const SIZE_KEY = "sdg-assistant-size";
const MODE_KEY = "sdg-assistant-mode";
/** The conversation this browser was last having. */
const SESSION_KEY = "sdg-assistant-session";

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

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
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

/** Only a uuid is accepted: a hand-edited value would ask the server for it. */
function readSession(): string | null {
  return readStored<string | null>(SESSION_KEY, null, (raw) =>
    /^[0-9a-f-]{20,}$/i.test(raw) ? raw : null
  );
}

export function AssistantDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(readSession);

  const [mode, setMode] = useState<"docked" | "full">(() =>
    readStored(MODE_KEY, "docked", (raw) => (raw === "full" ? "full" : "docked"))
  );
  const [size, setSize] = useState(() =>
    readStored(SIZE_KEY, { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }, parseSize)
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function rememberSession(next: string | null) {
    setSessionId(next);
    writeStored(SESSION_KEY, next);
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

  // On the Assistant page the panel's own subject fills the screen, and a second
  // composer beside it would only leave the recruiter guessing which one saved
  // the answer.
  if (pathname.startsWith("/assistant")) return null;

  const wide = mode === "full";

  return (
    <>
      {/* The desktop launcher trails the pointer; below `md` there is no pointer
          to trail, so the corner keeps its plain static button. */}
      <AssistantCompanion open={open} onOpen={() => setOpen(true)} />

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        className={cn(
          "fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 font-display text-sm font-bold text-brand-cream shadow-lift transition md:hidden",
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
          style={mode === "docked" ? { width: size.w, height: size.h } : undefined}
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
              <button
                type="button"
                onClick={toggleMode}
                aria-label={
                  wide ? "Restore the assistant to its docked size" : "Use the whole window"
                }
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

          <AssistantChat
            variant="docked"
            sessionId={sessionId}
            onSessionChange={rememberSession}
            onNewConversation={() => rememberSession(null)}
          />
        </section>
      )}
    </>
  );
}
