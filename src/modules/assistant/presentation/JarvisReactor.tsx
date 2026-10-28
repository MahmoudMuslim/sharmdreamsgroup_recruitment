"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { JarvisPaletteValues, JarvisStateTarget } from "jarvis-ai-web-animation";

/**
 * The one thing this portal could not draw for itself: the orb.
 *
 * The standalone applet's reactor is `jarvis-ai-web-animation` — a Three.js scene
 * of particles, filaments, rings and a shader core. A hand-drawn 2D canvas standing
 * beside it is a different object wearing the same colours, and that is what the
 * first version of this file was. The orb is now the package's own component, and
 * this file is only the portal's wrapper around it.
 *
 * The import is dynamic and client-only. Three.js is bundled inside that package
 * (about 210 KB gzipped), which is a lot to pay on a page that may never open the
 * assistant — code splitting keeps it out of the route's own bundle, and a missing
 * WebGL context or `prefers-reduced-motion` lands on the package's own gradient
 * fallback rather than on an error.
 */

const LazyOrb = dynamic(
  () => import("jarvis-ai-web-animation").then((module) => ({ default: module.JarvisOrb })),
  { ssr: false, loading: () => null }
);

/**
 * What the reactor is doing, in the six words this portal knows how to paint.
 *
 * `idle` is not `ready`: a ring that spun because the assistant *could* answer would
 * be indistinguishable from one spinning because it *is*. Every state here is a fact
 * somebody observed — the recogniser running, a turn in flight, a voice playing, a
 * card waiting for a click, a queue over its threshold.
 */
export type ReactorState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "approval"
  | "alert";

/**
 * The portal's own gold family, with the applet's red kept for `alert`.
 *
 * The orb sits on every admin screen, so it wears the same cream, sand, ink and
 * gold the pages around it wear; the five other states are told apart by brightness
 * and depth rather than by five foreign hues. `alert` is the exception and keeps
 * red, because a queue above its threshold is the one thing here that is a warning.
 * Each palette carries the gradient the package paints when WebGL is unavailable,
 * so a failed canvas still shows the right mood.
 */
const PALETTE: Record<ReactorState, JarvisPaletteValues> = {
  idle: {
    core: 0xfaf9f6,
    primary: 0xb38f6f,
    secondary: 0xa87c52,
    tertiary: 0xd4b393,
    deep: 0x161616,
    fallback:
      "radial-gradient(circle at 50% 50%, #faf9f6 0%, #b38f6f 30%, #161616 75%, transparent)",
  },
  listening: {
    core: 0xfffdf9,
    primary: 0xd4b393,
    secondary: 0xb38f6f,
    tertiary: 0xf2f1ed,
    deep: 0x1c1b1a,
    fallback:
      "radial-gradient(circle at 50% 50%, #fffdf9 0%, #d4b393 30%, #1c1b1a 75%, transparent)",
  },
  thinking: {
    core: 0xfff8ee,
    primary: 0xa87c52,
    secondary: 0x8a6237,
    tertiary: 0xd4b393,
    deep: 0x241a10,
    fallback:
      "radial-gradient(circle at 50% 50%, #fff8ee 0%, #a87c52 30%, #241a10 75%, transparent)",
  },
  speaking: {
    core: 0xfffaf3,
    primary: 0xc19a76,
    secondary: 0xa87c52,
    tertiary: 0xe8d5bd,
    deep: 0x1c1b1a,
    fallback:
      "radial-gradient(circle at 50% 50%, #fffaf3 0%, #c19a76 30%, #1c1b1a 75%, transparent)",
  },
  approval: {
    core: 0xf5f4f0,
    primary: 0x8a6237,
    secondary: 0x6b4a28,
    tertiary: 0xb38f6f,
    deep: 0x161616,
    fallback:
      "radial-gradient(circle at 50% 50%, #f5f4f0 0%, #8a6237 30%, #161616 75%, transparent)",
  },
  alert: {
    core: 0xfff1f2,
    primary: 0xef4444,
    secondary: 0xdc2626,
    tertiary: 0xfca5a5,
    deep: 0x450a0a,
    fallback:
      "radial-gradient(circle at 50% 50%, #fff1f2 0%, #ef4444 30%, #450a0a 75%, transparent)",
  },
};

/**
 * Moods, as the applet wrote them — with one deliberate exception.
 *
 * `idle` and `thinking` use the package's named targets, which do not revert on
 * their own. Every other mood is a custom target: the built-in `alert` and
 * `success` names fall back to idle after about a second, and this portal keeps
 * speaking, waiting for a click or reporting a queue for as long as the fact holds.
 * The objects are module constants so their identity is stable and the orb's state
 * effect fires only when the mood actually changes.
 */
const MOOD: Record<ReactorState, JarvisStateTarget | "idle" | "thinking"> = {
  idle: "idle",
  listening: {
    energy: 1.4,
    rotationSpeed: 0.6,
    particleSpeed: 1.6,
    shellRadius: 1.08,
    ringSpread: 1.0,
    filamentOpacity: 0.7,
    coreScale: 1.1,
    bloom: 0.9,
  },
  thinking: "thinking",
  speaking: {
    energy: 1.0,
    rotationSpeed: 0.35,
    particleSpeed: 0.9,
    shellRadius: 1.02,
    ringSpread: 0.9,
    filamentOpacity: 0.6,
    coreScale: 1.0,
    bloom: 0.6,
  },
  approval: {
    energy: 1.35,
    rotationSpeed: 0.9,
    particleSpeed: 1.1,
    shellRadius: 1.1,
    ringSpread: 1.08,
    filamentOpacity: 0.6,
    coreScale: 1.1,
    bloom: 0.9,
  },
  alert: {
    energy: 1.8,
    rotationSpeed: 1.2,
    particleSpeed: 2.2,
    shellRadius: 1.15,
    ringSpread: 1.25,
    filamentOpacity: 0.85,
    coreScale: 1.15,
    bloom: 1.0,
  },
};

const BACKDROP: Record<ReactorState, string> = {
  idle: "bg-brand-gold/15",
  listening: "bg-brand-gold-light/25",
  thinking: "bg-brand-gold-dark/20",
  speaking: "bg-brand-gold-light/30",
  approval: "bg-brand-gold-dark/25",
  alert: "bg-red-500/20",
};

/**
 * The line under the reactor, in the portal's own words.
 *
 * The applet printed `MK-VII PROTOCOL · ZERO DATA EGRESS`. Neither half of that is
 * true here: this portal's browser recogniser hands the audio it captures to Google's
 * speech service, and there is no Mark VII. So the line names the one thing a person
 * glancing at a glowing orb needs — which way the microphone is pointed right now.
 */
const STATE_LINE: Record<ReactorState, string> = {
  idle: "STANDBY · CLICK TO OPEN",
  listening: "LISTENING · WAKE WORD ARMED",
  thinking: "WORKING · ONE TURN IN FLIGHT",
  speaking: "SPEAKING · SAY STOP TO INTERRUPT",
  approval: "WAITING · YOUR CLICK RELEASES IT",
  alert: "ATTENTION · A QUEUE IS ABOVE ITS THRESHOLD",
};

export interface JarvisReactorProps {
  state: ReactorState;
  /** Square size in CSS pixels; the orb's canvas follows its container. */
  size?: number;
  /**
   * Loudness from 0 to 1, pulled from a ref-based meter rather than passed as a
   * number. Absent means no capture is open, and the orb runs on its mood alone.
   */
  level?: () => number;
  /** Replaces the state line while the conversation is asking a follow-up. */
  line?: string | null;
  /** Whether the status line is drawn under the orb. */
  showStatus?: boolean;
  onClick?: () => void;
  /** Sentence for assistive technology — the portal's wording, not the HUD's. */
  ariaLabel?: string;
  /** Whether the conversation this orb opens is already open. */
  ariaExpanded?: boolean;
}

/**
 * The JARVIS reactor: the applet's own orb, wrapped in the portal's chrome.
 *
 * The loudness sample is taken on a slow clock and quantised before it is handed
 * over. Reading the meter on every animation frame would re-render this component
 * sixty times a second for a number the renderer consumes as one value; 8 Hz is
 * faster than an eye reads a breathing core, and a difference under 0.02 is not
 * visible in the bloom. A silent room sits at the low end of the range instead of
 * zero, because an orb that goes dark while its microphone is open reads as broken.
 */
export function JarvisReactor({
  state,
  size = 88,
  level,
  line,
  showStatus = false,
  onClick,
  ariaLabel,
  ariaExpanded,
}: JarvisReactorProps) {
  const metered = level !== undefined && (state === "listening" || state === "speaking");
  const [sampled, setSampled] = useState(0.55);

  useEffect(() => {
    if (!metered || !level) return;
    const timer = setInterval(() => {
      const loud = Math.max(0, Math.min(1, level()));
      const next = 0.55 + loud * 1.25;
      setSampled((previous) => (Math.abs(previous - next) < 0.02 ? previous : next));
    }, 120);
    return () => clearInterval(timer);
  }, [metered, level]);

  const label = ariaLabel ?? STATE_LINE[state];

  return (
    <div className="relative flex flex-col items-center">
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-full blur-2xl transition-colors duration-700 ${BACKDROP[state]}`}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={ariaExpanded}
        className="group relative z-10 cursor-pointer rounded-full transition-transform duration-300 hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <div style={{ width: size, height: size }}>
          <LazyOrb
            size="avatar"
            state={MOOD[state]}
            palette={PALETTE[state]}
            quality="auto"
            intensity={metered ? sampled : undefined}
            breathing
            interactive={false}
            ariaLabel={label}
          />
        </div>
        <span
          aria-hidden
          className={`absolute inset-0 m-auto h-1/2 w-1/2 rounded-full border border-brand-gold/40 ${
            state === "listening" ? "animate-ping opacity-30" : "opacity-0 group-hover:opacity-40"
          }`}
        />
      </button>
      {showStatus && (
        <p className="z-10 mt-1.5 max-w-[16rem] text-center font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-gold-dark">
          {line ?? STATE_LINE[state]}
        </p>
      )}
    </div>
  );
}
