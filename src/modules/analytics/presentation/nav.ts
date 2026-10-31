import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  FileSpreadsheet,
  FolderOpen,
  FormInput,
  Gift,
  History,
  LayoutDashboard,
  Library,
  MessageCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRoundPlus,
  UserRoundSearch,
  Users,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import type { StaffRoute } from "@/lib/auth/staffRoutes";

export interface NavItem {
  /**
   * Typed as `StaffRoute`, not `string`: a rail link to a page the edge guard
   * does not list is a type error, so the door a recruiter can click is always
   * the door that enforces the idle sign-out and the candidate bounce.
   */
  href: StaffRoute;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
  /** The rail group this page sits in. See `navSections`. */
  section: NavSection;
}

/** The four doors of the portal, in the order the rail walks them. */
export type NavSection = "Overview" | "Hiring" | "Records" | "Portal";

/**
 * The portal's pages, in the order the rail shows them.
 *
 * The rail, the app bar's Guide panel and the search box's page shortcuts all
 * read this one table, so a page added to the portal cannot appear in one of
 * them and be missing from the others. The rail groups by `section` in this
 * order, so the table is also the arrangement — an entry that names a section
 * after a different one started is where a new page lands.
 *
 * This table, the page directories under `src/app/(admin)` and `STAFF_ROUTES`
 * have to hold the same paths, and `scripts/check-staff-routes.mjs`
 * (which `npm run build` runs as `prebuild`) is what makes that a build failure
 * instead of a comment. `npx next build` straight does not run it.
 */
export const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Live hiring metrics", section: "Overview" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, hint: "Assessment, sourcing, messaging & interview trends", section: "Overview" },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet, hint: "Row-level lists, CSV / Excel / PDF", section: "Overview" },
  { href: "/time", label: "Time Tracker", icon: Timer, hint: "Hours logged, by person and by candidate", section: "Overview" },
  { href: "/activity", label: "Activity", icon: History, hint: "Who — or what — changed what, and when", section: "Overview" },
  { href: "/candidates", label: "Candidates", icon: Users, hint: "Pipeline & AI scores", section: "Hiring" },
  { href: "/sourcing", label: "Sourcing", icon: UserRoundSearch, hint: "Outbound talent pool", section: "Hiring" },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness, hint: "Open positions", section: "Hiring" },
  { href: "/forms", label: "Application Forms", icon: FormInput, hint: "Build what an application asks", section: "Hiring" },
  { href: "/questions", label: "Question Bank", icon: Library, hint: "Form & test questions, one CRUD", section: "Hiring" },
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck, hint: "Test suite builder", section: "Hiring" },
  { href: "/interviews", label: "Interviews", icon: CalendarDays, hint: "Scheduled panels", section: "Hiring" },
  { href: "/onboarding", label: "Onboarding", icon: UserRoundPlus, hint: "New-hire checklists", section: "Hiring" },
  { href: "/referrals", label: "Referrals", icon: Gift, hint: "Employee referral book", section: "Hiring" },
  { href: "/files", label: "Files", icon: FolderOpen, hint: "Stored CVs & recordings", section: "Records" },
  { href: "/whatsapp", label: "Outbox", icon: MessageCircle, hint: "Candidate alerts", section: "Records" },
  { href: "/retention", label: "Privacy & retention", icon: ShieldCheck, hint: "Candidate requests and records past their window", section: "Records" },
  { href: "/assistant", label: "Assistant", icon: Sparkles, hint: "Ask, change, and revisit", section: "Portal" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "Configuration & access", section: "Portal" },
] as const;

/**
 * The table above, cut into rail groups, in table order.
 *
 * Derived rather than written out a second time, so a page can never be missing
 * from the rail or listed twice across two tables.
 */
export function navSections(): { title: NavSection; items: NavItem[] }[] {
  const groups: { title: NavSection; items: NavItem[] }[] = [];
  for (const item of NAV) {
    const last = groups[groups.length - 1];
    if (last && last.title === item.section) last.items.push(item);
    else groups.push({ title: item.section, items: [item] });
  }
  return groups;
}

export const ROLE_LABEL: Record<SessionUser["role"], string> = {
  SUPER_ADMIN: "Super Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  CANDIDATE: "Candidate",
};
