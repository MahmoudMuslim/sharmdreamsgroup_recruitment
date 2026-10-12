import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles, Users, Zap } from "lucide-react";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";

const CAPABILITIES = [
  {
    href: "/dashboard",
    icon: Zap,
    eyebrow: "Analytics",
    title: "Real-time hiring intelligence",
    copy: "Pipeline conversion, channel effectiveness, AI fit distributions and diversity metrics — live from the database.",
  },
  {
    href: "/assessments",
    icon: BookOpen,
    eyebrow: "Assessments",
    title: "Canditech-style test suites",
    copy: "In-browser financial models with NPV and IRR, video pitches with sentiment analysis, case studies and graded quizzes.",
  },
  {
    href: "/portal",
    icon: Users,
    eyebrow: "Candidate experience",
    title: "A portal candidates trust",
    copy: "Track application status, interview schedules and next steps from any device, at any time.",
  },
] as const;

const SUBSIDIARIES = [
  "Sharm Dreams Touristic",
  "Rowad Misr Development",
  "Sharm Dreams Real Estate",
  "SDG Corporate Services",
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-brand-ivory text-brand-ink">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 border-b border-brand-line bg-brand-cream/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SdgLockup />
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/portal"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink/70 transition hover:bg-brand-sand hover:text-brand-ink"
            >
              Candidate portal
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-brand-ink px-4 py-2 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
            >
              Staff sign-in
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-24 top-[-10%] h-[420px] w-[420px] rounded-full bg-brand-gold/20 blur-[130px]" />
          <div className="absolute -right-24 bottom-[-20%] h-[420px] w-[420px] rounded-full bg-brand-gold/10 blur-[130px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-4 py-1.5 text-xs font-semibold text-brand-gold-dark shadow-soft">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            AI-driven recruitment platform
          </span>

          <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Talent intelligence,
            <span className="font-serif-accent font-normal italic text-brand-gold-dark">
              {" "}
              without the bottlenecks
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-brand-ink/65 sm:text-lg">
            Multi-tenant recruitment for the Sharm Dreams Group — bias-reduced CV screening,
            interactive assessment suites, automated scheduling and real-time hiring analytics.
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-7 py-3.5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90"
            >
              Open the admin panel
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/portal"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-7 py-3.5 text-sm font-bold text-brand-ink transition hover:bg-brand-sand"
            >
              Track an application
            </Link>
          </div>

          <div className="mx-auto mt-14 h-px w-32 rule-gold" aria-hidden />
        </div>
      </section>

      {/* ---------- Capabilities ---------- */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {CAPABILITIES.map(({ href, icon: Icon, eyebrow, title, copy }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col rounded-2xl border border-brand-line bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:shadow-lift"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark transition group-hover:bg-brand-gold/25">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
                {eyebrow}
              </p>
              <h2 className="mt-1 font-display text-lg font-bold leading-snug">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-brand-ink/60">{copy}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-ink/45 transition group-hover:text-brand-gold-dark">
                Explore
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Subsidiaries ---------- */}
      <section className="border-y border-brand-line bg-brand-cream">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-brand-ink/40">
            Serving the group
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {SUBSIDIARIES.map((name) => (
              <span
                key={name}
                className="font-display text-sm font-semibold tracking-wide text-brand-ink/55 sm:text-base"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-brand-ink py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center sm:px-6">
          <p className="font-display text-sm font-bold text-brand-cream">
            Sharm Dreams Talent Cloud
          </p>
          <p className="text-xs text-brand-cream/50">
            © Sharm Dreams Group · Enterprise HRMS, ATS &amp; assessment platform
          </p>
        </div>
      </footer>
    </main>
  );
}