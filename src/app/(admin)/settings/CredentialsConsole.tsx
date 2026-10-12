"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  deleteCredential,
  listCredentials,
  listCredentialAudit,
  saveCredential,
  verifyCredential,
  type CredentialKeyView,
  type CredentialView,
} from "@/modules/settings/application/credential-actions";
import { PROVIDER_GROUPS } from "@/modules/settings/domain/providers";
import { Button } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, TextInput } from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";

const SOURCE_BADGE: Record<CredentialView["source"], { label: string; tone: string }> = {
  stored: { label: "Stored in platform", tone: "success" },
  environment: { label: "Using env var", tone: "info" },
  unset: { label: "Not configured", tone: "neutral" },
};

function CredentialCard({
  credential,
  editable,
  onChanged,
}: {
  credential: CredentialKeyView;
  editable: boolean;
  /** Parent reloads the list so badges reflect the new state immediately. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  // Seeded from props via useState's initializer rather than an effect, so the
  // form never renders one frame with a stale config.
  const [config, setConfig] = useState<Record<string, string>>(() => credential.config);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const badge = SOURCE_BADGE[credential.source];

  async function save() {
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const result = await saveCredential({
        provider: credential.provider,
        priority: credential.priority,
        secret: secret.trim() || undefined,
        config,
        isActive: credential.isActive,
      });
      if (result.ok) {
        setSaved(true);
        setSecret("");
        // Reload so the card shows "Stored in platform" immediately rather than
        // waiting for a full page refresh.
        onChanged();
        setTimeout(() => {
          setOpen(false);
          setSaved(false);
        }, 800);
      } else {
        setError(result.error ?? "Could not save.");
      }
    } catch {
      setError("Something went wrong saving.");
    } finally {
      setPending(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await verifyCredential(credential.provider);
      setVerifyResult(result.message);
      // The last-checked timestamp and status are stored server-side.
      onChanged();
    } catch {
      setVerifyResult("Could not run the check.");
    } finally {
      setVerifying(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the stored ${credential.displayName} credential? It will fall back to ${credential.envVar}.`)) {
      return;
    }
    setPending(true);
    try {
      const result = await deleteCredential(credential.provider);
      if (!result.ok) setError(result.error ?? "Could not remove.");
      else {
        setOpen(false);
        onChanged();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-line bg-white">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold">{credential.displayName}</h3>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                badge.tone === "success" && "bg-emerald-500/12 text-emerald-700",
                badge.tone === "info" && "bg-sky-500/12 text-sky-700",
                badge.tone === "neutral" && "bg-brand-sand text-brand-ink/60"
              )}
            >
              {badge.label}
            </span>
            {!credential.isActive && (
              <span className="rounded-full bg-rose-500/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700">
                Disabled
              </span>
            )}
            {credential.priority !== 999 && (
              <span className="rounded-full bg-brand-gold/15 px-2.5 py-1 text-[11px] font-bold text-brand-gold-dark">
                Priority {credential.priority}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">{credential.description}</p>

          <p className="mt-2 font-mono text-[11px] text-brand-ink/40">
            {credential.hint || "no value set"} · <span>{credential.envVar}</span>
            {credential.priority !== 999 && <span> · Priority {credential.priority}</span>}
          </p>

          {credential.lastVerifiedAt && (
            <p
              className={cn(
                "mt-1.5 inline-flex items-center gap-1.5 text-[11px]",
                credential.lastVerifiedStatus === "working" ? "text-emerald-700" : "text-rose-700"
              )}
            >
              {credential.lastVerifiedStatus === "working" ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden />
              ) : (
                <TriangleAlert className="h-3 w-3" aria-hidden />
              )}
              {credential.lastVerifiedDetail ?? "Checked"} ·{" "}
              {new Date(credential.lastVerifiedAt).toLocaleString()}
            </p>
          )}

          {verifyResult && (
            <p className="mt-1.5 text-[11px] text-brand-ink/60" role="status">
              {verifyResult}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {open ? "Close" : credential.source === "unset" ? "Add key" : "Change"}
            </Button>
          )}
          {credential.verify && (
            <Button size="sm" variant="ghost" onClick={verify} disabled={verifying}>
              {verifying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Test
            </Button>
          )}
          {credential.docsUrl && (
            <a
              href={credential.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <Plug className="h-3.5 w-3.5" aria-hidden />
              Docs
            </a>
          )}
        </div>
      </div>

      {open && editable && (
        <div className="space-y-4 border-t border-brand-line bg-brand-cream p-5">
          <Field
            label={credential.source === "unset" ? `${credential.envVar}` : `Replace ${credential.envVar}`}
            htmlFor={`secret-${credential.provider}`}
            hint={
              credential.source === "unset"
                ? "Stored encrypted. Only the last 4 characters are ever shown again."
                : "Leave blank to keep the current value."
            }
          >
            <div className="relative">
              <TextInput
                id={`secret-${credential.provider}`}
                type={reveal ? "text" : "password"}
                value={secret}
                autoComplete="off"
                spellCheck={false}
                placeholder={credential.hint || "Paste the API key"}
                onChange={(e) => {
                  setSecret(e.target.value);
                  if (error) setError(null);
                }}
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide the value" : "Show what you typed"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-brand-ink/45 transition hover:bg-white"
              >
                {reveal ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </Field>

          {credential.fields.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {credential.fields.map((field) => {
                const isSecret = field.secret === true;
                const alreadySet = credential.secretFieldsSet.includes(field.key);

                return (
                  <Field
                    key={field.key}
                    label={field.label}
                    htmlFor={`cfg-${credential.provider}-${field.key}`}
                    required={field.required}
                    hint={
                      isSecret
                        ? alreadySet
                          ? "Already saved — leave blank to keep it."
                          : "Encrypted at rest and never shown again."
                        : field.hint
                    }
                  >
                    <TextInput
                      id={`cfg-${credential.provider}-${field.key}`}
                      type={field.kind === "url" ? "url" : isSecret ? "password" : "text"}
                      value={isSecret ? "" : (config[field.key] ?? "")}
                      placeholder={
                        isSecret ? (alreadySet ? "•••••••• saved" : "Paste the value") : field.placeholder
                      }
                      autoComplete={isSecret ? "off" : undefined}
                      spellCheck={!isSecret}
                      onChange={(e) => {
                        setConfig((c) => ({ ...c, [field.key]: e.target.value }));
                        if (error) setError(null);
                      }}
                      className={isSecret ? "font-mono" : undefined}
                    />
                  </Field>
                );
              })}
            </div>
          )}

          <FormMessage error={error} success={saved ? "Saved and encrypted." : null} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-brand-ink/45">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Encrypted with AES-256-GCM. Never sent to the browser, never logged.
            </p>
            <div className="flex gap-2">
              {credential.source === "stored" && (
                <Button size="sm" variant="outline" onClick={remove} disabled={pending}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </Button>
              )}
              <Button size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CredentialsConsole({
  encryptionConfigured,
  editable,
}: {
  encryptionConfigured: boolean;
  editable: boolean;
}) {
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [audit, setAudit] = useState<{
    id: string;
    provider: string | null;
    action: string;
    detail: string | null;
    actor: string | null;
    createdAt: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-reads the store (used by the Refresh button and after any card action).
   *
   * Deliberately does NOT flip `loading`: that renders the full-screen spinner
   * branch, unmounting every card and wiping their local state — which is what
   * used to make a card's Test result disappear the instant it arrived.
   */
  async function reload() {
    setRefreshing(true);
    try {
      const [creds, entries] = await Promise.all([listCredentials(), listCredentialAudit(12)]);
      setCredentials(creds);
      setAudit(entries);
      setError(null);
    } catch {
      setError("Could not load the credential store.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    // Runs once on mount. `loading` already starts true so the first paint is
    // the spinner rather than an empty list.
    let active = true;

    void (async () => {
      try {
        const [creds, entries] = await Promise.all([listCredentials(), listCredentialAudit(12)]);
        if (!active) return;
        setCredentials(creds);
        setAudit(entries);
        setError(null);
      } catch {
        if (active) setError("Could not load the credential store.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-brand-ink/50">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading credentials…
      </div>
    );
  }

  const configured = credentials.filter((c) => c.source !== "unset").length;

  return (
    <div className="space-y-6">
      {!encryptionConfigured && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
          <div>
            <p className="font-semibold text-amber-900">Encryption key is not configured</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              Run <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">node scripts/generate-encryption-key.mjs</code>{" "}
              and add the output as <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">SETTINGS_ENCRYPTION_KEY</code>{" "}
              to <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">.env.local</code>. Until then,
              existing environment keys still work but new ones cannot be stored.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-brand-ink/60">
          <span className="font-display text-lg font-bold text-brand-ink">{configured}</span> of{" "}
          {credentials.length} providers configured
        </p>
        <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {PROVIDER_GROUPS.map((group) => {
        const items = credentials.filter((c) => c.group === group.id);
        if (items.length === 0) return null;

        return (
          <section key={group.id}>
            <header className="mb-3">
              <h3 className="font-display text-base font-bold">{group.label}</h3>
              <p className="text-sm text-brand-ink/55">{group.blurb}</p>
            </header>
            <div className="space-y-3">
              {items.map((credential) => (
                <CredentialCard
                  key={credential.provider}
                  credential={credential}
                  editable={editable}
                  onChanged={() => void reload()}
                />
              ))}
            </div>
          </section>
        );
      })}

      {audit.length > 0 && (
        <section>
          <h3 className="mb-3 font-display text-base font-bold">Recent changes</h3>
          <ul className="divide-y divide-brand-line rounded-2xl border border-brand-line bg-white">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60">
                  {entry.action}
                </span>
                <span className="font-medium">{entry.provider ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-brand-ink/55">{entry.detail}</span>
                <span className="shrink-0 text-[11px] text-brand-ink/40">
                  {entry.actor ?? "system"} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}