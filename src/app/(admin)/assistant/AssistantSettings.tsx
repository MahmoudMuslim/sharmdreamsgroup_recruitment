"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantModelChoice } from "./actions";

/**
 * The composer's answering controls, behind one button.
 *
 * Which model replies and what the assistant is allowed to reach for are set once
 * a sitting and then left alone, but the transcript is the reason the panel is
 * open: two paragraphs of switch copy above the box pushed it off the screen in a
 * dock that is barely taller than it is wide. So the choices live here, and the
 * button says what is in force without opening anything.
 *
 * Every control is the same element the panel had before, with the same copy —
 * moving a switch behind a button must not quietly shorten what it promises.
 */
export function AssistantSettings({
  model,
  routedModel,
  models,
  onChooseModel,
  allowWeb,
  onAllowWeb,
  allowDestructive,
  onAllowDestructive,
}: {
  /** "" is default routing: the table in Settings → AI models answers. */
  model: string;
  /** The model that table names, so the strip can say who replies by default. */
  routedModel: string;
  /** null while the catalogue is still being read. */
  models: AssistantModelChoice[] | null;
  onChooseModel: (value: string) => void;
  allowWeb: boolean;
  onAllowWeb: (value: boolean) => void;
  allowDestructive: boolean;
  onAllowDestructive: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  /*
   * Escape closes the panel before it closes the assistant. The dock listens for
   * Escape on `window` to put itself away, and a bubble listener cannot get there
   * first, so this one is on the capture phase: it runs on the way down the tree,
   * stops the popover, and leaves the panel open.
   */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const modelGroups = useMemo(() => {
    const groups: { provider: string; label: string; models: AssistantModelChoice[] }[] = [];
    for (const entry of models ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.provider === entry.provider) last.models.push(entry);
      else groups.push({ provider: entry.provider, label: entry.providerLabel, models: [entry] });
    }
    return groups;
  }, [models]);

  const label = model || (routedModel ? `Default · ${routedModel}` : "Default routing");
  const switchesOn = [allowWeb && "web search", allowDestructive && "deletions"].filter(Boolean);

  return (
    <div ref={wrapRef} className="relative mb-2">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        title="Which model answers, and what this assistant may reach for"
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold transition",
          open
            ? "border-brand-gold bg-brand-gold/20 text-brand-ink"
            : "border-brand-line text-brand-ink/60 hover:bg-brand-sand"
        )}
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {/* The model id can be long; the strip keeps its head and drops its tail. */}
          {label.length > 34 ? `${label.slice(0, 33)}…` : label}
        </span>
        {switchesOn.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand-gold/30 px-1.5 py-0.5 text-[10px] font-bold text-brand-gold-dark">
            {switchesOn.length === 1 ? switchesOn[0] : `${switchesOn.length} on`}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Assistant answering settings"
          className={cn(
            "rail-scroll absolute bottom-full left-0 z-20 mb-1 max-h-[min(26rem,55vh)] w-full overflow-y-auto",
            "rounded-xl border border-brand-line bg-white p-3 shadow-lift sm:w-[22rem]"
          )}
        >
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-brand-ink/45">
            Answering settings
          </p>

          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
              Model
            </span>
            {models === null ? (
              <span className="flex items-center gap-1.5 text-[11px] text-brand-ink/45" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Reading the model list…
              </span>
            ) : (
              <select
                value={model}
                onChange={(event) => onChooseModel(event.target.value)}
                aria-label="Model for this conversation"
                title="Choose which provider answers this conversation. Nothing in Settings is changed."
                className="rail-scroll min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-semibold text-brand-ink outline-none transition focus:border-brand-gold"
              >
                <option value="">
                  {routedModel ? `Default routing — ${routedModel}` : "Default routing"}
                </option>
                {modelGroups.map((group) => (
                  <optgroup key={group.provider} label={group.label}>
                    {group.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                        {entry.free ? " · free" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </label>
          {model && (
            <p className="mt-1 text-[10px] leading-relaxed text-brand-ink/40">
              {model} answers this conversation through the model gateway, and this tab closes the
              choice away. Settings → AI models still routes every other screen, the rest of the
              portal and any other conversation.
            </p>
          )}

          <div className="my-2 border-t border-brand-line" />

          <label className="mb-2 flex items-start gap-2 text-[11px] leading-snug text-brand-ink/55">
            <input
              type="checkbox"
              checked={allowDestructive}
              onChange={(event) => onAllowDestructive(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-gold-dark"
            />
            <span>
              Allow deletions — lets me offer an opening, a prospect or a queued message for you to
              approve when you name it. Every delete still waits for your click. It is never
              remembered between conversations.
            </span>
          </label>

          <label className="flex items-start gap-2 text-[11px] leading-snug text-brand-ink/55">
            <input
              type="checkbox"
              checked={allowWeb}
              onChange={(event) => onAllowWeb(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-gold-dark"
              title="Let this assistant look up anything outside this portal"
            />
            <span>
              Allow web search — lets me look up what is outside this portal, about any subject: a
              pay band, a law, a competitor&apos;s ad, a release note, a company. Each lookup shows
              as a chip naming the words searched and the pages it read, and what comes back is
              advice with its source named — I never write a fetched figure into a record. The
              search belongs to this portal, not to one engine, so it works whichever engine or
              model answers, and this switch is remembered in this browser. It runs on the
              OpenRouter key in Settings → API keys: without one, a lookup refuses and its chip says
              why.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
