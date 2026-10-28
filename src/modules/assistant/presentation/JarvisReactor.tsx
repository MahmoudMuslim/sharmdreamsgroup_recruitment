"use client";

import { useEffect, useRef } from "react";

/**
 * What the reactor is doing, in the six words the canvas knows how to paint.
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

interface Palette {
  /** The `rgba(` prefix each stroke is completed with, exactly as the applet does it. */
  glow: string;
  core: string;
  /** Multiplier on all three rotation speeds, and the tell for a state worth painting at full rate. */
  speed: number;
}

const PALETTE: Record<ReactorState, Palette> = {
  idle: { glow: "rgba(0, 240, 255, ", core: "#00f0ff", speed: 1 },
  listening: { glow: "rgba(56, 189, 248, ", core: "#38bdf8", speed: 1.6 },
  thinking: { glow: "rgba(251, 191, 36, ", core: "#fbbf24", speed: 2.8 },
  speaking: { glow: "rgba(16, 185, 129, ", core: "#10b981", speed: 1.4 },
  // A click is owed, not a failure: violet is the one colour these admin pages do not
  // already spend on an error, so a waiting card cannot be read as a broken portal.
  approval: { glow: "rgba(139, 92, 246, ", core: "#8b5cf6", speed: 2.2 },
  alert: { glow: "rgba(239, 68, 68, ", core: "#ef4444", speed: 2.2 },
};

const BACKDROP: Record<ReactorState, string> = {
  idle: "bg-cyan-500/15",
  listening: "bg-sky-500/20",
  thinking: "bg-amber-500/20",
  speaking: "bg-emerald-500/20",
  approval: "bg-violet-500/20",
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
  /** Square canvas size in CSS pixels; the applet's proportions hold at any size. */
  size?: number;
  /**
   * Loudness from 0 to 1, pulled from a ref-based meter rather than passed as a
   * number: a prop would re-render this component sixty times a second, and the only
   * reader of the value is the paint loop.
   */
  level?: () => number;
  /** Replaces the state line while the conversation is asking a follow-up. */
  line?: string | null;
  /** Whether the status line is drawn under the canvas. */
  showStatus?: boolean;
  onClick?: () => void;
  /** Sentence for assistive technology — the portal's wording, not the HUD's. */
  ariaLabel?: string;
}

/**
 * The JARVIS reactor, ported from the standalone applet's `ArcReactor.tsx`.
 *
 * Four layers, each turning on its own: a perimeter of tick marks, a ring of eight arc
 * segments with a node dot on each, an inner ring with four cardinal brackets, and a
 * radial-gradient core that breathes. A spoken turn pushes the core outward and grows
 * the twelve wave bursts around it, which is what makes the thing read as alive rather
 * than as a spinner.
 *
 * Three changes from the original, all deliberate:
 *
 * - The colors, speeds and geometry are the applet's, but `approval` and `alert` split
 *   its single `alert`, because this portal has two genuinely different reasons to
 *   interrupt a person.
 * - The paint loop reads its inputs from refs and is set up once. The applet lists its
 *   live `audioLevel` in the effect's dependencies, so every new loudness value tore
 *   down and rebuilt the loop — the reason its orb stuttered.
 * - `prefers-reduced-motion` gets one frame, repainted when the state moves, and a
 *   hidden tab stops painting altogether.
 */
export function JarvisReactor({
  state,
  size = 88,
  level,
  line,
  showStatus = false,
  onClick,
  ariaLabel,
}: JarvisReactorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const given = useRef({ state, level });
  const paintRef = useRef<(() => void) | null>(null);

  // Written after commit, never during render: the loop reads it a frame later, which
  // is exactly when the newest state is the one worth painting.
  useEffect(() => {
    given.current = { state, level };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;

    let angle1 = 0;
    let angle2 = 0;
    let angle3 = 0;
    let pulse = 0;
    let frame: number | null = null;
    let tick = 0;

    const render = () => {
      const { state: current, level: meter } = given.current;
      const palette = PALETTE[current];
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(centerX, centerY) - 16 * ratio;

      ctx.clearRect(0, 0, width, height);

      pulse += 0.04;
      const loud = meter ? meter() : 0;
      const dynamicAudio = loud * 24;
      const breathing = Math.sin(pulse) * 4 + dynamicAudio;

      // 1. Outer orbit ring with tick marks.
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle1);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = palette.glow + "0.18)";
      ctx.lineWidth = 1.5 * ratio;
      ctx.stroke();
      for (let i = 0; i < 36; i += 1) {
        const rad = (i * 2 * Math.PI) / 36;
        const tickLength = (i % 3 === 0 ? 9 : 4) * ratio;
        ctx.beginPath();
        ctx.moveTo(Math.cos(rad) * (radius - tickLength), Math.sin(rad) * (radius - tickLength));
        ctx.lineTo(Math.cos(rad) * radius, Math.sin(rad) * radius);
        ctx.strokeStyle = i % 3 === 0 ? palette.glow + "0.6)" : palette.glow + "0.25)";
        ctx.lineWidth = (i % 3 === 0 ? 2 : 1) * ratio;
        ctx.stroke();
      }
      ctx.restore();

      // 2. Middle arc segments, turning against the orbit.
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-angle2);
      const midRadius = radius * 0.72;
      for (let i = 0; i < 8; i += 1) {
        const startRad = (i * 2 * Math.PI) / 8;
        const arcSize = (Math.PI * 2) / 8 - 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, midRadius, startRad, startRad + arcSize);
        ctx.strokeStyle = palette.glow + "0.45)";
        ctx.lineWidth = 4 * ratio;
        ctx.stroke();
        const dotRad = startRad + arcSize / 2;
        ctx.beginPath();
        ctx.arc(
          Math.cos(dotRad) * (midRadius - 8 * ratio),
          Math.sin(dotRad) * (midRadius - 8 * ratio),
          2.5 * ratio,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = palette.core;
        ctx.fill();
      }
      ctx.restore();

      // 3. Inner ring with four cardinal brackets.
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle3);
      const innerRadius = radius * 0.48;
      ctx.beginPath();
      ctx.arc(0, 0, innerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = palette.glow + "0.3)";
      ctx.lineWidth = 2 * ratio;
      ctx.stroke();
      for (let i = 0; i < 4; i += 1) {
        const bRad = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(0, 0, innerRadius + 6 * ratio, bRad - 0.15, bRad + 0.15);
        ctx.strokeStyle = palette.glow + "0.8)";
        ctx.lineWidth = 3 * ratio;
        ctx.stroke();
      }
      ctx.restore();

      // 4. The core, and the twelve wave bursts a voice pushes out of it.
      ctx.save();
      ctx.translate(centerX, centerY);
      const coreRadius = Math.max(12 * ratio, radius * 0.26 + breathing * ratio);
      const grad = ctx.createRadialGradient(0, 0, 2 * ratio, 0, 0, coreRadius * 1.6);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.35, palette.core);
      grad.addColorStop(0.7, palette.glow + "0.4)");
      grad.addColorStop(1, palette.glow + "0)");
      ctx.beginPath();
      ctx.arc(0, 0, coreRadius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, coreRadius * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = palette.core;
      ctx.shadowColor = palette.core;
      ctx.shadowBlur = (20 + dynamicAudio * 2) * ratio;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, coreRadius * 0.45, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * ratio;
      ctx.shadowBlur = 10 * ratio;
      ctx.stroke();

      if (current === "listening" || current === "speaking") {
        for (let i = 0; i < 12; i += 1) {
          const wAngle = (i * 2 * Math.PI) / 12;
          const len = (6 + (Math.sin(pulse * 3 + i) + 1) * (dynamicAudio + 6)) * ratio;
          ctx.beginPath();
          ctx.moveTo(Math.cos(wAngle) * coreRadius * 0.9, Math.sin(wAngle) * coreRadius * 0.9);
          ctx.lineTo(
            Math.cos(wAngle) * (coreRadius * 0.9 + len),
            Math.sin(wAngle) * (coreRadius * 0.9 + len)
          );
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * ratio;
          ctx.stroke();
        }
      }
      ctx.restore();

      angle1 += 0.005 * palette.speed;
      angle2 += 0.008 * palette.speed;
      angle3 += 0.012 * palette.speed;
    };

    paintRef.current = render;
    render();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Nothing spins; the state change above is what repaints it.
      return () => {
        paintRef.current = null;
      };
    }

    const loop = () => {
      tick += 1;
      const busy = PALETTE[given.current.state].speed > 1;
      // Half rate in standby. The spin carries information while the assistant is
      // working, listening or speaking; on every other screen it is a background
      // process costing the browser a frame per sixteenth of a second.
      if ((busy || tick % 2 === 0) && document.visibilityState !== "hidden") render();
      frame = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      paintRef.current = null;
    };
  }, [size]);

  // Under reduced motion this is the only thing that repaints, so it runs for every
  // state. While animating it hands the loop one extra frame, which it would have
  // painted a few milliseconds later anyway.
  useEffect(() => {
    paintRef.current?.();
  }, [state]);

  return (
    <div className="relative flex flex-col items-center">
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-full blur-2xl transition-colors duration-700 ${BACKDROP[state]}`}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? STATE_LINE[state]}
        className="group relative z-10 cursor-pointer rounded-full transition-transform duration-300 hover:scale-[1.04]"
      >
        <canvas ref={canvasRef} style={{ width: size, height: size }} className="block" />
        <span
          aria-hidden
          className={`absolute inset-0 m-auto h-1/2 w-1/2 rounded-full border border-cyan-400/30 ${
            state === "listening" ? "animate-ping opacity-30" : "opacity-0 group-hover:opacity-40"
          }`}
        />
      </button>
      {showStatus && (
        <p className="z-10 mt-1.5 max-w-[16rem] text-center font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-600">
          {line ?? STATE_LINE[state]}
        </p>
      )}
    </div>
  );
}
