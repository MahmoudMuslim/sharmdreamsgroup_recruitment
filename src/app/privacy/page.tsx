import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { verifyPrivacyToken } from "@/modules/privacy/application/linkToken";
import { PRIVACY_NOTICE_VERSION } from "@/modules/privacy/domain/privacy";
import { readPrivacySettings } from "@/modules/privacy/infrastructure/privacyReader";
import { PublicText } from "@/modules/shell/presentation/PublicChrome";
import { describePrivacyToken, type PrivacyTokenDescription } from "./actions";
import { PrivacyDoor } from "./PrivacyDoor";

type Described = Extract<PrivacyTokenDescription, { ok: true }>;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Ask for a copy of what the Sharm Dreams Group holds about your application, or ask for it to be erased.",
  // A mailed link names one application; an index would put that page's address
  // in front of search engines for no reason.
  robots: { index: false, follow: false },
};

/** A repeated parameter is not a link; a browser reads the first value, so this does too. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The record shown is whichever one the mailed link names, so the page has
 * nothing to say until the request arrives — it renders per request.
 */
export const instant = false;

/**
 * The page a mailed privacy link opens, and the door for asking for one.
 *
 * The link is checked here before anything is read: a mangled or expired token
 * is refused with a sentence and the "ask for a new link" form, without touching
 * the database. Only a link whose signature and expiry both hold is handed to
 * `describePrivacyToken`, which looks up the one application it names.
 *
 * There is deliberately no way to see a record without a link. The request form
 * takes an address and always answers the same sentence, and the link it mails
 * goes to the address stored on the application — never to the one typed — so a
 * guess cannot divert somebody else's link or confirm that they applied.
 */
export default async function PrivacyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = first(params.token).trim();

  let description: Described | null = null;
  let problem: string | null = null;

  if (token) {
    const signed = verifyPrivacyToken(token);
    if (!signed.ok) {
      problem =
        signed.reason === "expired"
          ? "That link has expired. Ask for a new one below."
          : "That link is not one this portal issued, or it has been changed. Ask for a new one below.";
    } else {
      const described = await describePrivacyToken(token);
      if (described.ok) description = described;
      else problem = described.message;
    }
  }

  // The figures on the page are the ones the sweep obeys, not a copy typed into
  // this file: an owner who changes the window in Settings changes this notice.
  const settings = await readPrivacySettings();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/careers"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink/55 transition hover:text-brand-ink"
      >
        <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
        <PublicText k="privacy.back" />
      </Link>

      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
        <PublicText k="privacy.eyebrow" />
      </p>
      <h1 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
        <PublicText k="privacy.title" />
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-ink/65">
        <PublicText k="privacy.intro" />
      </p>

      <PrivacyDoor token={token || null} description={description} problem={problem} />

      <section className="mt-10 border-t border-brand-line pt-8" aria-labelledby="what-we-hold">
        <h2 id="what-we-hold" className="font-display text-lg font-bold tracking-tight">
          <PublicText k="privacy.keepTitle" />
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-ink/65">
          <PublicText
            k="privacy.keepBody"
            vars={{
              months: settings.months,
              poolMonths: settings.talentPoolMonths,
              warningDays: settings.warningDays,
            }}
          />
        </p>
        <p className="mt-2 text-sm leading-relaxed text-brand-ink/50">
          <PublicText k="privacy.noticeVersion" vars={{ version: PRIVACY_NOTICE_VERSION }} />
        </p>
      </section>

      <section className="mt-8" aria-labelledby="erasure">
        <h2 id="erasure" className="font-display text-lg font-bold tracking-tight">
          <PublicText k="privacy.erasureTitle" />
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-ink/65">
          <PublicText k="privacy.erasureBody" />
        </p>
      </section>

      <section className="mt-8" aria-labelledby="decide">
        <h2 id="decide" className="font-display text-lg font-bold tracking-tight">
          <PublicText k="privacy.decideTitle" />
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-ink/65">
          <PublicText k="privacy.decideBody" />
        </p>
      </section>
    </div>
  );
}
