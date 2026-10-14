"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Menu,
  Settings,
  Sparkles,
  UserRoundPlus,
  UserRoundSearch,
  Users,
  X,
} from "lucide-react";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import { AssistantDock } from "@/app/(admin)/assistant/AssistantDock";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
}

const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Live hiring metrics" },
  { href: "/candidates", label: "Candidates", icon: Users, hint: "Pipeline & AI scores" },
  { href: "/sourcing", label: "Sourcing", icon: UserRoundSearch, hint: "Outbound talent pool" },
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck, hint: "Test suite builder" },
  { href: "/interviews", label: "Interviews", icon: CalendarDays, hint: "Scheduled panels" },
  { href: "/onboarding", label: "Onboarding", icon: UserRoundPlus, hint: "New-hire checklists" },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness, hint: "Open positions" },
  { href: "/apply-questions", label: "Apply Questions", icon: ListChecks, hint: "Viability gate on the form" },
  { href: "/files", label: "Files", icon: FolderOpen, hint: "Stored CVs & recordings" },
  { href: "/whatsapp", label: "Outbox", icon: MessageCircle, hint: "Candidate alerts" },
  { href: "/assistant", label: "Assistant", icon: Sparkles, hint: "Ask, change, and revisit" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Configuration & access" },
] as const;

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  SUPER_ADMIN: "Super Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  CANDIDATE: "Candidate",
};

/**
 * Which way the desktop rail is folded, remembered per browser.
 *
 * localStorage is invisible to the server, so this is modelled as an external
 * store: `useSyncExternalStore` renders the expanded rail for hydration and then
 * applies the saved preference. Reading it in a `useState` initialiser instead
 * would make the first client render disagree with the markup the server sent.
 */
const COLLAPSE_KEY = "sdg-nav-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

const collapseListeners = new Set<() => void>();

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSE_KEY, "1");
    else window.localStorage.removeItem(COLLAPSE_KEY);
  } catch {
    // Storage blocked (private mode) — the rail still folds for this page.
  }
  collapseListeners.forEach((notify) => notify());
}

function subscribeCollapsed(notify: () => void): () => void {
  collapseListeners.add(notify);
  // Folding the rail in another tab changes the same preference.
  window.addEventListener("storage", notify);
  return () => {
    collapseListeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

const expandedOnServer = () => false;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return <SdgLockup compact={compact} />;
}

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Expand navigation" : "Collapse navigation";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-ink/55 transition hover:bg-brand-sand hover:text-brand-ink"
    >
      {collapsed ? (
        <ChevronsRight className="h-4 w-4" aria-hidden />
      ) : (
        <ChevronsLeft className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function NavLinks({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, hint }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            title={collapsed ? label : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
              collapsed && "justify-center px-0",
              active
                ? "bg-gradient-to-r from-brand-ink to-brand-ink/85 text-brand-cream shadow-lift"
                : "text-brand-ink/70 hover:bg-white hover:text-brand-ink hover:shadow-soft"
            )}
          >
            {active && (
              <span
                className="absolute -left-1 inset-y-2 w-[3px] rounded-full bg-brand-gold"
                aria-hidden
              />
            )}
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition group-hover:scale-110",
                active ? "text-brand-gold-light" : "text-brand-ink/45 group-hover:text-brand-gold"
              )}
              aria-hidden
            />
            {collapsed ? null : (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold leading-tight">{label}</span>
                <span
                  className={cn(
                    "block truncate text-[11px] leading-tight",
                    active ? "text-brand-cream/55" : "text-brand-ink/40"
                  )}
                >
                  {hint}
                </span>
              </span>
            )}
            {active && !collapsed && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold-light"
                aria-hidden
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** The AI-engine note — part of the scrollable rail, not the pinned footer. */
function EngineNote({ collapsed = false }: { collapsed?: boolean }) {
  const note =
    "Screening, scoring and feedback are model-assisted. Human review is always final.";

  if (collapsed) {
    return (
      <div className="mt-4 flex justify-center" title={note}>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-gold-dark shadow-soft">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-2xl border border-brand-line bg-white p-4 shadow-soft">
      <div className="flex items-center gap-2 text-brand-gold-dark">
        <Sparkles className="h-4 w-4" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wider">AI engine</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">{note}</p>
    </div>
  );
}

/** The signed-in recruiter, pinned to the bottom of the rail. */
function UserChip({ user, collapsed = false }: { user: SessionUser; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-brand-line bg-white px-2 py-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-dark"
          title={`${user.fullName} — ${ROLE_LABEL[user.role]}`}
        >
          {user.fullName.slice(0, 1).toUpperCase()}
        </span>
        <SignOutButton compact />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-white px-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-dark">
        {user.fullName.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight">{user.fullName}</span>
        <span className="block truncate text-[11px] leading-tight text-brand-ink/50">
          {ROLE_LABEL[user.role]}
        </span>
      </span>
      <SignOutButton />
    </div>
  );
}

/**
 * Scrolls the active item back into view when the rail overflows, so a deep
 * route on a short screen never opens on a blank strip.
 */
function useActiveIntoView(ref: React.RefObject<HTMLDivElement | null>) {
  const pathname = usePathname();
  useEffect(() => {
    const box = ref.current;
    if (!box || box.scrollHeight <= box.clientHeight) return;
    box
      .querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [pathname, ref]);
}

/**
 * Recruiter portal chrome: a persistent side panel on desktop that can be folded
 * to an icon rail and collapses into an off-canvas drawer on small screens,
 * plus a compact top bar.
 */
export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, expandedOnServer);
  const pathname = usePathname();

  // Close the drawer whenever the route changes. Adjusting state during
  // render (rather than in an effect) is React's recommended pattern and
  // avoids a cascading extra render pass.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  // Prevent background scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));

  const railRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useActiveIntoView(railRef);
  useActiveIntoView(drawerRef);

  /** Writing the store is also what re-renders this rail, and any other tab's. */
  function toggleRail() {
    // Opt the chrome into its slide now, rather than always: a saved preference
    // is applied after hydration, and animating that would look unintentional.
    document.documentElement.dataset.navAnimated = "1";
    writeCollapsed(!collapsed);
  }

  return (
    <div className="min-h-screen bg-brand-ivory text-brand-ink">
      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-brand-line bg-brand-cream/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink transition hover:bg-brand-sand"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <BrandMark />
        <div className="w-10" aria-hidden />
      </header>

      {/* ---------- Desktop side panel ---------- */}
      <aside
        className={cn(
          "rail-fold fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-brand-line bg-brand-cream lg:flex",
          collapsed && "w-[76px]"
        )}
      >
        <div className={cn("shrink-0 pb-4 pt-5", collapsed ? "px-2" : "px-4")}>
          <div
            className={cn(
              "flex items-center",
              collapsed ? "flex-col gap-1.5" : "justify-between gap-2"
            )}
          >
            <BrandMark compact={collapsed} />
            <CollapseToggle collapsed={collapsed} onToggle={toggleRail} />
          </div>
          <div
            className={cn("h-px w-full rule-gold opacity-60", collapsed ? "mt-2" : "mt-4")}
            aria-hidden
          />
        </div>

        <div
          ref={railRef}
          className={cn(
            "rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4",
            collapsed ? "px-2" : "px-4"
          )}
        >
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/35">
              Workspace
            </p>
          )}
          <NavLinks collapsed={collapsed} />
          <EngineNote collapsed={collapsed} />
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-brand-line bg-brand-cream/95 py-4 backdrop-blur",
            collapsed ? "px-2" : "px-4"
          )}
        >
          <UserChip user={user} collapsed={collapsed} />
        </div>
      </aside>

      {/* ---------- Mobile drawer ---------- */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-ink/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-[300px] flex-col border-r border-brand-line bg-brand-cream shadow-2xl">
            <div className="flex shrink-0 items-center justify-between px-4 pb-4 pt-5">
              <BrandMark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-line bg-white text-brand-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="mx-4 h-px w-auto rule-gold opacity-60" aria-hidden />

            <div
              ref={drawerRef}
              className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
            >
              <NavLinks onNavigate={() => setOpen(false)} />
              <EngineNote />
            </div>

            <div className="shrink-0 border-t border-brand-line bg-brand-cream/95 px-4 py-4 backdrop-blur">
              <UserChip user={user} />
            </div>
          </div>
        </div>
      )}

      {/* ---------- Content ---------- */}
      <div className={cn("rail-shift lg:pl-[264px]", collapsed && "lg:pl-[76px]")}>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {current && (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark lg:hidden">
              {current.label}
            </p>
          )}
          {children}
        </div>
      </div>

      <AssistantDock />
    </div>
  );
}

export { BarChart3 };