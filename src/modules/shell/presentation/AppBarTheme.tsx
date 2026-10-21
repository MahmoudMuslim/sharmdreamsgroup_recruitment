"use client";

import {
  useEffect,
  useSyncExternalStore
} from "react";
import {
  Droplets,
  GlassWater,
  Layers,
  Moon,
  Sun
} from "lucide-react";
import {
  applyTheme,
  lightOnServer,
  readTheme,
  subscribeTheme,
  writeTheme,
  type ThemeChoice,
  type ThemeParent,
  type ThemeTone
} from "@/lib/theme";

/* -------------------------------------------------------------------------- */
/* Theme + rail, shared with the rail's own toggle                            */
/* -------------------------------------------------------------------------- */

/**
 * The icon each theme wears in the app bar.
 *
 * Both glass tones keep a water icon so the parent reads at a glance; the tone
 * is in the label the button carries.
 */
export const PALETTE_ICON: Record<ThemeChoice, typeof Sun> = {
  "base-light": Sun,
  "base-dark": Moon,
  "glass-light": GlassWater,
  "glass-dark": Droplets,
};

/** The two controls Preferences shows: a parent, then the tone inside it. */
export const PARENT_ICON: Record<ThemeParent, typeof Sun> = { base: Layers, glass: Droplets };
export const TONE_ICON: Record<ThemeTone, typeof Sun> = { light: Sun, dark: Moon };

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, lightOnServer);
  // The head script writes the attribute before this hook exists; syncing here
  // keeps it honest when the operating system flips palettes while a tab is open.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, (next) => writeTheme(next)];
}
