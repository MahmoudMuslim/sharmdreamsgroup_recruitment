import { z } from "zod";
import type { JarvisPaletteValues, JarvisStateTarget } from "jarvis-ai-web-animation";

export const REACTOR_STATES = ["idle", "listening", "thinking", "speaking", "approval", "alert"] as const;
export type ReactorState = (typeof REACTOR_STATES)[number];
export const PALETTE_COLORS = ["core", "primary", "secondary", "tertiary", "deep"] as const;
export const ORB_QUALITIES = ["auto", "ultra", "high", "balanced", "performance"] as const;

export const MOTION_CONTROLS = [
  { key: "energy", label: "Energy", min: 0, max: 3 },
  { key: "rotationSpeed", label: "Rotation speed", min: 0, max: 3 },
  { key: "particleSpeed", label: "Particle speed", min: 0, max: 3 },
  { key: "shellRadius", label: "Shell radius", min: 0.6, max: 1.5 },
  { key: "ringSpread", label: "Ring spread", min: 0.4, max: 1.6 },
  { key: "filamentOpacity", label: "Filament opacity", min: 0, max: 1 },
  { key: "coreScale", label: "Core scale", min: 0.5, max: 1.5 },
  { key: "bloom", label: "Bloom", min: 0, max: 1.5 },
] as const satisfies readonly { key: keyof JarvisStateTarget; label: string; min: number; max: number }[];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The one rule the store and the editor share, so a field is never valid twice in two places. */
export const isJarvisColorHex = (value: string): boolean => HEX_COLOR.test(value);

const color = z.string().regex(HEX_COLOR);
const paletteSchema = z.strictObject({ core: color, primary: color, secondary: color, tertiary: color, deep: color });
const motionSchema = z.strictObject(Object.fromEntries(
  MOTION_CONTROLS.map(({ key, min, max }) => [key, z.number().min(min).max(max)])
) as Record<keyof JarvisStateTarget, z.ZodNumber>);
const visualSchema = z.strictObject({ palette: paletteSchema, motion: motionSchema });
const appearanceSchema = z.strictObject({
  states: z.strictObject({
    idle: visualSchema, listening: visualSchema, thinking: visualSchema,
    speaking: visualSchema, approval: visualSchema, alert: visualSchema,
  }),
  presets: z.array(z.strictObject({ name: z.string().trim().min(1).max(32), ...visualSchema.shape })).max(12)
    .refine(presets => new Set(presets.map(preset => preset.name.toLowerCase())).size === presets.length,
      "Preset names must be unique."),
  quality: z.enum(ORB_QUALITIES),
  breathing: z.boolean(),
  breathingIntensity: z.number().min(0.2).max(2.4),
});

export type JarvisAppearance = z.infer<typeof appearanceSchema>;
export type JarvisVisual = z.infer<typeof visualSchema>;
export type JarvisPalette = z.infer<typeof paletteSchema>;

export const DEFAULT_JARVIS_APPEARANCE: JarvisAppearance = {
  states: {
    idle: {
      palette: { core: "#faf9f6", primary: "#b38f6f", secondary: "#a87c52", tertiary: "#d4b393", deep: "#161616" },
      motion: { energy: 0.72, rotationSpeed: 0.48, particleSpeed: 0.55, shellRadius: 1, ringSpread: 0.88, filamentOpacity: 0.34, coreScale: 0.92, bloom: 0.55 },
    },
    listening: {
      palette: { core: "#fffdf9", primary: "#d4b393", secondary: "#b38f6f", tertiary: "#f2f1ed", deep: "#1c1b1a" },
      motion: { energy: 1.4, rotationSpeed: 0.6, particleSpeed: 1.6, shellRadius: 1.08, ringSpread: 1, filamentOpacity: 0.7, coreScale: 1.1, bloom: 0.9 },
    },
    thinking: {
      palette: { core: "#fff8ee", primary: "#a87c52", secondary: "#8a6237", tertiary: "#d4b393", deep: "#241a10" },
      motion: { energy: 1.08, rotationSpeed: 1.35, particleSpeed: 1.24, shellRadius: 1.06, ringSpread: 1.06, filamentOpacity: 0.5, coreScale: 1.05, bloom: 0.82 },
    },
    speaking: {
      palette: { core: "#fffaf3", primary: "#c19a76", secondary: "#a87c52", tertiary: "#e8d5bd", deep: "#1c1b1a" },
      motion: { energy: 1, rotationSpeed: 0.35, particleSpeed: 0.9, shellRadius: 1.02, ringSpread: 0.9, filamentOpacity: 0.6, coreScale: 1, bloom: 0.6 },
    },
    approval: {
      palette: { core: "#f5f4f0", primary: "#8a6237", secondary: "#6b4a28", tertiary: "#b38f6f", deep: "#161616" },
      motion: { energy: 1.35, rotationSpeed: 0.9, particleSpeed: 1.1, shellRadius: 1.1, ringSpread: 1.08, filamentOpacity: 0.6, coreScale: 1.1, bloom: 0.9 },
    },
    alert: {
      palette: { core: "#fff1f2", primary: "#ef4444", secondary: "#dc2626", tertiary: "#fca5a5", deep: "#450a0a" },
      motion: { energy: 1.8, rotationSpeed: 1.2, particleSpeed: 2.2, shellRadius: 1.15, ringSpread: 1.25, filamentOpacity: 0.85, coreScale: 1.15, bloom: 1 },
    },
  },
  presets: [],
  quality: "auto",
  breathing: true,
  breathingIntensity: 1,
};

export function parseJarvisAppearance(value: unknown):
  { ok: true; appearance: JarvisAppearance } | { ok: false; error: string } {
  const parsed = appearanceSchema.safeParse(value);
  return parsed.success
    ? { ok: true, appearance: parsed.data }
    : { ok: false, error: "Check the colors, motion ranges and unique preset names (up to 12, 32 characters each)." };
}

export function orbPalette(palette: JarvisPalette): JarvisPaletteValues {
  return {
    core: parseInt(palette.core.slice(1), 16),
    primary: parseInt(palette.primary.slice(1), 16),
    secondary: parseInt(palette.secondary.slice(1), 16),
    tertiary: parseInt(palette.tertiary.slice(1), 16),
    deep: parseInt(palette.deep.slice(1), 16),
    fallback: `radial-gradient(circle at 50% 50%, ${palette.core} 0%, ${palette.primary} 30%, ${palette.deep} 75%, transparent)`,
  };
}
