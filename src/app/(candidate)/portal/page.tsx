import type { Metadata } from "next";
import { connection } from "next/server";
import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { getCandidateLocales } from "@/modules/settings/application/candidateLocales";
import { translate } from "@/lib/i18n";
import { PortalTracker } from "./PortalTracker";

/**
 * The support address and the language rows are uncached database reads, so
 * this route blocks and renders per request instead of being prerendered —
 * same as the staff pages.
 */
export const instant = false;

/** Shown when Settings has no support address, so the help box is never empty. */
const DEFAULT_SUPPORT_EMAIL = "careers@sharmdreamsgroup.com";

/** Tab and search-result copy follow the same default as the page body. */
export async function generateMetadata(): Promise<Metadata> {
  const { defaultLocale } = await getCandidateLocales();
  return {
    title: translate(defaultLocale, "portal.title"),
    description: translate(defaultLocale, "portal.intro"),
  };
}

export default async function CandidatePortalPage() {
  await connection();

  // The `?code=…` pre-fill is still read on the client rather than from
  // `searchParams`, which keeps the lookup logic next to the form that owns it.
  const [supportEmail, locales] = await Promise.all([
    getStringSetting("organisation.support_email", DEFAULT_SUPPORT_EMAIL),
    getCandidateLocales(),
  ]);

  return (
    <PortalTracker
      supportEmail={supportEmail}
      locale={locales.defaultLocale}
      enabledLocales={locales.enabledLocales}
    />
  );
}
