"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Languages,
  Loader2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { NAV, ROLE_LABEL } from "@/modules/analytics/presentation/nav";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import {
  getMyProfile,
  getStaffAlerts,
  searchPortal,
  type MyProfile,
  type PortalSearchResult,
  type SearchHit,
  type StaffAlert,
} from "@/modules/shell/application/shell-actions";
import {
  expandedOnServer,
  readCollapsed,
  setRailFolded,
  subscribeCollapsed,
} from "@/lib/rail";
import {
  applyTheme,
  lightOnServer,
  readTheme,
  subscribeTheme,
  writeTheme,
  type ThemeChoice,
} from "@/lib/theme";
import { cn, formatDate } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

type Panel = "search" | "guide" | "alerts" | "account" | null;

/* -------------------------------------------------------------------------- */
/* Bar pieces                                                                 */
/* -------------------------------------------------------------------------- */

function BarButton({
  label,
  active,
  onClick,
  children,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label} (${badge})` : label}
      aria-expanded={active}
      aria-haspopup="dialog"
      title={label}
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition",
        active
          ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold-dark"
          : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink"
      )}
    >
      {children}
      {badge && badge > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-brand-on-accent"
          aria-hidden
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A dropdown hanging from the bar.
 *
 * All four panels stay mounted and are hidden rather than unmounted: the search
 * box keeps its typed term and the account panel keeps the profile it already
 * read, so reopening one is instant instead of another round trip.
 */
function PanelShell({
  id,
  open,
  label,
  width = "w-[min(92vw,420px)]",
  side = "right",
  children,
}: {
  id: Exclude<Panel, null>;
  open: Panel;
  label: string;
  width?: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      id={`appbar-${id}`}
      aria-label={label}
      className={cn(
        "rail-scroll absolute top-full mt-2 max-h-[min(72vh,560px)] overflow-y-auto overscroll-contain rounded-2xl border border-brand-line bg-brand-cream p-4 shadow-lift",
        width,
        side === "right" ? "right-0" : "left-0",
        open !== id && "hidden"
      )}
    >
      {children}
    </div>
  );
}

function PanelTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/45">
        {children}
      </h2>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">{note}</p>}
    </div>
  );
}

function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p
      className={cn(
        "rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-brand-line bg-white text-brand-ink/55"
      )}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

const MIN_TERM = 2;

function pageMatches(label: string, hint: string, term: string): boolean {
  const needle = term.toLowerCase();
  return label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle);
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={hit.href}
      className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white hover:shadow-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{hit.title}</span>
        <span className="block truncate text-[11px] text-brand-ink/50">{hit.subtitle}</span>
      </span>
    </Link>
  );
}

function SearchField({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [response, setResponse] = useState<{
    for: string;
    result: PortalSearchResult;
  } | null>(null);
  // Each keystroke takes a number and only the newest response is allowed to
  // land, so a slow earlier query cannot overwrite a fast later one.
  const requestId = useRef(0);

  const query = term.trim();
  const tooShort = query.length < MIN_TERM;
  // Whether the box has an answer for the term actually on screen. Anything
  // older is ignored rather than cleared, which keeps this render pure.
  const current = !tooShort && response?.for === query ? response.result : null;
  const searching = !tooShort && current === null;
  const error = current && !current.ok ? current.error ?? "Search failed." : null;

  useEffect(() => {
    if (tooShort) return;
    const id = (requestId.current += 1);
    const timer = window.setTimeout(() => {
      void searchPortal(query).then((result) => {
        if (requestId.current === id) setResponse({ for: query, result });
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, tooShort]);

  const hits = current && current.ok ? current : null;
  const pages = tooShort
    ? []
    : NAV.filter((item) => pageMatches(item.label, item.hint, query)).slice(0, 6);
  const recordCount = hits
    ? hits.candidates.length + hits.jobs.length + hits.prospects.length
    : 0;
  const nothingFound = !tooShort && !searching && pages.length === 0 && recordCount === 0;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function firstHit(): string | null {
    return (
      pages[0]?.href ??
      hits?.candidates[0]?.href ??
      hits?.jobs[0]?.href ??
      hits?.prospects[0]?.href ??
      null
    );
  }

  return (
    <div className="relative min-w-0 max-w-xl flex-1">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const href = firstHit();
          if (href) go(href);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search candidates, jobs and prospects
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
            aria-hidden
          />
          <input
            id="global-search"
            type="search"
            autoComplete="off"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              onOpen();
            }}
            onFocus={onOpen}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              }
            }}
            placeholder="Search candidates, jobs, prospects…"
            className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-9 text-sm placeholder:text-brand-ink/40 focus:border-brand-gold focus:outline-none"
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand-gold"
              aria-hidden
            />
          )}
        </div>
      </form>

      <PanelShell
        id="search"
        open={open ? "search" : null}
        label="Portal search"
        side="left"
        width="w-[min(94vw,540px)]"
      >
        {tooShort && (
          <Note>
            Type at least {MIN_TERM} characters. Names, emails, tracking codes, job
            titles and companies are matched, and any portal page whose name fits is
            listed alongside them.
          </Note>
        )}
        {error && <Note tone="danger">{error}</Note>}
        {nothingFound && !error && <Note>Nothing you can see matches “{query}”.</Note>}

        {pages.length > 0 && (
          <div className="mb-1">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Pages
            </p>
            {pages.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white hover:shadow-soft"
              >
                <item.icon className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className="block truncate text-[11px] text-brand-ink/50">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {hits && hits.candidates.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Candidates
            </p>
            {hits.candidates.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
        {hits && hits.jobs.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Jobs
            </p>
            {hits.jobs.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
        {hits && hits.prospects.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink/40">
              Sourced prospects
            </p>
            {hits.prospects.map((hit) => (
              <HitRow key={hit.id} hit={hit} />
            ))}
          </div>
        )}
      </PanelShell>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Guide                                                                      */
/* -------------------------------------------------------------------------- */

function GuidePanel({ open }: { open: Panel }) {
  const pathname = usePathname();

  return (
    <PanelShell id="guide" open={open} label="Portal guide">
      <PanelTitle note="The same table the navigation rail renders, so this list cannot fall behind the portal.">
        Where everything is
      </PanelTitle>

      <div className="space-y-0.5">
        {NAV.map((item) => {
          const here = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white hover:shadow-soft",
                here && "bg-white shadow-soft"
              )}
            >
              <item.icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  here ? "text-brand-gold-dark" : "text-brand-ink/40"
                )}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">
                  {item.label}
                  {here && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-brand-gold-dark">
                      here now
                    </span>
                  )}
                </span>
                <span className="block text-[11px] leading-tight text-brand-ink/50">
                  {item.hint}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-4 border-t border-brand-line pt-3">
        <p className="text-[11px] leading-relaxed text-brand-ink/55">
          A candidate moves New → AI screening → Assessment → Interview → Offer →
          Hired, or out to Rejected. Screening, scoring and feedback are
          model-assisted; human review is always final.
        </p>
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Attention feed                                                             */
/* -------------------------------------------------------------------------- */

function AlertsPanel({
  open,
  alerts,
  error,
  onReload,
}: {
  open: Panel;
  alerts: StaffAlert[] | null;
  error: string | null;
  onReload: () => void;
}) {
  const waiting = alerts?.filter((alert) => alert.count > 0) ?? [];

  return (
    <PanelShell id="alerts" open={open} label="Needs attention">
      <div className="mb-2 flex items-start justify-between gap-3">
        <PanelTitle note="Live counts from the pipeline, recalculated whenever this opens.">
          Needs attention
        </PanelTitle>
        <button
          type="button"
          onClick={onReload}
          aria-label="Recount what needs attention"
          title="Recount"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/55 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {error && <Note tone="danger">{error}</Note>}

      {!alerts && !error && (
        <p className="flex items-center gap-2 py-3 text-sm text-brand-ink/55">
          <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
          Counting…
        </p>
      )}

      {alerts && waiting.length === 0 && (
        <Note>Nothing is waiting on you across the pipeline right now.</Note>
      )}

      {waiting.length > 0 && (
        <div className="space-y-1">
          {waiting.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-white hover:shadow-soft"
            >
              <span
                className={cn(
                  "mt-0.5 grid h-6 min-w-6 shrink-0 place-items-center rounded-lg px-1.5 text-[11px] font-bold",
                  alert.tone === "danger"
                    ? "bg-rose-600 text-brand-on-accent"
                    : alert.tone === "warn"
                      ? "bg-amber-500 text-brand-ink"
                      : "bg-brand-ink text-brand-cream"
                )}
              >
                {alert.count > 99 ? "99+" : alert.count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-tight">
                  {alert.label}
                </span>
                <span className="block text-[11px] leading-tight text-brand-ink/50">
                  {alert.detail}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <p className="mt-3 border-t border-brand-line pt-2 text-[11px] leading-relaxed text-brand-ink/45">
          Each row opens the page where that work is done. Nothing is stored here:
          when the queue empties, its row disappears.
        </p>
      )}
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Theme + rail, shared with the rail's own toggle                            */
/* -------------------------------------------------------------------------- */

function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, lightOnServer);
  // The head script writes the attribute before this hook exists; syncing here
  // keeps it honest when the operating system flips palettes while a tab is open.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return [theme, (next) => writeTheme(next)];
}

/* -------------------------------------------------------------------------- */
/* Install                                                                    */
/* -------------------------------------------------------------------------- */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STANDALONE_QUERY = "(display-mode: standalone)";

// Whether this window runs as an installed app is the browser's fact, not ours,
// so it is read as an external store and follows the media query when it flips.
function subscribeStandalone(onChange: () => void): () => void {
  const list = typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_QUERY) : null;
  if (!list) return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readStandalone(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function notStandaloneOnServer(): boolean {
  return false;
}

function InstallItem() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, notStandaloneOnServer);
  const [note, setNote] = useState<string | null>(null);

  // `beforeinstallprompt` only fires when a manifest is served and the browser
  // considers the page installable, so the item reports that truth rather than
  // offering a button that would do nothing.
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) {
      setNote(
        standalone
          ? "This window is already running the installed app."
          : "This browser has not offered an install prompt for this page yet. In Chrome, use the install icon in the address bar, or the browser menu → Install as app."
      );
      return;
    }
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setPromptEvent(null);
    setNote(
      outcome === "accepted"
        ? "Installing — your browser is adding the shortcut now."
        : "Install dismissed. The offer stays available until the browser withdraws it."
    );
  }

  return (
    <div className="rounded-xl border border-brand-line bg-white px-3 py-2.5">
      <button
        type="button"
        onClick={() => void install()}
        className="flex w-full items-center gap-2.5 text-sm font-semibold text-brand-ink/75 transition hover:text-brand-ink"
      >
        <Download className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
        Install App
        {installed && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
            <Check className="h-3.5 w-3.5" aria-hidden />
            installed
          </span>
        )}
      </button>
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/50">{note}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

function PreferenceChoice({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: { key: string; label: string; icon: typeof Sun; onClick: () => void }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-brand-ink/55">{label}</p>
      <div role="group" aria-label={label} className="grid grid-cols-2 gap-1.5">
        {options.map((option) => {
          const active = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              onClick={option.onClick}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                active
                  ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold-dark"
                  : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand hover:text-brand-ink"
              )}
            >
              <option.icon className="h-3.5 w-3.5" aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreferencesSection() {
  const [theme, setTheme] = useTheme();
  const folded = useSyncExternalStore(subscribeCollapsed, readCollapsed, expandedOnServer);

  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-white px-3 py-3">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Preferences
      </p>
      <PreferenceChoice
        label="Palette — kept on this browser"
        value={theme}
        options={[
          { key: "light", label: "Light", icon: Sun, onClick: () => setTheme("light") },
          { key: "dark", label: "Dark", icon: Moon, onClick: () => setTheme("dark") },
        ]}
      />
      <PreferenceChoice
        label="Navigation rail — wide screens"
        value={folded ? "folded" : "expanded"}
        options={[
          { key: "expanded", label: "Expanded", icon: PanelLeftOpen, onClick: () => setRailFolded(false) },
          { key: "folded", label: "Folded", icon: PanelLeftClose, onClick: () => setRailFolded(true) },
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] leading-tight">
      <Icon className="h-3.5 w-3.5 shrink-0 text-brand-ink/35" aria-hidden />
      <span className="shrink-0 text-brand-ink/45">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right font-semibold text-brand-ink/75">
        {value}
      </span>
    </div>
  );
}

function AccountMenu({ user, open }: { user: SessionUser; open: Panel }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (open !== "account" || requested.current) return;
    requested.current = true;
    setLoading(true);
    void getMyProfile().then((result) => {
      setLoading(false);
      if (result.ok && result.profile) {
        setProfile(result.profile);
      } else {
        setProfileError(result.error ?? "Your profile could not be read.");
        requested.current = false;
      }
    });
  }, [open]);

  return (
    <PanelShell id="account" open={open} label="Account">
      <PanelTitle>Account</PanelTitle>

      <div className="rounded-xl border border-brand-line bg-white p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-base font-bold text-brand-gold-dark">
            {user.fullName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{user.fullName}</span>
            <span className="block truncate text-[11px] text-brand-ink/55">
              {ROLE_LABEL[user.role]} · {user.email}
            </span>
          </span>
        </div>

        <div className="mt-3 space-y-1.5 border-t border-brand-line pt-3">
          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-brand-ink/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold" aria-hidden />
              Reading your profile…
            </p>
          )}
          {profileError && !loading && (
            <p className="text-[11px] leading-relaxed text-rose-700">{profileError}</p>
          )}
          {profile && (
            <>
              <ProfileRow icon={Phone} label="Phone" value={profile.phone ?? "not recorded"} />
              <ProfileRow
                icon={Building2}
                label="Company"
                value={profile.company ?? "whole group"}
              />
              <ProfileRow icon={Languages} label="Locale" value={profile.locale} />
              <ProfileRow
                icon={CalendarDays}
                label="Member since"
                value={formatDate(profile.since)}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm font-semibold text-brand-ink/75 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          <Settings2 className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
          Workspace settings
        </Link>

        <InstallItem />
        <PreferencesSection />

        <SignOutButton className="w-full justify-center border-0 bg-white px-0 py-2.5 text-sm" />
      </div>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------------- */
/* The bar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Portal-wide top bar: search, guide, attention feed, palette and account.
 *
 * One panel opens at a time, and everything that closes one — Escape, a click
 * outside the bar, a route change — closes whichever happens to be open, so two
 * dropdowns can never stack.
 */
export function AppBar({
  user,
  onOpenNavigation,
}: {
  user: SessionUser;
  onOpenNavigation: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [theme, setTheme] = useTheme();
  const [alerts, setAlerts] = useState<StaffAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  const loadAlerts = useCallback(() => {
    void getStaffAlerts().then((result) => {
      if (result.ok) {
        setAlerts(result.alerts);
        setAlertsError(null);
      } else {
        setAlerts(null);
        setAlertsError(result.error ?? "The attention feed is unavailable.");
      }
    });
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Arriving on a new page closes the bar, exactly as it closes the drawer.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (panel) setPanel(null);
  }

  const waitingTotal = alerts?.reduce((sum, alert) => sum + alert.count, 0) ?? 0;

  function toggle(next: Exclude<Panel, null>) {
    if (panel === next) {
      setPanel(null);
      return;
    }
    // Opening the feed is the moment a recruiter expects fresh numbers.
    if (next === "alerts") loadAlerts();
    setPanel(next);
  }

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    // Dismissal is a document listener rather than a full-screen overlay sheet:
    // an overlay would swallow the click meant for the navigation rail, forcing
    // a recruiter to click twice to change page.
    const onPointerDown = (event: PointerEvent) => {
      const bar = barRef.current;
      if (bar && !bar.contains(event.target as Node)) setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [panel]);

  return (
    <header
      ref={barRef}
      className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-brand-line bg-brand-cream/95 px-3 backdrop-blur-md sm:gap-3 sm:px-4"
    >
      <button
        type="button"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink transition hover:bg-brand-sand lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <span className="shrink-0 sm:hidden">
        <SdgLockup compact />
      </span>
      <span className="hidden shrink-0 sm:block">
        <SdgLockup />
      </span>

      <SearchField
        open={panel === "search"}
        onOpen={() => setPanel("search")}
        onClose={() => setPanel(null)}
      />

      <div className="relative flex shrink-0 items-center gap-1.5 sm:gap-2">
        <BarButton label="Guide" active={panel === "guide"} onClick={() => toggle("guide")}>
          <BookOpen className="h-4 w-4" aria-hidden />
        </BarButton>
        <BarButton
          label={alertsError ? "Attention feed unavailable" : "Needs attention"}
          active={panel === "alerts"}
          onClick={() => toggle("alerts")}
          badge={waitingTotal}
        >
          <Bell className="h-4 w-4" aria-hidden />
        </BarButton>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={
            theme === "dark" ? "Switch to the light palette" : "Switch to the dark palette"
          }
          title={theme === "dark" ? "Dark palette" : "Light palette"}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink/60 transition hover:bg-brand-sand hover:text-brand-ink"
        >
          {theme === "dark" ? (
            <Moon className="h-4 w-4" aria-hidden />
          ) : (
            <Sun className="h-4 w-4" aria-hidden />
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggle("account")}
            aria-expanded={panel === "account"}
            aria-controls="appbar-account"
            aria-haspopup="dialog"
            title={user.fullName}
            className={cn(
              "flex h-9 items-center gap-2 rounded-xl border px-2 transition",
              panel === "account"
                ? "border-brand-gold/60 bg-brand-gold/15"
                : "border-brand-line bg-white hover:bg-brand-sand"
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold/25 font-display text-[11px] font-bold text-brand-gold-dark">
              {user.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-[140px] truncate text-xs font-semibold sm:block">
              {user.fullName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-brand-ink/45" aria-hidden />
          </button>
          <AccountMenu user={user} open={panel} />
        </div>

        <GuidePanel open={panel} />
        <AlertsPanel
          open={panel}
          alerts={alerts}
          error={alertsError}
          onReload={loadAlerts}
        />
      </div>
    </header>
  );
}
