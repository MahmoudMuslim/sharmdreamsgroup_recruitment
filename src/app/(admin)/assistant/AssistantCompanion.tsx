"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The assistant's launcher: a glass orb that trails the pointer while the
 * recruiter is working, drifts back to its corner the moment the hand stops, and
 * offers help for whatever is under the cursor if it stops for long.
 *
 * Three constraints shape it. Position is driven entirely through motion values,
 * so a mouse-move costs no render. The orb rides *beside* the pointer instead of
 * under it and is click-through while in flight, so it can never steal a click
 * from the dense tables it hovers over. And it returns to its dock on its own,
 * because an orb that permanently shadows the cursor is an orb nobody can aim at.
 */

/** The corner the launcher belongs to — `bottom-5 right-5`. */
const ANCHOR_INSET = 20;
const ORB_SIZE = 56;
/** How far from the pointer the orb rides, so it never sits on a click target. */
const POINTER_OFFSET = 42;
/** The pointer goes quiet this long, the orb sails home. */
const RETURN_MS = 500;
/** …and this long, it offers help for whatever is under the hand. */
const IDLE_MS = 2_500;

const SPRING = { damping: 35, stiffness: 140, mass: 0.8 };

/**
 * Zones are checked in order, most specific first: an input inside a `nav` is
 * still a form the recruiter is filling out.
 */
const HELP_ZONES: readonly { when: (el: Element) => boolean; offer: string }[] = [
  {
    when: (el) => Boolean(el.closest("input, textarea, select, form, label, [contenteditable]")),
    offer: "Need some help filling this out? ✍️",
  },
  {
    when: (el) => Boolean(el.closest("nav, header, a[href], [role='navigation'], [role='tablist']")),
    offer: "Looking for something specific? I can guide you! 🧭",
  },
  {
    when: (el) =>
      Boolean(el.closest("[data-pricing], .pricing, #pricing")) ||
      /\bpric(e|ing)\b|\bcost\b|\bEGP\b|\bUSD\b/i.test(textAround(el)),
    offer: "Want to see our enterprise discounts? 💰",
  },
];

const DEFAULT_OFFER = "Need any help with this section? 👋";

/** A word rarely lives on the exact node the pointer is over, so read the block. */
function textAround(el: Element): string {
  const block = el.closest("section, article, aside, li, td, th, p, h1, h2, h3, h4");
  return (block ?? el).textContent ?? "";
}

/**
 * What the orb offers for whatever sits under the pointer. Anything belonging to
 * the assistant itself is refused: the composer is a text field, and offering to
 * help fill in the question the recruiter is already typing is not help.
 */
function offerFor(target: Element | null): string | null {
  if (!target || target.closest("[data-assistant-surface]")) return null;
  return HELP_ZONES.find((zone) => zone.when(target))?.offer ?? DEFAULT_OFFER;
}

export function AssistantCompanion({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const reduceMotion = useReducedMotion();
  /** Deltas from the docked corner, so at rest the launcher is exactly at rest. */
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);
  const x = useSpring(dx, SPRING);
  const y = useSpring(dy, SPRING);

  /** Home means click-aimable and not click-through. */
  const [parked, setParked] = useState(true);
  const [offer, setOffer] = useState<string | null>(null);
  const lastPoint = useRef({ x: 0, y: 0 });
  const timers = useRef<{ home?: number; offer?: number }>({});
  /**
   * A move happens a hundred times a second; these decide whether it is worth a
   * render. Only the crossings — leaving home, arriving, a new offer — are.
   */
  const flags = useRef({ parked: true, offer: null as string | null });

  const showParked = useCallback((value: boolean) => {
    if (flags.current.parked === value) return;
    flags.current.parked = value;
    setParked(value);
  }, []);

  const showOffer = useCallback((value: string | null) => {
    if (flags.current.offer === value) return;
    flags.current.offer = value;
    setOffer(value);
  }, []);

  const clearTimers = useCallback(() => {
    window.clearTimeout(timers.current.home);
    window.clearTimeout(timers.current.offer);
    timers.current = {};
  }, []);

  // While the panel is open the orb is neither aimable nor interested in the
  // pointer, so the listeners come off entirely rather than filtering moves.
  useEffect(() => {
    if (open) return;
    // Touch has no pointer to trail, and reduced motion asks for nothing that
    // follows the hand around the screen.
    if (reduceMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    /**
     * Where the orb's top-left corner sits at rest, and the transform range that
     * keeps the whole orb on screen. Read per move rather than captured on mount:
     * a `fixed bottom-5 right-5` corner is measured against the document box, so
     * it excludes the scrollbar and it moves when the window does.
     */
    const dock = () => {
      const { clientWidth: w, clientHeight: h } = document.documentElement;
      return {
        left: w - ANCHOR_INSET - ORB_SIZE,
        top: h - ANCHOR_INSET - ORB_SIZE,
        reach: { min: ANCHOR_INSET + ORB_SIZE - w, max: ANCHOR_INSET },
        rise: { min: ANCHOR_INSET + ORB_SIZE - h, max: ANCHOR_INSET },
      };
    };

    /** A transform that keeps the whole orb on screen. */
    const fit = (value: number, limit: { min: number; max: number }) => clamp(value, limit.min, limit.max);

    const park = () => {
      dx.set(0);
      dy.set(0);
      showParked(true);
    };

    const onMove = (event: PointerEvent) => {
      lastPoint.current = { x: event.clientX, y: event.clientY };
      const home = dock();

      // The orb's centre aims at a point beside the cursor, never at the cursor.
      dx.set(fit(event.clientX + POINTER_OFFSET - home.left - ORB_SIZE / 2, home.reach));
      dy.set(fit(event.clientY + POINTER_OFFSET - home.top - ORB_SIZE / 2, home.rise));
      showOffer(null);
      showParked(false);

      window.clearTimeout(timers.current.home);
      window.clearTimeout(timers.current.offer);
      timers.current.home = window.setTimeout(park, RETURN_MS);
      timers.current.offer = window.setTimeout(() => {
        showOffer(offerFor(document.elementFromPoint(lastPoint.current.x, lastPoint.current.y)));
      }, IDLE_MS);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      clearTimers();
      dx.set(0);
      dy.set(0);
      showParked(true);
      showOffer(null);
    };
  }, [clearTimers, dx, dy, open, reduceMotion, showOffer, showParked]);

  return (
    <motion.div
      data-assistant-surface
      style={{ x, y }}
      className={cn(
        "pointer-events-none fixed bottom-5 right-5 z-40 hidden md:block transition-opacity",
        open && "opacity-0"
      )}
    >
      <AnimatePresence>
        {offer && !open && (
          <motion.p
            key={offer}
            initial={{ opacity: 0, y: 10, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.9 }}
            transition={{ type: "spring", damping: 22, stiffness: 260 }}
            className="absolute bottom-full right-0 mb-3 w-max max-w-[16rem] rounded-2xl border border-white/50 bg-white/85 px-3.5 py-2 text-xs font-semibold leading-snug text-brand-ink/80 shadow-lift backdrop-blur-md"
          >
            {offer}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.button
        layout
        type="button"
        onClick={onOpen}
        aria-label="Open the assistant"
        aria-expanded={open}
        transition={{ type: "spring", damping: 26, stiffness: 220 }}
        className={cn(
          "relative grid place-items-center rounded-full ring-1 ring-brand-on-accent/50 transition-opacity",
          "bg-[radial-gradient(120%_120%_at_30%_25%,rgba(34,211,238,0.95),rgba(56,189,248,0.6)_45%,rgba(124,58,237,0.9))]",
          "shadow-[0_10px_30px_-10px_rgba(56,189,248,0.75),inset_0_1px_0_rgba(255,255,255,0.7)]",
          parked && !open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-80"
        )}
        style={{ width: ORB_SIZE, height: ORB_SIZE }}
      >
        {/* The glass body: a highlight over a soft inner glow, eyes, and a smile. */}
        <span
          aria-hidden
          className="absolute inset-1.5 rounded-full bg-brand-on-accent/15 shadow-[inset_0_-6px_12px_-6px_rgba(255,255,255,0.6)]"
        />
        <span aria-hidden className="absolute left-3.5 top-2.5 h-2 w-3.5 rotate-[-18deg] rounded-full bg-brand-on-accent/70 blur-[1px]" />
        <span aria-hidden className="relative flex gap-1.5">
          <span className="h-3.5 w-1.5 rounded-full bg-cyan-50 shadow-[0_0_10px_rgba(186,230,253,0.95)]" />
          <span className="h-3.5 w-1.5 rounded-full bg-cyan-50 shadow-[0_0_10px_rgba(186,230,253,0.95)]" />
        </span>
        <span
          aria-hidden
          className="absolute bottom-[15px] h-[2px] w-4 rounded-full bg-brand-on-accent/90 shadow-[0_0_8px_rgba(255,255,255,0.85)]"
        />
      </motion.button>
    </motion.div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
