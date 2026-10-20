"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageSummary, type PageWindow } from "@/lib/paging";

/**
 * The pager every bounded list shares.
 *
 * It is deliberately two buttons and a sentence rather than a strip of numbered
 * pages: a list here can be thousands of rows deep, and a strip of 128 page buttons
 * is a control nobody can use. What the reader needs to know is which rows are on
 * screen, how many the scope holds, and that there are more — and `pageSummary` is
 * the sentence that says all three, so a page that shows 25 of 318 cannot read as
 * the whole table.
 *
 * The buttons take either a handler or an href. A list that filters in the browser
 * already re-renders on a state change, so it passes `onChange`; a list drawn by a
 * server component passes `href` and the page is a navigation, which is what keeps
 * the address bar, the Back button and a link pasted into the chat all describing
 * the same rows.
 */
export function Pagination({
  window,
  noun,
  onChange,
  href,
  pending,
  className,
}: {
  window: PageWindow;
  /** What one row is called, plural — printed in the summary line. */
  noun: string;
  onChange?: (page: number) => void;
  href?: (page: number) => string;
  /** Grey the buttons out while a page is being read. */
  pending?: boolean;
  className?: string;
}) {
  if (window.pages <= 1 && window.total <= window.size) return null;

  const back = window.page - 1;
  const forward = window.page + 1;
  const hasBack = back >= 1;
  const hasForward = window.to < window.total && forward <= window.pages;

  const buttonClass = cn(
    "inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3.5 py-2",
    "text-xs font-semibold text-brand-ink/70 transition hover:bg-brand-sand",
    "disabled:cursor-not-allowed disabled:opacity-40"
  );

  return (
    <nav
      aria-label={`More ${noun}`}
      className={cn("flex flex-wrap items-center gap-3 text-xs", className)}
    >
      {hasBack &&
        (href ? (
          <a href={href(back)} className={buttonClass}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Newer
          </a>
        ) : (
          <button type="button" onClick={() => onChange?.(back)} disabled={pending} className={buttonClass}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Newer
          </button>
        ))}

      {hasForward &&
        (href ? (
          <a href={href(forward)} className={buttonClass}>
            Older
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onChange?.(forward)}
            disabled={pending}
            className={buttonClass}
          >
            Older
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ))}

      <span className="text-brand-ink/45">
        {pageSummary(window, noun)}
        {window.pages > 1 ? ` Page ${window.page} of ${window.pages}.` : ""}
      </span>
    </nav>
  );
}
