"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { UserCreatePanel } from "./UserCreatePanel";
import { Button, Badge } from "@/modules/analytics/presentation/ui";
import type { Company, StaffMember } from "@/modules/settings/domain/types";

interface TeamSectionProps {
  staff: StaffMember[];
  companies: Company[];
  editable: boolean;
}

const ROLE_BADGE: Record<string, "gold" | "neutral" | "info"> = {
  SUPER_ADMIN: "gold",
  SUBSIDIARY_HR_MANAGER: "info",
  RECRUITER: "info",
  HIRING_MANAGER: "neutral",
  INTERVIEWER: "neutral",
  CANDIDATE: "neutral",
};

export function TeamSection({ staff, companies, editable }: TeamSectionProps) {
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <>
      <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Team members</h2>
            <p className="mt-1 text-sm text-brand-ink/60">
              {staff.length} account{staff.length === 1 ? "" : "s"} with portal access
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-lg bg-brand-cream px-3 py-1.5 text-xs font-semibold text-brand-ink/50">
              {companies.length} companies
            </span>
            {editable && (
              <Button size="sm" onClick={() => setUserPanelOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add member
              </Button>
            )}
          </div>
        </header>

        <ul className="divide-y divide-brand-line">
          {staff.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-dark">
                {member.full_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{member.full_name}</span>
                <span className="block truncate text-xs text-brand-ink/50">{member.email}</span>
              </span>
              <span className="text-[11px] text-brand-ink/45">
                {member.tenant_id ? companyName.get(member.tenant_id) ?? "—" : "Group-wide"}
              </span>
              <Badge tone={ROLE_BADGE[member.role] ?? "neutral"}>
                {member.role.replace(/_/g, " ")}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <UserCreatePanel
        companies={companies}
        open={userPanelOpen}
        onClose={() => setUserPanelOpen(false)}
        onSuccess={() => setUserPanelOpen(false)}
      />
    </>
  );
}