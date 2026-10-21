"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Wrench,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAssistantCapabilities,
  type AssistantCapability
} from "./actions";
import { FailureNote } from "./AssistantSteps";

export function Capabilities({ onClose }: { onClose: () => void }) {
  const [tools, setTools] = useState<AssistantCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getAssistantCapabilities();
        if (!active) return;
        setTools(result);
      } catch {
        if (active) setError("The capability list could not be loaded.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">What I can do</h3>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            Every entry runs the same server action as the button on its screen, so your role
            permissions apply unchanged. Reads answer straight away; anything that changes a record
            is held here as a card and runs only if you approve it.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {error && <FailureNote message={error} />}

      {!error && tools === null && (
        <p className="mt-4 flex items-center gap-2 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      )}

      {tools && (
        <ul className="mt-4 space-y-2">
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="rounded-xl border border-brand-line bg-white p-3 shadow-soft"
            >
              <p className="flex items-center gap-1.5 font-display text-xs font-bold">
                <Wrench className="h-3 w-3 text-brand-gold-dark" aria-hidden />
                {tool.label}
                {tool.needsApproval && (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      tool.destructive ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {tool.destructive
                      ? "needs “Allow deletions”, then your approval"
                      : "waits for your approval"}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/60">
                {tool.description}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
