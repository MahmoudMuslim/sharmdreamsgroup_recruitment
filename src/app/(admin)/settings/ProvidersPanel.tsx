import { CredentialsConsole } from "./CredentialsConsole";
import { ModelRoutingConsole } from "./ModelRoutingConsole";
import { listCredentialAudit, listCredentials } from "@/modules/settings/application/credential-actions";
import { isEncryptionConfigured } from "@/lib/crypto/secrets";

/**
 * API keys + model routing.
 *
 * Credentials are the sensitive half and are read server-side: only a masked
 * hint ever crosses to the client. Models are ordinary settings.
 *
 * Which half is open is decided by the settings dock (URL), not a tab strip in
 * here — the page already has one navigation, and this used to add a second.
 */
export async function ProvidersPanel({
  editable,
  section,
}: {
  editable: boolean;
  section: string;
}) {
  if (section === "models") return <ModelRoutingConsole editable={editable} />;

  // Read here rather than from a client effect. This used to await an
  // `getEncryptionStatus()` action — a pure env check that cost a whole round
  // trip — and only then mount the console, which fired two more actions of its
  // own. Three serialized trips put the first card on screen 13 s after the page.
  const [credentials, audit] = await Promise.all([
    listCredentials(),
    listCredentialAudit(12),
  ]);

  return (
    <CredentialsConsole
      encryptionConfigured={isEncryptionConfigured()}
      editable={editable}
      initialCredentials={credentials}
      initialAudit={audit}
    />
  );
}
