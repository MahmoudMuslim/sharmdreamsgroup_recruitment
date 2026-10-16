import Link from "next/link";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { getPublicJobs } from "./actions";
import { CareersBoard } from "./CareersBoard";

export const metadata = {
  title: "Open roles",
  description:
    "Current openings across the Sharm Dreams Group — hospitality, real estate, development and corporate services.",
};

/**
 * Public job board.
 *
 * The data is public by policy (`jobs_public_read` only exposes PUBLISHED rows),
 * so this page needs no session and no `await connection()` — it is fully
 * cacheable and every visitor sees the same list. The board below narrows that
 * list in the browser, which is what keeps it that way.
 */
export default async function CareersPage() {
  const jobs = await getPublicJobs();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-4 py-1.5 text-xs font-semibold text-brand-gold-dark shadow-soft">
          <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden />
          We are hiring
        </span>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Open roles across the group
        </h1>
        <p className="mt-4 text-base leading-relaxed text-brand-ink/65">
          Sharm Dreams Group spans hospitality, real estate and development in Sharm El Sheikh,
          Hurghada and Cairo. Search the board, pick a role, apply online, and track your progress
          with the tracking code you receive.
        </p>
      </header>

      <div className="mt-12">
        <CareersBoard jobs={jobs} />
      </div>

      <aside className="mt-14 rounded-2xl border border-brand-line bg-brand-cream p-6">
        <h2 className="font-display text-base font-bold">Already applied?</h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-ink/60">
          Enter the tracking code you received when you applied to see your current stage,
          upcoming interviews and next steps.
        </p>
        <Link
          href="/portal"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
        >
          Track my application
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </aside>
    </div>
  );
}
