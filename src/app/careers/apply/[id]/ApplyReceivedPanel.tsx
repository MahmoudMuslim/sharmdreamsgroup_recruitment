"use client";

import Link from "next/link";
import {
  CheckCircle2
} from "lucide-react";
import { usePublicLocale } from "@/modules/shell/presentation/PublicChrome";
import { translate } from "@/lib/i18n";

/* -------------------------------------------------------------------- panels */

/** Every question answered acceptably: the application now waits on a person. */
export function ReceivedPanel({
  jobTitle,
  trackingCode,
}: {
  jobTitle: string;
  trackingCode: string;
}) {
  const locale = usePublicLocale();
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
        <CheckCircle2 className="h-9 w-9 text-emerald-700" aria-hidden />

        <h1 className="mt-4 font-display text-2xl font-bold text-emerald-900">
          {t("apply.doneTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          {t("apply.doneBody", { role: jobTitle })}
        </p>

        <div className="mt-6 rounded-xl border border-emerald-300 bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            {t("apply.doneCode")}
          </p>
          <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wider text-brand-ink">
            {trackingCode}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-brand-ink/60">
            {t("apply.doneCodeNote")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`/portal?code=${encodeURIComponent(trackingCode)}`}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-5 py-2.5 text-sm font-bold text-brand-cream transition hover:bg-brand-ink/90"
            >
              {t("apply.doneTrack")}
            </a>
            <Link
              href="/careers"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line px-5 py-2.5 text-sm font-bold text-brand-ink/70 transition hover:bg-brand-cream"
            >
              {t("apply.doneBack")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
