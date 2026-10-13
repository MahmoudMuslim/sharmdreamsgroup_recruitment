"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  MessageCircle,
  Menu,
  Settings,
  Sparkles,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { SignOutButton } from "@/modules/analytics/presentation/SignOutButton";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
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
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck, hint: "Test suite builder" },
  { href: "/interviews", label: "Interviews", icon: CalendarDays, hint: "Scheduled panels" },
  { href: "/onboarding", label: "Onboarding", icon: UserRoundPlus, hint: "New-hire checklists" },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness, hint: "Open positions" },
  { href: "/whatsapp", label: "Outbox", icon: MessageCircle, hint: "Candidate alerts" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Configuration & access" },
] as const;

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  SUPER_ADMIN: "Super Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  CANDIDATE: "Candidate",
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return <SdgLockup compact={compact} />;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
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
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
              active
                ? "bg-brand-ink text-brand-cream shadow-soft"
                : "text-brand-ink/70 hover:bg-brand-sand hover:text-brand-ink"
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition",
                active ? "text-brand-gold-light" : "text-brand-ink/45 group-hover:text-brand-gold"
              )}
              aria-hidden
            />
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
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Recruiter portal chrome: a persistent side panel on desktop that collapses
 * into an off-canvas drawer on small screens, plus a compact top bar.
 */
export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-brand-line bg-brand-cream px-4 py-5 lg:flex">
        <div className="px-1">
          <BrandMark />
        </div>

        <div className="my-5 h-px w-full rule-gold opacity-60" aria-hidden />

        <NavLinks />

        <div className="mt-auto space-y-4 pt-6">
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-soft">
            <div className="flex items-center gap-2 text-brand-gold-dark">
              <Sparkles className="h-4 w-4" aria-hidden />
              <span className="text-[11px] font-bold uppercase tracking-wider">AI engine</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">
              Screening, scoring and feedback are model-assisted. Human review is always final.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-white px-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-dark">
              {user.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">
                {user.fullName}
              </span>
              <span className="block truncate text-[11px] leading-tight text-brand-ink/50">
                {ROLE_LABEL[user.role]}
              </span>
            </span>
            <SignOutButton />
          </div>
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
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-[300px] flex-col border-r border-brand-line bg-brand-cream px-4 py-5 shadow-2xl">
            <div className="flex items-center justify-between">
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

            <div className="my-5 h-px w-full rule-gold opacity-60" aria-hidden />

            <NavLinks onNavigate={() => setOpen(false)} />

            <div className="mt-auto rounded-2xl border border-brand-line bg-white p-3">
              <p className="truncate text-sm font-semibold">{user.fullName}</p>
              <p className="truncate text-[11px] text-brand-ink/50">{ROLE_LABEL[user.role]}</p>
              <div className="mt-3">
                <SignOutButton />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Content ---------- */}
      <div className="lg:pl-[264px]">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {current && (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark lg:hidden">
              {current.label}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export { BarChart3 };