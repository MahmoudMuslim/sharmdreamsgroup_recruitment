"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Right-hand slide-in drawer.
 *
 * Every "New X" / "Edit X" button in the admin app opens one of these. It is
 * deliberately shared so the close affordance, focus behaviour and scroll
 * locking are identical everywhere rather than re-implemented per panel.
 *
 * Replaces the full-page modal because a modal hides the list the user is
 * working from — the drawer keeps it visible.
 *
 * "Slide-in" is the `.panel-in` animation in globals.css, and it runs on the way
 * in only: the caller drops `open` and this component returns null, so there is
 * no element left to carry an exit. Four settings panels used to ask for it with
 * `animate-in slide-in-from-right`, a class pair this build never generates —
 * Tailwind v4 ships those names through a plugin that is not installed — so the
 * panels appeared, they did not slide.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  children,
  footer,
  onSubmit,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * When provided, the panel becomes a real <form> so `type="submit"` in the
   * footer works and Enter submits from any field. Without it the drawer is
   * read-only.
   */
  onSubmit?: () => void;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Move focus in so keyboard and screen-reader users land inside the drawer.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), textarea, select, button"
    );
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // Prevent the page behind from scrolling under the drawer.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  // A form needs to wrap both the body and the footer so the submit button in
  // the footer belongs to it.
  const Body = (
    <>
      <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
        {children}
      </div>
      {footer && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-brand-line bg-brand-cream p-5">
          {footer}
        </footer>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        className={cn(
          "panel-in absolute inset-y-0 right-0 flex w-full flex-col border-l border-brand-line bg-white shadow-2xl",
          width
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-brand-line p-5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                {eyebrow}
              </p>
            )}
            <h2 id="drawer-title" className="mt-0.5 truncate font-display text-lg font-bold">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-xs text-brand-ink/50">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {onSubmit ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {Body}
          </form>
        ) : (
          Body
        )}
      </div>
    </div>
  );
}