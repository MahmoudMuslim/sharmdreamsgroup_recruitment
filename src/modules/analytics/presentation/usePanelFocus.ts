"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The controls worth landing on when a panel opens, in DOM order.
 *
 * `button` is deliberately absent from this list. It used to be in it, and
 * because every panel carries its Close button in the header *above* the
 * fields, Close was the first match — so "move focus into the panel" parked the
 * user on the one control that throws their work away. Disabled and read-only
 * fields are skipped for the same reason: focus that cannot be typed into is
 * focus that has gone nowhere.
 */
const FIRST_FIELD = [
  "input:not([type=hidden]):not([disabled]):not([readonly])",
  "textarea:not([disabled]):not([readonly])",
  "select:not([disabled])",
].join(", ");

/**
 * Moves focus into a panel when it opens, and closes it on Escape.
 *
 * This runs when `open` flips and not again. Every caller passes `onClose` as
 * an inline arrow, so its identity changes on every parent render; having it as
 * a dependency meant each keystroke re-rendered the parent, tore the effect down
 * and re-focused the panel's first control — which is what made a field
 * impossible to type into. The callback is read through a ref instead, so
 * Escape still calls the newest one.
 */
export function usePanelFocus(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void
) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const field = panel?.querySelector<HTMLElement>(FIRST_FIELD);
    // A read-only panel has no field to offer, so focus the panel itself rather
    // than leaving it on the page behind the scrim. That is why the panel carries
    // `tabIndex={-1}`: it makes an element focusable without putting it in the
    // tab order.
    (field ?? panel)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open, panelRef]);
}
