"use client";

import { useEffect, useState } from "react";
import { Cpu, KeyRound } from "lucide-react";
import { CredentialsConsole } from "./CredentialsConsole";
import { ModelRoutingConsole } from "./ModelRoutingConsole";
import { getEncryptionStatus } from "@/modules/settings/application/credential-actions";
import { cn } from "@/lib/utils";

type Tab = "credentials" | "models";

/**
 * API keys + model routing.
 *
 * Credentials are the sensitive half and are fetched over a server action that
 * only ever returns a masked hint; models are ordinary settings.
 */
export function IntegrationsPanel({ editable }: { editable: boolean }) {
  const [tab, setTab] = useState<Tab>("credentials");
  const [encryptionConfigured, setEncryptionConfigured] = useState<boolean | null>(null);

  // Read once on mount; the banner must be accurate before the user edits.
  useEffect(() => {
    let active = true;
    void getEncryptionStatus().then((status) => {
      if (active) setEncryptionConfigured(status.configured);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex min-w-max gap-1.5 overflow-x-auto">
        {(
          [
            { id: "credentials" as const, label: "API keys", icon: KeyRound },
            { id: "models" as const, label: "AI models", icon: Cpu },
          ]
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                  : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "credentials" && encryptionConfigured !== null && (
          <CredentialsConsole encryptionConfigured={encryptionConfigured} editable={editable} />
        )}
        {tab === "models" && <ModelRoutingConsole editable={editable} />}
      </div>
    </div>
  );
}