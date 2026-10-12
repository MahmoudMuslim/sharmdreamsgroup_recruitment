import Link from "next/link";
import { SdgLockup } from "@/modules/analytics/presentation/BrandLogo";

/**
 * Public careers shell.
 *
 * Candidates reach these pages with no session, so the chrome lives here rather
 * than in the admin `AdminShell`. It mirrors the landing page header and footer
 * so the brand is continuous across the public surface.
 */
export default function CareersLayout({ children }: LayoutProps<"/careers">) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-ivory text-brand-ink">
      <header className="sticky top-0 z-40 border-b border-brand-line bg-brand-cream/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="min-w-0">
            <SdgLockup />
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/portal"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink/70 transition hover:bg-brand-sand hover:text-brand-ink"
            >
              Track application
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

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-brand-line bg-brand-ink py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center sm:px-6">
          <p className="font-display text-sm font-bold text-brand-cream">
            Sharm Dreams Group
          </p>
          <p className="text-xs text-brand-cream/50">
            Applications are reviewed by our people team. Keep your tracking code — it is
            the only way to follow your application.
          </p>
        </div>
      </footer>
    </div>
  );
}