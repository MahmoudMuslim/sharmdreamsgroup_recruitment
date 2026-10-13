"use client";

import { useEffect, useState } from "react";
import { CredentialsConsole } from "./CredentialsConsole";
import { ModelRoutingConsole } from "./ModelRoutingConsole";
import { getEncryptionStatus } from "@/modules/settings/application/credential-actions";

/**
 * API keys + model routing.
 *
 * Credentials are the sensitive half and are fetched over a server action that
 * only ever returns a masked hint; models are ordinary settings.
 *
 * Which half is open is decided by the settings dock (URL), not a tab strip in
 * here — the page already has one navigation, and this used to add a second.
 */
export function IntegrationsPanel({
  editable,
  section,
}: {
  editable: boolean;
  section: string;
}) {
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

  if (section === "models") return <ModelRoutingConsole editable={editable} />;

  return encryptionConfigured === null ? (
    <p className="text-sm text-brand-ink/50">Checking encryption status…</p>
  ) : (
    <CredentialsConsole encryptionConfigured={encryptionConfigured} editable={editable} />
  );
}