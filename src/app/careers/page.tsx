import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { getPublicCompanies, getPublicJobs } from "./actions";
import { CareersBoard } from "./CareersBoard";
import { CareersChat } from "./CareersChat";
import { starterKeys } from "@/modules/careers/chatbot/role-card";
import { enumKeyFor, sectorLabel } from "@/modules/careers/job-board";
import { PublicText } from "@/modules/shell/presentation/PublicChrome";
import {
  companiesWithoutOpenings,
  companyAtAGlance,
  groupProfile,
  splitParagraphs,
  type PublicCompany,
} from "@/modules/careers/company-profile";

export const metadata = {
  title: "Careers",
  description:
    "Work with Sharm Dreams Group — hospitality, real estate and development in Sharm El Sheikh, Sahl Hasheesh, Marsa Alam and Cairo. Read the group's story, find an open role, apply online.",
};

/**
 * Who the visitor is being asked to join, in the words the group filed for
 * itself in Settings → Master data → Companies.
 *
 * Nothing here is written for the page: every sentence, year and milestone is
 * read from the group's own row, and a field the console leaves blank renders no
 * heading and no paragraph. So the history a candidate reads is the history a
 * recruiter can point to on their own screen, and the day the owner edits it the
 * page changes — which is the only way this page can claim to show the company.
 */
function GroupStory({ group }: { group: PublicCompany }) {
  const atAGlance = companyAtAGlance(group);
  const paragraphs = splitParagraphs(group.history);

  return (
    <section className="mt-12 border-t border-brand-line pt-12" aria-labelledby="group-story">
      <h2 id="group-story" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {group.name}
      </h2>

      {group.tagline && (
        <p className="mt-2 text-base leading-relaxed text-brand-gold-dark">{group.tagline}</p>
      )}

      {atAGlance.length > 0 && (
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          {atAGlance.map((figure) => (
            <div key={figure.labelKey}>
              <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/40">
                <PublicText k={figure.labelKey} />
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-brand-ink/80">
                {figure.valueKey ? (
                  <PublicText k={figure.valueKey} fallback={figure.value} />
                ) : (
                  figure.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {group.description && (
        <div className="mt-6 max-w-3xl space-y-4">
          {splitParagraphs(group.description).map((paragraph, index) => (
            <p
              key={index}
              className="whitespace-pre-line text-sm leading-relaxed text-brand-ink/70"
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {paragraphs.length > 0 && (
        <div className="mt-8 max-w-3xl space-y-4">
          {paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="whitespace-pre-line text-sm leading-relaxed text-brand-ink/70"
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {group.milestones.length > 0 && (
        <div className="mt-10">
          <h3 className="font-display text-lg font-bold">
            <PublicText k="careers.timeline" />
          </h3>
          <ol className="mt-4 space-y-5 border-l border-brand-line pl-5">
            {group.milestones.map((milestone, index) => (
              <li key={`${milestone.title}-${index}`} className="relative">
                <span
                  className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border border-brand-gold/50 bg-white"
                  aria-hidden
                />
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-dark">
                  {milestone.year ? String(milestone.year) : <PublicText k="careers.undated" />}
                </p>
                <p className="mt-0.5 text-sm font-bold text-brand-ink">{milestone.title}</p>
                {milestone.detail && (
                  <p className="mt-1 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-brand-ink/65">
                    {milestone.detail}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {group.benefits.length > 0 && (
        <div className="mt-10">
          <h3 className="font-display text-lg font-bold">
            <PublicText k="careers.benefits" />
          </h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {group.benefits.map((benefit, index) => (
              <li
                key={`${benefit.title}-${index}`}
                className="rounded-2xl border border-brand-line bg-white p-4 shadow-soft"
              >
                <p className="text-sm font-bold">{benefit.title}</p>
                {benefit.text && (
                  <p className="mt-1 text-sm leading-relaxed text-brand-ink/60">{benefit.text}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Public job board.
 *
 * The data is public by policy (`jobs_public_read` only exposes PUBLISHED rows,
 * and the company read asks for `is_active` rows because `tenants_read` lets an
 * anonymous caller see retired ones too), so this page needs no session — every
 * visitor sees the same list, and the board below narrows it in the browser,
 * which is what keeps it one cached read rather than one per visitor.
 *
 * It is still not prerendered, and `await connection()` is what makes that
 * happen. A `use cache` scope reachable from a prerendered route is *executed*
 * during the build's cache-warming phase, whatever its expiry — only what gets
 * baked depends on `cacheLife` (`cacheLife.md:266`). The image builds with no
 * database and no secrets (`.dockerignore` excludes `.env*`), and the anon client
 * refuses to work without `SUPABASE_REST_BASE`, so a warmed board would fail the
 * build. Stopping prerendering here is Next's own mechanism for exactly this
 * (`connection.md`), the same one every `(admin)` page already calls. Between
 * revalidations the running container still serves the cached list, so request
 * time is not one query per page view.
 *
 * With no `loading.tsx` under this layout, the applicant who clicks Careers waits
 * for the board rather than seeing a skeleton — which is what declaring the
 * segment blocking says, and is how `/careers/[id]` already behaves.
 */
export const instant = false;

export default async function CareersPage() {
  await connection();
  const [jobs, companies] = await Promise.all([getPublicJobs(), getPublicCompanies()]);
  const group = groupProfile(companies);
  const rest = companiesWithoutOpenings(companies, jobs);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-4 py-1.5 text-xs font-semibold text-brand-gold-dark shadow-soft">
          <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden />
          <PublicText k="careers.hiring" />
        </span>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {/* The group's own name, as filed. Only a database with no group row
              falls back to the words this page has always carried. */}
          {group?.name ?? "Sharm Dreams Group"}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-brand-ink/65">
          {group?.tagline ??
            "Sharm Dreams Group spans hospitality, real estate and development in Sharm El Sheikh, Hurghada and Cairo."}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-brand-ink/55">
          {group?.careers_pitch ??
            "Search the board, pick a role, apply online, and track your progress with the tracking code you receive."}
        </p>
      </header>

      {group && <GroupStory group={group} />}

      <div className="mt-12">
        <CareersBoard jobs={jobs} companies={companies} />
      </div>

      {rest.length > 0 && (
        <section className="mt-12" aria-labelledby="other-companies">
          <h2 id="other-companies" className="font-display text-lg font-bold">
            <PublicText k="careers.alsoGroup" />
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-brand-ink/55">
            <PublicText k="careers.alsoGroupNote" />
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((company) => (
              <li
                key={company.id}
                className="rounded-2xl border border-brand-line bg-white p-4 shadow-soft"
              >
                <p className="text-sm font-bold">{company.name}</p>
                {company.sector && (
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-gold-dark">
                    <PublicText
                      k={enumKeyFor(company.sector)}
                      fallback={sectorLabel(company.sector)}
                    />
                  </p>
                )}
                {company.tagline && (
                  <p className="mt-2 text-sm leading-relaxed text-brand-ink/60">
                    {company.tagline}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside className="mt-14 rounded-2xl border border-brand-line bg-brand-cream p-6">
        <h2 className="font-display text-base font-bold">
          <PublicText k="careers.applied" />
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-ink/60">
          <PublicText k="careers.appliedNote" />
        </p>
        <Link
          href="/portal"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
        >
          <PublicText k="careers.trackMine" />
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </aside>

      <CareersChat
        starters={starterKeys({ job: null, company: null, group, otherRoleCount: jobs.length })}
      />
    </div>
  );
}
