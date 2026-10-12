"use client";

import { useState, type ReactNode } from "react";
import { KeyRound, Megaphone, Network, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsArea = "platform" | "organisation" | "access" | "integrations";

const AREAS: {
  id: SettingsArea;
  label: string;
  icon: typeof SlidersHorizontal;
  blurb: string;
}[] = [
  {
    id: "platform",
    label: "Platform",
    icon: SlidersHorizontal,
    blurb: "AI behaviour, assessment rules, notifications, integrations and security.",
  },
  {
    id: "organisation",
    label: "Organisation",
    icon: Network,
    blurb: "Companies, departments, locations, role families and skills — added once, selected everywhere.",
  },
  {
    id: "access",
    label: "Access & comms",
    icon: Megaphone,
    blurb: "Who can do what, plus the messages candidates receive.",
  },
  {
    id: "integrations",
    label: "API keys",
    icon: KeyRound,
    blurb: "Credentials for the AI providers and channels this platform actually calls — encrypted at rest. Plus per-task model routing.",
  },
];

/**
 * Top-level settings navigation.
 *
 * The page used to be one long scrolling column, which made every control hard
 * to reach. This splits it into three areas with a sticky nav so the active
 * section is always one click away no matter how far down you have scrolled.
 *
 * Panels arrive as already-rendered server nodes — only the navigation is
 * client-side, so no data is fetched on the client and no session detail is
 * serialised into the client bundle beyond what the server already sent.
 */
export function SettingsShell({
  platform,
  organisation,
  access,
  integrations,
}: {
  platform: ReactNode;
  organisation: ReactNode;
  access: ReactNode;
  integrations: ReactNode;
}) {
  const [area, setArea] = useState<SettingsArea>("platform");
  const active = AREAS.find((a) => a.id === area) ?? AREAS[0];
  const Icon = active.icon;

  return (
    <div className="space-y-5">
      {/* Sticky area switcher */}
      <div className="sticky top-16 z-30 -mx-4 bg-brand-ivory/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-3 sm:shadow-soft">
        <div
          role="tablist"
          aria-label="Settings areas"
          className="flex min-w-max gap-1.5 overflow-x-auto sm:min-w-0"
        >
          {AREAS.map((item) => {
            const AreaIcon = item.icon;
            const selected = item.id === area;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setArea(item.id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
                  selected
                    ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                    : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand"
                )}
              >
                <AreaIcon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 flex items-start gap-2 px-1 text-xs leading-relaxed text-brand-ink/50">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {active.blurb}
        </p>
      </div>

      {/* Only the active area is mounted, so a long form never lingers in the DOM. */}
      <div role="tabpanel" aria-label={active.label}>
        {area === "platform" && platform}
        {area === "organisation" && organisation}
        {area === "access" && access}
        {area === "integrations" && integrations}
      </div>
    </div>
  );
}