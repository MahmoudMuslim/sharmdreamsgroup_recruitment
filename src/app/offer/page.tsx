import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { verifyOfferToken } from "@/modules/offers/application/offerToken";
import { PublicText } from "@/modules/shell/presentation/PublicChrome";
import { describeOfferLink, type OfferDoorDescription } from "./actions";
import { OfferDoor } from "./OfferDoor";

type Described = Extract<OfferDoorDescription, { ok: true }>;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata: Metadata = {
  title: "Your offer",
  description: "Accept or decline the offer we emailed you.",
  // The address names one offer; indexing it would put somebody's offer in front
  // of search engines for no reason.
  robots: { index: false, follow: false },
};

/** A repeated parameter is not a link; a browser reads the first value, so this does too. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The offer is whichever one the mailed link names, so the page has nothing to
 * say until the request arrives — it renders per request, like the apply page.
 */
export const instant = false;

/**
 * The page a mailed offer link opens.
 *
 * The link is checked here before anything is read: a mangled or expired token is
 * refused with a sentence and without touching the database. Only a link whose
 * signature and purpose both hold is handed to `describeOfferLink`, which looks
 * up the one offer it names.
 *
 * Accepting records the answer and nothing else — the stage stays where the desk
 * put it until a recruiter confirms the hire. Declining keeps the person in the
 * pipeline marked declined, and the desk decides what happens next. Expiry never
 * answers for anybody: a late click is told the deadline passed, not accepted.
 */
export default async function OfferPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = first(params.token).trim();

  let description: Described | null = null;
  let problem: string | null = null;

  if (token) {
    const signed = verifyOfferToken(token);
    if (!signed.ok) {
      problem =
        signed.reason === "expired"
          ? "That link has expired. Ask the recruiter who sent it for a new one."
          : "That link is not one this portal issued, or it has been changed. Ask the recruiter who sent it for a new one.";
    } else {
      const described = await describeOfferLink(token);
      if (described.ok) description = described;
      else problem = described.message;
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/careers"
        className="inline-flex min-h-6 items-center gap-1.5 text-sm font-semibold text-brand-ink/55 transition hover:text-brand-ink"
      >
        <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
        <PublicText k="offer.back" />
      </Link>

      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-gold-dark">
        <PublicText k="offer.eyebrow" />
      </p>
      <h1 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
        <PublicText k="offer.title" />
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-ink/65">
        <PublicText k="offer.intro" />
      </p>

      <OfferDoor token={token || null} description={description} problem={problem} />
    </div>
  );
}
