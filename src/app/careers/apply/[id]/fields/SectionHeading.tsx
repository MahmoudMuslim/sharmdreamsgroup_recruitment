"use client";

import type { RendererProps } from "./types";

/** A heading is never a step field, but the type stays answerable by the switch. */
export function SectionHeading({ label, help }: RendererProps) {
  return (
    <div className="mt-5 first-of-type:mt-0">
      <h3 className="font-display text-lg font-bold">{label}</h3>
      {help && <p className="mt-1 text-sm text-brand-ink/55">{help}</p>}
    </div>
  );
}
