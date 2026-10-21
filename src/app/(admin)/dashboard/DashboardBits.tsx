"use client";

import {
  type DashboardDrillScope
} from "./actions";

export type SortKey = "name" | "role" | "stage" | "fit" | "assessment" | "applied";

/** Which popup the recruiter opened, and what it has to read to answer it. */
export type Panel = { kind: "roles" } | { kind: "applications"; scope: DashboardDrillScope };

const STAGE_TONES: Record<string, "neutral" | "gold" | "success" | "danger" | "info"> = {
  HIRED: "success",
  REJECTED: "danger",
  OFFER: "gold",
  INTERVIEW: "gold",
};

export function stageTone(stage: string) {
  return STAGE_TONES[stage] ?? "info";
}

export function prettyStage(stage: string) {
  return stage.replace("_", " ");
}

export function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** `2026-10-15` → `Wed, Oct 15`, read as a calendar day rather than a moment. */
export function longDate(day: string) {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
