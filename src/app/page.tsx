import Link from "next/link";
import { ArrowRight, BookOpen, Briefcase, Sparkles, Users } from "lucide-react";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import { getCandidateLocales } from "@/modules/settings/application/candidateLocales";
import {
  PublicDir,
  PublicLocaleProvider,
  PublicPrefs,
  PublicText,
} from "@/modules/shell/presentation/PublicChrome";

/**
 * Every destination here is public. The platform's admin side is deliberately
 * not advertised on the landing page, so none of these cards may point at a
 * staff route: a candidate who clicks through would land on the sign-in screen.
 */
const CAPABILITIES = [
  {
    href: "/careers",
    icon: Briefcase,
    eyebrow: "home.cap1Eyebrow",
    title: "home.cap1Title",
    copy: "home.cap1Copy",
  },
  {
    href: "/careers",
    icon: BookOpen,
    eyebrow: "home.cap2Eyebrow",
    title: "home.cap2Title",
    copy: "home.cap2Copy",
  },
  {
    href: "/portal",
    icon: Users,
    eyebrow: "home.cap3Eyebrow",
    title: "home.cap3Title",
    copy: "home.cap3Copy",
  },
] as const;

const SUBSIDIARIES = [
  "Sharm Dreams Touristic",
  "Rowad Misr Development",
  "Sharm Dreams Real Estate",
  "SDG Corporate Services",
] as const;



export default async function Home() {
  const { defaultLocale, enabledLocales } = await getCandidateLocales();

  return (
    <PublicLocaleProvider defaultLocale={defaultLocale}>
      <PublicDir>
      <main className="min-h-screen bg-brand-ivory text-brand-ink">
        {/* ---------- Header ---------- */}
        <header className="sticky top-0 z-40 border-b border-brand-line bg-brand-cream/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SdgLockup />
            </div>

            <nav className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/careers"
                className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink/70 transition hover:bg-brand-sand hover:text-brand-ink"
              >
                <PublicText k="chrome.careers" />
              </Link>
              <Link
                href="/portal"
                className="rounded-xl bg-brand-ink px-4 py-2 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
              >
                <PublicText k="chrome.trackCta" />
              </Link>
              <PublicPrefs enabledLocales={enabledLocales} className="ml-1" />
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
              <PublicText k="home.badge" />
            </span>

            <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              <PublicText k="home.titleA" />
              <span className="font-serif-accent font-normal italic text-brand-gold-dark">
                {" "}
                <PublicText k="home.titleB" />
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-brand-ink/65 sm:text-lg">
              <PublicText k="home.lede" />
            </p>

            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/careers"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ink px-7 py-3.5 text-sm font-bold text-brand-cream shadow-lift transition hover:bg-brand-ink/90"
              >
                <PublicText k="chrome.careers" className="shrink-0" />
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/portal"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-7 py-3.5 text-sm font-bold text-brand-ink transition hover:bg-brand-sand"
              >
                <PublicText k="chrome.trackCta" />
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
                key={title}
                href={href}
                className="group flex flex-col rounded-2xl border border-brand-line bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:shadow-lift"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark transition group-hover:bg-brand-gold/25">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
                  <PublicText k={eyebrow} />
                </p>
                <h2 className="mt-1 font-display text-lg font-bold leading-snug">
                  <PublicText k={title} />
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-brand-ink/60">
                  <PublicText k={copy} />
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-ink/45 transition group-hover:text-brand-gold-dark">
                  <PublicText k="chrome.explore" />
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
              <PublicText k="home.serving" />
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

        <footer className="bg-brand-footer py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center sm:px-6">
            <p className="font-display text-sm font-bold text-brand-on-accent">
              Sharm Dreams Talent Cloud
            </p>
            <p className="text-xs text-brand-on-accent/80">
              © Sharm Dreams Group · <PublicText k="home.footerTag" />
            </p>
          </div>
        </footer>
      </main>
      </PublicDir>
    </PublicLocaleProvider>
  );
}
