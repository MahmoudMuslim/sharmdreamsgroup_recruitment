"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  deleteCredential,
  listCredentials,
  listCredentialAudit,
  saveCredential,
  verifyCredential,
  type AuditEntryView,
  type CredentialKeyView,
  type CredentialTrailRead,
  type CredentialView,
} from "@/modules/settings/application/credential-actions";
import { PROVIDER_GROUPS, type ProviderGroup } from "@/modules/settings/domain/providers";
import { credentialsTab } from "@/modules/settings/domain/settingsNav";
import {
  TRAIL_LIMIT,
  trailNumber,
  trailPages,
  trailProvider,
  trailScope,
  trailScopeNote,
  trailWords,
} from "@/modules/settings/domain/credentialTrail";
import { Button } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, TextInput } from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";

const SOURCE_BADGE: Record<CredentialView["source"], { label: string; tone: string }> = {
  stored: { label: "Stored in platform", tone: "success" },
  environment: { label: "Using env var", tone: "info" },
  unset: { label: "Not configured", tone: "neutral" },
};

const GROUP_ICONS: Record<ProviderGroup, typeof Cpu> = {
  ai: Cpu,
  communication: Send,
  other: Plug,
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

/**
 * Write the provider, the page and the words into the address bar.
 *
 * `replaceState` rather than a router push: the point is that the bar matches what
 * is on screen, and a push would remount this console through the page's own read and
 * throw away the half-typed key a card is holding. Page 1 and an empty box write
 * nothing, so the bar never carries a parameter that changed nothing. The tab and
 * every other parameter on the route are left exactly as they are.
 */
function writeTrailUrl(
  pathname: string,
  nextProvider: string | null,
  nextPage: number,
  nextFind: string | null
) {
  const search = new URLSearchParams(window.location.search);
  if (nextProvider === null) search.delete("provider");
  else search.set("provider", nextProvider);
  if (nextPage <= 1) search.delete("page");
  else search.set("page", String(nextPage));
  if (nextFind === null) search.delete("find");
  else search.set("find", nextFind);
  window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
}

/**
 * The provider credential cards.
 *
 * The first paint already holds the data: the settings page reads the store and
 * the trail in its own render, so no card waits on a round trip after
 * hydration. `Refresh` re-reads through the same actions this console used to
 * fire on mount.
 *
 * The group tab is carried in `?tab=` like the other two tabbed consoles, so
 * clicking one leaves an address that names what is on screen. The trail below the
 * cards is scoped by `?provider=`, paged by `?page=` and searched by `?find=`, all
 * applied by the page to the read it already made — the console only has to re-read
 * when that address changes underneath it.
 *
 * The trail is 24 rows deep on the live portal and a page is 12, so the only honest
 * question after the first page is "what about the rest?". This answers it with a
 * pager rather than a bigger cap: the next button moves to the next 12 rows of the
 * same scope, the address bar carries the page, and the note names the page it is
 * standing on. The same `listCredentialAudit` the chat calls serves both, so a
 * screen and an answer cannot be looking at different rows.
 *
 * The search box matches the rows the section prints — the action, the provider and
 * its name, the detail text, the actor — and it is a search of the same read, not a
 * filter of what happens to be on screen, because a match is usually on a page the
 * reader has not walked to. It commits on submit rather than on every keystroke for
 * the same reason the change trail's box does: each commit is a server read over a
 * window of rows.
 *
 * A refused read arrives as `read` rather than as an empty trail, because "nobody has
 * tested a key" and "the trail could not be read" are different sentences — and only
 * one of them is a fact about the portal's history.
 */
export function CredentialsConsole({
  encryptionConfigured,
  editable,
  initialCredentials,
  trail: { read, scope: seededScope, page: seededPage, find: seededFind },
}: {
  encryptionConfigured: boolean;
  editable: boolean;
  initialCredentials: CredentialView[];
  /** The page's own trail read, with the three parameters it was asked with. */
  trail: {
    read: CredentialTrailRead;
    scope: string | null;
    page: number;
    find: string | null;
  };
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [credentials, setCredentials] = useState<CredentialView[]>(initialCredentials);
  /**
   * The provider group is read from `?tab=` and written back when a tab is
   * clicked, so a link names the group whose keys it is talking about instead of
   * whichever tab the console happens to open on. Unknown names drop the
   * parameter's effect rather than opening an empty panel — `active` below still
   * falls back to the first group that holds credentials. Nothing is typed here,
   * but the same route reached again re-renders rather than remounts, so the last
   * value taken from the address bar is tracked and applied the way the lists do.
   */
  const incomingTab = credentialsTab(params.get("tab"));
  const [tab, setTab] = useState<ProviderGroup | null>(incomingTab);
  const [lastAppliedTab, setLastAppliedTab] = useState<ProviderGroup | null>(incomingTab);
  if (incomingTab !== lastAppliedTab) {
    setLastAppliedTab(incomingTab);
    setTab(incomingTab);
  }

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * `?provider=` narrows the change trail to one provider's rows, `?page=` walks
   * that scope backwards and `?find=` searches it. All three have two writers — the
   * address bar a chat link brought, and a control in this section — so the triplet
   * last taken from the bar is tracked and applied, exactly the way the tab strip
   * holds its own value. The first paint already carries them, because the page
   * applied them to the read it made; only a *change* costs a round trip, whether it
   * arrives as a chat link or as a clicked provider name.
   */
  const incomingScope = trailScope(params.get("provider"));
  const incomingPage = trailNumber(params.get("page"));
  const incomingFind = trailWords(params.get("find"));
  const incomingTrail = `${incomingScope ?? ""}|${incomingPage}|${incomingFind ?? ""}`;
  const [appliedTrail, setAppliedTrail] = useState(incomingTrail);
  const [provider, setProvider] = useState<string | null>(seededScope);
  const [page, setPage] = useState(read.ok ? read.page : seededPage);
  const [find, setFind] = useState<string | null>(seededFind);
  const [words, setWords] = useState(seededFind ?? "");
  if (incomingTrail !== appliedTrail) {
    setAppliedTrail(incomingTrail);
    setProvider(incomingScope);
    setPage(incomingPage);
    setFind(incomingFind);
    setWords(incomingFind ?? "");
  }

  const [audit, setAudit] = useState<AuditEntryView[]>(read.ok ? read.entries : []);
  const [total, setTotal] = useState(read.ok ? read.total : 0);
  const [named, setNamed] = useState(read.ok ? read.named : 0);
  // The note has to say how far a search looked, so the listing keeps the window it
  // was searched over and the scope's own size, not just the rows that matched.
  const [scanned, setScanned] = useState(read.ok ? read.scanned : 0);
  const [scopeRows, setScopeRows] = useState(read.ok ? read.scopeRows : 0);
  const [failure, setFailure] = useState<string | null>(read.ok ? null : read.error);
  const [pending, setPending] = useState(false);
  const readTrail = useRef(`${provider}|${page}|${find ?? ""}`);

  // The bar always carries what the section is showing, including on the first
  // paint: a bookmark for a page the trail has outgrown is served as its oldest
  // page, and that is the number the bar keeps.
  useEffect(() => {
    writeTrailUrl(pathname, provider, page, find);
  }, [provider, page, find, pathname]);

  useEffect(() => {
    const key = `${provider}|${page}|${find ?? ""}`;
    if (readTrail.current === key) return;
    readTrail.current = key;
    let live = true;
    setPending(true);
    listCredentialAudit({ provider, page, find })
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setAudit(result.entries);
          setTotal(result.total);
          setNamed(result.named);
          setScanned(result.scanned);
          setScopeRows(result.scopeRows);
          setFailure(null);
          // A bookmark to a page the trail no longer holds is clamped by the read;
          // the listing follows onto the page it actually served, and the bar
          // follows the listing, so it never keeps naming rows nobody showed.
          if (result.page !== page) {
            readTrail.current = `${provider}|${result.page}|${find ?? ""}`;
            setPage(result.page);
          }
        } else {
          // A refused read has no rows, so the listing is cleared rather than left
          // showing an unscoped page under a scoped heading.
          setAudit([]);
          setTotal(0);
          setNamed(0);
          setScanned(0);
          setScopeRows(0);
          setFailure(result.error);
        }
      })
      .catch(() => {
        if (!live) return;
        setAudit([]);
        setTotal(0);
        setNamed(0);
        setScanned(0);
        setScopeRows(0);
        setFailure("The credential trail could not be read.");
      })
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
  }, [provider, page, find]);

  /**
   * Re-reads the store (used by the Refresh button and after any card action).
   *
   * Deliberately leaves the current list on screen: replacing it with a spinner
   * unmounts every card and wipes its local state — which is what used to make a
   * card's Test result disappear the instant it arrived. The trail is re-read with
   * the scope, page and words the section is standing on, so a test that just wrote
   * a row refreshes the page the reader is looking at rather than snapping back to
   * the newest one.
   */
  async function reload() {
    setRefreshing(true);
    try {
      const [creds, fresh] = await Promise.all([
        listCredentials(),
        listCredentialAudit({ provider, page, find }),
      ]);
      setCredentials(creds);
      if (fresh.ok) {
        setAudit(fresh.entries);
        setTotal(fresh.total);
        setNamed(fresh.named);
        setScanned(fresh.scanned);
        setScopeRows(fresh.scopeRows);
        setFailure(null);
        readTrail.current = `${provider}|${fresh.page}|${find ?? ""}`;
        if (fresh.page !== page) setPage(fresh.page);
      } else {
        setAudit([]);
        setTotal(0);
        setNamed(0);
        setScanned(0);
        setScopeRows(0);
        setFailure(fresh.error);
      }
      setError(null);
    } catch {
      setError("Could not load the credential store.");
    } finally {
      setRefreshing(false);
    }
  }

  const configured = credentials.filter((c) => c.source !== "unset").length;

  // A tab per provider group, but only for groups that hold credentials — an
  // empty "Other" tab would advertise an integration that does not exist.
  const groups = PROVIDER_GROUPS.map((group) => ({
    ...group,
    items: credentials.filter((c) => c.group === group.id),
  })).filter((group) => group.items.length > 0);

  const active = tab && groups.some((group) => group.id === tab) ? tab : groups[0]?.id;

  function openTab(next: ProviderGroup) {
    setTab(next);
    const search = new URLSearchParams(window.location.search);
    search.set("tab", next);
    window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
  }

  /**
   * Narrow the trail to one provider, or back to the whole history.
   *
   * A new scope is a new listing, so it starts again at its newest page rather than
   * carrying a page number that counted a different set of rows.
   */
  function openTrail(next: string | null) {
    setProvider(next);
    setPage(1);
  }

  /** A new search is a new listing, and the words narrow whatever scope is open. */
  function searchTrail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFind(trailWords(words));
    setPage(1);
  }

  function clearTrailSearch() {
    setWords("");
    setFind(null);
    setPage(1);
  }

  // A scope the address bar named keeps its heading even when no row matches it,
  // so a link to one provider's history never arrives at a page that shows
  // nothing and says nothing about why.
  const trailDefinition = trailProvider(provider);
  const pages = trailPages(total);
  const lastRow = (page - 1) * TRAIL_LIMIT + audit.length;

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

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Provider groups">
          {groups.map((group) => {
            const Icon = GROUP_ICONS[group.id];
            return (
              <button
                key={group.id}
                type="button"
                role="tab"
                id={`credentials-tab-${group.id}`}
                aria-selected={active === group.id}
                aria-controls={`credentials-panel-${group.id}`}
                onClick={() => openTab(group.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                  active === group.id
                    ? "bg-brand-ink text-brand-cream shadow-soft"
                    : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {`${group.label} (${group.items.length})`}
              </button>
            );
          })}
        </div>

        {/* Every panel stays mounted and the inactive one is hidden, because a card
            holds a half-typed secret and a Test result in local state — the same
            reason `reload` refuses to show the full-screen spinner. */}
        {groups.map((group) => (
          <div
            key={group.id}
            role="tabpanel"
            id={`credentials-panel-${group.id}`}
            aria-labelledby={`credentials-tab-${group.id}`}
            className={cn("space-y-3", active !== group.id && "hidden")}
          >
            <p className="text-sm text-brand-ink/55">{group.blurb}</p>
            {group.items.map((credential) => (
              <CredentialCard
                key={credential.provider}
                credential={credential}
                editable={editable}
                onChanged={() => void reload()}
              />
            ))}
          </div>
        ))}
      </div>

      {(provider !== null || find !== null || failure !== null || audit.length > 0) && (
        <section>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-base font-bold">
              {`${
                find
                  ? `Changes matching “${find}”`
                  : page > 1
                    ? "Change history"
                    : "Recent changes"
              }${trailDefinition ? ` — ${trailDefinition.displayName}` : ""}`}
            </h3>
            {provider !== null && (
              <button
                type="button"
                onClick={() => openTrail(null)}
                className="text-xs font-semibold text-brand-gold-dark underline underline-offset-2"
              >
                Show every provider
              </button>
            )}
            {pending && (
              <span className="text-xs text-brand-ink/40" role="status">
                Loading…
              </span>
            )}
          </div>

          <form onSubmit={searchTrail} className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-ink/35"
                aria-hidden
              />
              <input
                value={words}
                onChange={(event) => setWords(event.target.value)}
                placeholder="Search an action, a provider, what it reported, or who ran it"
                aria-label="Search the credential trail"
                className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-3 text-xs text-brand-ink/80 outline-none focus:border-brand-gold"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl border border-brand-line px-3.5 py-2 text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
            >
              Search
            </button>
            {(find !== null || words !== "") && (
              <button
                type="button"
                onClick={clearTrailSearch}
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-brand-ink/50 hover:bg-brand-sand"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </button>
            )}
          </form>

          <p className="mb-3 mt-1 text-xs leading-relaxed text-brand-ink/55">
            {failure ??
              trailScopeNote({
                providerId: provider,
                total,
                loaded: audit.length,
                named,
                page,
                search: find === null ? null : { words: find, scanned, scopeRows },
              })}
            {!failure && audit.length > 0 && (
              <span className="text-brand-ink/40"> Pick a provider in a row to read only its history.</span>
            )}
          </p>
          {audit.length > 0 && (
            <ul className="divide-y divide-brand-line rounded-2xl border border-brand-line bg-white">
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60">
                    {entry.action}
                  </span>
                  {entry.provider ? (
                    <button
                      type="button"
                      onClick={() => openTrail(entry.provider ?? null)}
                      title={trailProvider(entry.provider)?.displayName ?? entry.provider}
                      className="text-sm font-semibold text-brand-gold-dark underline underline-offset-2"
                    >
                      {entry.provider}
                    </button>
                  ) : (
                    <span className="font-medium">—</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-brand-ink/55">{entry.detail}</span>
                  <span className="shrink-0 text-[11px] text-brand-ink/40">
                    {entry.actor ?? "system"} · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!failure && pages > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {page > 1 && (
                <button
                  type="button"
                  onClick={() => setPage(page - 1)}
                  disabled={pending}
                  className="rounded-xl border border-brand-line px-3.5 py-2 font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
                >
                  {`Newer changes (page ${page - 1})`}
                </button>
              )}
              {lastRow < total && (
                <button
                  type="button"
                  onClick={() => setPage(page + 1)}
                  disabled={pending}
                  className="rounded-xl border border-brand-line px-3.5 py-2 font-semibold text-brand-ink/70 transition hover:bg-brand-sand disabled:opacity-45"
                >
                  {`Show ${Math.min(TRAIL_LIMIT, total - lastRow)} earlier changes`}
                </button>
              )}
              <span className="text-brand-ink/40">
                {`Page ${page} of ${pages}`}
                {total > TRAIL_LIMIT ? ` — ${TRAIL_LIMIT} rows a page, newest first` : ""}
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}