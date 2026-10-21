"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  Check,
  Download,
  Languages,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Settings2,
  SlidersHorizontal,
  Sun
} from "lucide-react";
import { ROLE_LABEL } from "@/modules/analytics/presentation/nav";
import { navForward } from "@/modules/shell/domain/navTransition";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import {
  getMyProfile,
  type MyProfile
} from "@/modules/shell/application/shell-actions";
import {
  expandedOnServer,
  readCollapsed,
  setRailFolded,
  subscribeCollapsed
} from "@/lib/rail";
import {
  choiceOf,
  parentOf,
  PARENTS,
  toneOf,
  TONES
} from "@/lib/theme";
import { cn, formatDate } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { type Panel, PanelShell, PanelTitle } from "./AppBarPrimitives";
import { PARENT_ICON, TONE_ICON, useTheme } from "./AppBarTheme";

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
  // The pair is stored as one value, so each control rewrites only its own half
  // and picking glass keeps the tone you were already reading in.
  const parent = parentOf(theme);
  const tone = toneOf(theme);

  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-white px-3 py-3">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Preferences
      </p>
      <PreferenceChoice
        label="Theme — each one comes in light and dark"
        value={parent}
        options={PARENTS.map((option) => ({
          key: option.key,
          label: option.label,
          icon: PARENT_ICON[option.key],
          onClick: () => setTheme(choiceOf(option.key, tone)),
        }))}
      />
      <PreferenceChoice
        label="Tone"
        value={tone}
        options={TONES.map((option) => ({
          key: option.key,
          label: option.label,
          icon: TONE_ICON[option.key],
          onClick: () => setTheme(choiceOf(parent, option.key)),
        }))}
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

export function AccountMenu({ user, open }: { user: SessionUser; open: Panel }) {
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
          transitionTypes={navForward}
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
