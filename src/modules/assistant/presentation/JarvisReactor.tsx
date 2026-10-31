"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_JARVIS_APPEARANCE,
  orbPalette,
  type JarvisAppearance,
  type ReactorState,
} from "@/modules/assistant/domain/jarvisAppearance";

const LazyOrb = dynamic(
  () => import("jarvis-ai-web-animation").then((module) => ({ default: module.JarvisOrb })),
  { ssr: false, loading: () => null }
);

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
  appearance?: JarvisAppearance;
  preview?: boolean;
  size?: number;
  level?: () => number;
  line?: string | null;
  showStatus?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  ariaExpanded?: boolean;
}

export function JarvisReactor({
  state,
  appearance = DEFAULT_JARVIS_APPEARANCE,
  preview = false,
  size = 88,
  level,
  line,
  showStatus = false,
  onClick,
  ariaLabel,
  ariaExpanded,
}: JarvisReactorProps) {
  const metered = !preview && level !== undefined && (state === "listening" || state === "speaking");
  const [sampled, setSampled] = useState(0.55);
  const visual = appearance.states[state];
  const palette = useMemo(() => orbPalette(visual.palette), [visual.palette]);

  useEffect(() => {
    if (!metered || !level) return;
    const timer = setInterval(() => {
      const loud = Math.max(0, Math.min(1, level()));
      const next = 0.55 + loud * 1.25;
      setSampled((previous) => (Math.abs(previous - next) < 0.02 ? previous : next));
    }, 120);
    return () => clearInterval(timer);
  }, [metered, level]);

  const label = preview ? `${state} appearance preview` : ariaLabel ?? STATE_LINE[state];
  // A surface with no click is a display, not a button: `aria-expanded` over a stage
  // that has no panel to expand would promise a control that is not there, and a
  // `cursor-pointer` over it promises the same thing one way sooner.
  const interactive = !preview && Boolean(onClick);
  const Surface = interactive ? "button" : "div";

  return (
    <div className="relative flex flex-col items-center">
      <span
        aria-hidden
        style={{ backgroundColor: `${visual.palette.primary}33` }}
        className="pointer-events-none absolute inset-0 rounded-full blur-2xl transition-colors duration-700 motion-reduce:transition-none"
      />
      <Surface
        type={interactive ? "button" : undefined}
        onClick={interactive ? onClick : undefined}
        aria-label={label}
        aria-expanded={interactive ? ariaExpanded : undefined}
        className={interactive ? "group relative z-10 cursor-pointer rounded-full transition-transform duration-300 hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-current motion-reduce:transition-none" : "relative z-10 rounded-full"}
      >
        <div style={{ width: size, height: size }}>
          <LazyOrb
            // Quality recreates the upstream renderer without replaying unchanged breathing props.
            key={appearance.quality}
            size="avatar"
            state={visual.motion}
            palette={palette}
            quality={appearance.quality}
            intensity={Math.min(3, visual.motion.energy * (metered ? sampled : 1))}
            breathing={appearance.breathing}
            breathingIntensity={appearance.breathingIntensity}
            interactive={false}
            ariaLabel={label}
          />
        </div>
        {!preview && <span
          aria-hidden
          style={{ borderColor: `${visual.palette.primary}66` }}
          className={`absolute inset-0 m-auto h-1/2 w-1/2 rounded-full border ${
            state === "listening" ? "animate-ping opacity-30 motion-reduce:animate-none" : "opacity-0 group-hover:opacity-40"
          }`}
        />}
      </Surface>
      {showStatus && (
        <p className="z-10 mt-1.5 max-w-[16rem] text-center font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-gold-dark">
          {preview ? label : line ?? STATE_LINE[state]}
        </p>
      )}
    </div>
  );
}
