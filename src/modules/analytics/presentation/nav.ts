import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Settings,
  Sparkles,
  UserRoundPlus,
  UserRoundSearch,
  Users,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
}

/**
 * The portal's pages, in the order the rail shows them.
 *
 * The rail, the app bar's Guide panel and the search box's page shortcuts all
 * read this one table, so a page added to the portal cannot appear in one of
 * them and be missing from the others.
 */
export const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Live hiring metrics" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, hint: "Assessment, sourcing & panel reports" },
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

export const ROLE_LABEL: Record<SessionUser["role"], string> = {
  SUPER_ADMIN: "Super Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  CANDIDATE: "Candidate",
};
