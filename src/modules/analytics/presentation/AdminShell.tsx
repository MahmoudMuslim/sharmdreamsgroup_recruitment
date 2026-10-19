"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Sparkles, X } from "lucide-react";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import { NAV, ROLE_LABEL, navSections } from "@/modules/analytics/presentation/nav";
import { AppBar } from "@/modules/shell/presentation/AppBar";
import { NavigationPending } from "@/modules/shell/presentation/NavigationPending";
import { navForward } from "@/modules/shell/domain/navTransition";
import { LiveChrome } from "@/modules/live/presentation/Live";
import { AssistantDock } from "@/app/(admin)/assistant/AssistantDock";
import {
  expandedOnServer,
  readCollapsed,
  setRailFolded,
  subscribeCollapsed,
} from "@/lib/rail";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

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

/**
 * The "still reading" dot on a rail row.
 *
 * `useLinkStatus` only sees the pending phase of the `<Link>` it sits inside, so
 * the wait is confirmed on the door that was opened — which is the honest place
 * for it, because every admin page reads behind a live session and can genuinely
 * take a second or more. The dot is always rendered and only changes opacity, so
 * a row cannot jump when the wait begins.
 */
function PageHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("nav-pending-dot", pending && "is-pending")} />;
}

/**
 * The rail itself: the nav table cut into its four groups, one row per page.
 *
 * A row stays one line tall and only the page you are standing on unfurls its
 * description — the other fifteen hand theirs over on hover, which is what keeps
 * sixteen doors scannable instead of a wall of subtext. Folded, the group headers
 * give way to hairlines.
 */
function NavLinks({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Main" className="flex flex-col gap-3">
      {navSections().map((group, index) => {
        // The heading over the group you are in is tinted, so a folded rail of
        // icons still tells you which block of the portal you are standing in.
        const here = group.items.some((item) => on(item.href));
        return (
          <div key={group.title}>
            {!collapsed && (
              <p
                className={cn(
                  "mb-1.5 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-[0.16em]",
                  here ? "text-brand-gold-dark" : "text-brand-ink/35"
                )}
              >
                {group.title}
                <span className="h-px flex-1 bg-brand-line" aria-hidden />
              </p>
            )}
            {collapsed && index > 0 && (
              <span className="mx-2 mb-2.5 block h-px bg-brand-line" aria-hidden />
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon, hint }) => {
                const active = on(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    transitionTypes={navForward}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    title={collapsed ? label : hint}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-brand-ink text-brand-cream shadow-lift"
                        : "text-brand-ink/70 hover:bg-white hover:text-brand-ink hover:shadow-soft"
                    )}
                  >
                    {active && (
                      <span
                        className="absolute -left-1 inset-y-1.5 w-[3px] rounded-full bg-brand-gold"
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition group-hover:scale-110",
                        active
                          ? "text-brand-gold-light"
                          : "text-brand-ink/45 group-hover:text-brand-gold"
                      )}
                      aria-hidden
                    />
                    {collapsed ? null : (
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate leading-tight",
                            active ? "font-bold" : "font-semibold"
                          )}
                        >
                          {label}
                        </span>
                        {active && (
                          <span className="mt-0.5 block truncate text-[11px] leading-tight text-brand-cream/55">
                            {hint}
                          </span>
                        )}
                      </span>
                    )}
                    {!collapsed && <PageHint />}
                    {active && !collapsed && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold-light"
                        aria-hidden
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** The AI-engine note — part of the scrollable rail, not the pinned footer. */
function EngineNote({ collapsed = false }: { collapsed?: boolean }) {
  const note =
    "Screening, scoring and feedback are model-assisted, and offers and hires stay with a person. The auto-advance and auto-reject thresholds in Settings → AI & screening move or close an untouched application on their own; 0 switches each side off.";

  if (collapsed) {
    return (
      <div className="mt-3 flex justify-center" title={note}>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-line bg-white text-brand-gold-dark shadow-soft">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    );
  }

  return (
    <p className="mt-4 flex gap-2 border-l-2 border-brand-gold/50 pl-3 text-[11px] leading-snug text-brand-ink/50">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-dark" aria-hidden />
      {note}
    </p>
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
 * to an icon rail and collapses into an off-canvas drawer on small screens, plus
 * the portal-wide app bar over the content column.
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
    setRailFolded(!collapsed);
  }

  return (
    <div className="min-h-screen bg-brand-ivory text-brand-ink">
      {/* ---------- Desktop side panel ---------- */}
      <aside
        style={{ viewTransitionName: "sdg-rail" }}
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
        <AppBar user={user} onOpenNavigation={() => setOpen(true)} />
        <NavigationPending collapsed={collapsed} />
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {current && (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark lg:hidden">
              {current.label}
            </p>
          )}
          {children}
        </div>
      </div>

      <LiveChrome />
      <AssistantDock />
    </div>
  );
}
