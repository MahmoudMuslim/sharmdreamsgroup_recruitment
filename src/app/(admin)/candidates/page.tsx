import { Suspense } from "react";
import { Sparkles, Upload } from "lucide-react";
import { getCandidateList } from "./actions";
import { CandidateBrowser } from "./CandidateBrowser";
import { requireStaff } from "@/lib/auth/session";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, PageHeader } from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Candidate Database",
  description: "All applications with AI screening summaries and assessment status",
};

/** Auth-gated route: content is fully session/RLS dependent. */
export const instant = false;

async function CandidateList() {
  const candidates = await getCandidateList();
  return <CandidateBrowser candidates={candidates} />;
}

async function CandidateFeatures() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="font-display text-base font-bold">AI screening</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
          CV parsing with demographic anonymisation and match scoring runs on every application.
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <Upload className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="font-display text-base font-bold">WhatsApp alerts</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
          Candidates receive automatic status updates via WhatsApp Cloud API at each pipeline move.
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="font-display text-base font-bold">ATS sync</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
          Push candidates, scores and AI feedback to Greenhouse, Lever or Frappe HR in one click.
        </p>
      </Card>
    </div>
  );
}

export default async function CandidatesPage() {
  // Admin content is per-session; stop the static shell before any rendering.
  await connection();
  const user = await requireStaff("/candidates");

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Talent database"
        title="Candidates"
        description="Every application across the group, with bias-reduced AI screening scores and assessment status."
      />

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        }
      >
        <CandidateList />
      </Suspense>

      <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-2xl bg-white" />}>
        <CandidateFeatures />
      </Suspense>
    </AdminShell>
  );
}