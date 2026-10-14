/**
 * Which engine the recruiter wants for a turn.
 *
 * `auto` prefers Qoder and falls back to the gateway, which is the normal case.
 * The other two are for when one engine is being compared against the other, or
 * when the fallback itself is what is being diagnosed — a forced engine reports
 * its own failure instead of silently answering from the other one.
 */
export type AssistantEngine = "auto" | "qoder" | "gateway";

export const ASSISTANT_ENGINES: readonly AssistantEngine[] = ["auto", "qoder", "gateway"] as const;

export function isAssistantEngine(value: unknown): value is AssistantEngine {
  return typeof value === "string" && (ASSISTANT_ENGINES as readonly string[]).includes(value);
}
