"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { generateOnboardingPlan } from "../onboarding-actions";
import { Button } from "@/modules/analytics/presentation/ui";

interface UnplannedHire {
  /** The application id — also the onboarding plan's parent. */
  id: string;
  full_name: string;
  job_title: string | null;
}

/**
 * "Generate plan" button for a hire without an onboarding plan.
 *
 * Previously an inert button. Now it creates a real plan: a role-aware
 * checklist, skill gaps derived from the assessment, and an initial retention
 * score — all server-side so the logic lives in one place.
 */
export function GeneratePlanButton({ hire }: { hire: UnplannedHire }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const result = await generateOnboardingPlan(hire.id, hire.job_title);
      if (!result.ok) {
        setError(result.error ?? "Could not generate a plan.");
      }
      // On success the server action revalidates the route, so the row moves
      // into the "planned" list without any client state juggling.
    } catch {
      setError("Something went wrong generating the plan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={run} disabled={pending}>
        <Sparkles className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} aria-hidden />
        {pending ? "Generating…" : "Generate plan"}
      </Button>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}