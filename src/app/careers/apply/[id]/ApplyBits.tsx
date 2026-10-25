"use client";

import { type ReactNode } from "react";

/* --------------------------------------------------------------------- steps */

/**
 * The sources an applicant may choose. REFERRAL is not one of them: it is earned
 * by a staff member's code on the link and resolved by the submit action, so a
 * person cannot declare themselves referred — or spare a referrer's claim — by
 * changing a picker.
 */
export const SOURCES = [
  { value: "CAREER_SITE", key: "apply.source.site" },
  { value: "JOB_BOARD", key: "apply.source.board" },
] as const;

/**
 * How every source is named on the review step, including the one that was not
 * chosen here. A code-earned referral still has to be printed in words.
 */
const SOURCE_KEYS: Record<string, string> = {
  CAREER_SITE: "apply.source.site",
  JOB_BOARD: "apply.source.board",
  REFERRAL: "apply.source.referral",
};

export function sourceKey(source: string): string | null {
  return SOURCE_KEYS[source] ?? null;
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

export const FIELD =
  "w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm focus:border-brand-gold focus:bg-white focus:outline-none";

export function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold">
      {children}
    </label>
  );
}

/**
 * A step's heading, with the one control that belongs to the whole step sitting on
 * its right. The About-you draft button lives here because it writes from anything
 * on the step, not from the box under it — and a candidate looking for the CV door
 * finds it at the top, beside the words they are being asked to fill.
 */
export function StepHead({
  title,
  note,
  action,
}: {
  title: string;
  note: string;
  action?: ReactNode;
}) {
  const head = (
    <>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-brand-ink/55">{note}</p>
    </>
  );

  if (!action) return head;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">{head}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
