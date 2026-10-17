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
 *
 * `scope`, `page` and `find` are the three parameters the trail below the cards
 * answers to — the provider `?provider=` named, the page `?page=` asked for and the
 * words `?find=` searched — applied to the read rather than to the rendered rows. A
 * chat link about one provider's older rows therefore arrives holding those rows, not
 * the newest page of everyone's, and the first paint costs no round trip. The console
 * tracks the same parameters client-side for the same reason the tabs do.
 */
export async function ProvidersPanel({
  editable,
  section,
  scope,
  page,
  find,
}: {
  editable: boolean;
  section: string;
  scope: string | null;
  page: number;
  find: string | null;
}) {
  if (section === "models") return <ModelRoutingConsole editable={editable} />;

  // Read here rather than from a client effect. This used to await an
  // `getEncryptionStatus()` action — a pure env check that cost a whole round
  // trip — and only then mount the console, which fired two more actions of its
  // own. Three serialized trips put the first card on screen 13 s after the page.
  const [credentials, trail] = await Promise.all([
    listCredentials(),
    listCredentialAudit({ provider: scope, page, find }),
  ]);

  return (
    <CredentialsConsole
      encryptionConfigured={isEncryptionConfigured()}
      editable={editable}
      initialCredentials={credentials}
      trail={{ read: trail, scope, page, find }}
    />
  );
}
