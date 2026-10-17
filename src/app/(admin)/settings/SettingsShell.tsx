import Link from "next/link";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Cpu,
  History,
  GraduationCap,
  KeyRound,
  MapPin,
  Network,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Users,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTINGS_NAV,
  areaById,
  sectionFor,
  settingsHref,
  type SettingsAreaId,
} from "@/modules/settings/domain/settingsNav";

const ICONS: Record<string, LucideIcon> = {
  building: Building2,
  sparkles: Sparkles,
  clipboard: ClipboardCheck,
  bell: Bell,
  shield: Shield,
  sliders: SlidersHorizontal,
  network: Network,
  pin: MapPin,
  briefcase: BriefcaseBusiness,
  cap: GraduationCap,
  coins: CircleDollarSign,
  users: Users,
  key: KeyRound,
  cpu: Cpu,
  history: History,
};

function IconFor({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}

/** `sections` counts are keyed `${area}:${section}`. */
export interface SettingsNavCounts {
  areas?: Partial<Record<SettingsAreaId, number>>;
  sections?: Record<string, number>;
}

function CountPill({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
        muted ? "bg-brand-cream text-brand-ink/45" : "bg-black/5 text-brand-ink/55"
      )}
    >
      {value}
    </span>
  );
}

/**
 * Settings navigation: a vertical dock on the left with the four areas and,
 * expanded under the active one, its sections.
 *
 * It used to be a horizontal strip of four buttons sitting above a second
 * horizontal strip of six tabs inside the panel — two navs competing for the
 * same job, and the second one scrolled off-screen on mobile. One dock, one
 * level of expansion, and the panel below it is just content.
 *
 * Rendered on the server: navigation is plain links, so no client bundle is
 * spent on state the URL already carries.
 */
export function SettingsShell({
  area,
  section,
  counts,
  children,
}: {
  area: string;
  section: string;
  counts?: SettingsNavCounts;
  children: React.ReactNode;
}) {
  const activeArea = areaById(area);
  const activeSection = sectionFor(activeArea, section);

  return (
    <div className="lg:grid lg:grid-cols-[252px_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* ---------------- Desktop dock ---------------- */}
      <aside className="rail-scroll sticky top-[73px] hidden max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain pr-1 lg:block">
        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-ink/40">
          Settings areas
        </p>

        <nav aria-label="Settings" className="space-y-1">
          {SETTINGS_NAV.map((item) => {
            const selected = item.id === activeArea.id;
            const areaCount = counts?.areas?.[item.id];
            return (
              <div key={item.id}>
                <Link
                  href={settingsHref(item.id, selected ? activeSection.id : item.sections[0].id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition",
                    selected
                      ? "border-brand-gold/50 bg-brand-gold/12 font-bold text-brand-gold-dark shadow-soft"
                      : "border-transparent text-brand-ink/70 hover:border-brand-line hover:bg-white hover:text-brand-ink"
                  )}
                >
                  <IconFor
                    name={item.icon}
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      selected ? "text-brand-gold-dark" : "text-brand-ink/40 group-hover:text-brand-gold"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {areaCount !== undefined && (
                    <CountPill value={areaCount} muted={!selected} />
                  )}
                </Link>

                {/* Expanded sections of the active area */}
                {selected && (
                  <ul className="mt-1 ml-[19px] space-y-0.5 border-l border-brand-line pl-4">
                    {item.sections.map((s) => {
                      const on = s.id === activeSection.id;
                      const count = counts?.sections?.[`${item.id}:${s.id}`];
                      return (
                        <li key={s.id}>
                          <Link
                            href={settingsHref(item.id, s.id)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition",
                              on
                                ? "bg-white font-bold text-brand-ink shadow-soft"
                                : "text-brand-ink/55 hover:bg-white/70 hover:text-brand-ink"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                on ? "bg-brand-gold" : "bg-brand-line"
                              )}
                              aria-hidden
                            />
                            <span className="min-w-0 truncate">{s.label}</span>
                            {count !== undefined && <CountPill value={count} />}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="mt-5 rounded-2xl border border-brand-line bg-white p-4 shadow-soft">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            Saved per section
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">
            Changes apply to the section you are looking at. Unsaved edits stay
            until you save or reload.
          </p>
        </div>
      </aside>

      {/* ---------------- Mobile navigation ---------------- */}
      <div className="mb-5 space-y-2.5 lg:hidden">
        <div
          role="tablist"
          aria-label="Settings areas"
          className="flex min-w-max gap-1.5 overflow-x-auto pb-1"
        >
          {SETTINGS_NAV.map((item) => {
            const selected = item.id === activeArea.id;
            return (
              <Link
                key={item.id}
                href={settingsHref(item.id, selected ? activeSection.id : item.sections[0].id)}
                role="tab"
                aria-selected={selected}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition",
                  selected
                    ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                    : "border-brand-line bg-white text-brand-ink/60"
                )}
              >
                <IconFor name={item.icon} className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex min-w-max gap-1.5 overflow-x-auto pb-1"
        >
          {activeArea.sections.map((s) => {
            const selected = s.id === activeSection.id;
            return (
              <Link
                key={s.id}
                href={settingsHref(activeArea.id, s.id)}
                role="tab"
                aria-selected={selected}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                  selected
                    ? "border-brand-ink bg-brand-ink text-brand-cream"
                    : "border-brand-line bg-white text-brand-ink/60"
                )}
              >
                {s.label}
                {counts?.sections?.[`${activeArea.id}:${s.id}`] !== undefined && (
                  <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-bold">
                    {counts.sections[`${activeArea.id}:${s.id}`]}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ---------------- Panel ---------------- */}
      <div className="min-w-0">
        <div className="mb-4 lg:hidden">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold-dark">
            {activeArea.label}
          </p>
        </div>
        <header className="mb-5 hidden lg:block">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-sand text-brand-gold-dark">
              <IconFor name={activeSection.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-extrabold tracking-tight">
                {activeSection.label}
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-brand-ink/55">
                {activeSection.hint}
              </p>
            </div>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
