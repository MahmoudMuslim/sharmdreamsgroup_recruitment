import Link from "next/link";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";
import { getCandidateLocales } from "@/modules/settings/application/candidateLocales";
import {
  PublicDir,
  PublicLocaleProvider,
  PublicPrefs,
  PublicText,
} from "@/modules/shell/presentation/PublicChrome";

/**
 * The shell around the privacy door.
 *
 * A person reaches this page from a mailed link, often long after they applied,
 * so it wears the same brand, language and theme as the careers board rather
 * than looking like a stray form. The chrome is the careers layout's, repeated
 * because this route is not under `/careers` — its path is written into mailed
 * links and must not move.
 */
export default async function PrivacyLayout({ children }: LayoutProps<"/privacy">) {
  const { defaultLocale, enabledLocales } = await getCandidateLocales();

  return (
    <PublicLocaleProvider defaultLocale={defaultLocale}>
      <PublicDir className="flex min-h-screen flex-col bg-brand-ivory text-brand-ink">
        <header className="sticky top-0 z-40 border-b border-brand-line bg-brand-cream/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="min-w-0">
              <SdgLockup />
            </Link>

            <div className="flex items-center gap-1 sm:gap-2">
              <PublicPrefs enabledLocales={enabledLocales} />
              <Link
                href="/careers"
                className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink/70 transition hover:bg-brand-sand hover:text-brand-ink"
              >
                <PublicText k="chrome.careers" />
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-16 border-t border-brand-line bg-brand-footer py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center sm:px-6">
            <p className="font-display text-sm font-bold text-brand-on-accent">
              Sharm Dreams Group
            </p>
            <p className="max-w-2xl text-xs leading-relaxed text-brand-on-accent/80">
              <PublicText k="chrome.careersFooter" />
            </p>
          </div>
        </footer>
      </PublicDir>
    </PublicLocaleProvider>
  );
}
