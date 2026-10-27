"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Badge, Card, CardHeader } from "@/modules/analytics/presentation/ui";
import { PERSON_GROUP_LABELS } from "@/modules/candidates/domain/person-fields";
import { GRID_CLASS, SPAN_CLASS } from "@/modules/form-builder/domain/rowLayout";
import type { PublicField, PublicStep } from "@/modules/form-builder/application/publicForm";
import type {
  FormPreviewPayload,
  FormPreviewWalk,
} from "@/modules/form-builder/application/formPreview";
import { cn } from "@/lib/utils";

/**
 * What the applicant would be asked, next to the questions that make it (spec §6).
 *
 * The panel is read-only on purpose. It renders `project()`'s output — the same
 * shape the apply page is handed — and it has no submit control, no upload and no
 * `<form>`: a preview that could file an application would be a second apply door
 * nobody audited. The only thing it can do is ask the server for one opening's
 * walk, which is a read of what that opening already asks.
 *
 * The composition tab comes in with the page, so first paint carries no
 * waterfall. A tab named for an opening is read when it is clicked, because an
 * opening's walk is the applicant's own `resolveFormForJob` and that read
 * belongs to the tab that claims it, not to every form page loaded.
 */

/** Tabs are keyed by opening id; the composition tab has none. */
const COMPOSITION_KEY = "composition";

function bytesOf(maxBytes: number): string {
  const megabytes = maxBytes / (1024 * 1024);
  return megabytes >= 1
    ? `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
    : `${Math.round(maxBytes / 1024)} KB`;
}

/** The MIME list the projection derived; read as types, not as a string of slashes. */
function formatsOf(accept: string): string {
  return accept
    .split(",")
    .map((mime) => mime.trim().replace("image/", "").replace("application/", ""))
    .filter((mime) => mime.length > 0)
    .join(" · ");
}

function QuestionRow({ field }: { field: PublicField }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-brand-line bg-white/70 px-3 py-2",
        field.required && "border-brand-gold/50",
      )}
    >
      <p className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-xs font-semibold leading-snug">{field.label}</span>
        {field.required && (
          <span className="text-[10px] font-bold text-rose-700" aria-hidden>
            *
          </span>
        )}
      </p>
      {field.help && (
        <p className="mt-0.5 text-[10px] leading-relaxed text-brand-ink/50">{field.help}</p>
      )}
      {field.placeholder && (
        <p className="mt-1 rounded-lg border border-dashed border-brand-line px-2 py-1 text-[10px] italic text-brand-ink/35">
          {field.placeholder}
        </p>
      )}
      {field.options && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {field.options.map((option) => (
            <li
              key={option}
              className="rounded-full border border-brand-line bg-brand-cream/60 px-2 py-0.5 text-[10px]"
            >
              {option}
            </li>
          ))}
        </ul>
      )}
      {field.units && (
        <p className="mt-1.5 text-[10px] text-brand-ink/45">Units: {field.units.join(" · ")}</p>
      )}
      {(field.accept || field.maxBytes !== undefined) && (
        <p className="mt-1.5 text-[10px] text-brand-ink/45">
          {field.accept ? `Takes ${formatsOf(field.accept)}` : "Upload"}
          {field.maxBytes !== undefined && ` · up to ${bytesOf(field.maxBytes)}`}
        </p>
      )}
    </div>
  );
}

function StepBlock({ step, index }: { step: PublicStep; index: number }) {
  return (
    <section
      className="rounded-2xl border border-brand-line bg-brand-cream/30 p-3"
      aria-label={`Step ${index + 1}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-baseline gap-1.5 text-sm font-bold">
          <span className="text-[10px] font-bold tabular-nums text-brand-ink/35">
            {index + 1}
          </span>
          {step.heading ?? "Untitled step"}
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">
            {step.fields.length} question{step.fields.length === 1 ? "" : "s"}
          </Badge>
          {step.consentGroups.map((group) => (
            <span
              key={group}
              className="rounded bg-brand-gold/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-gold-dark"
            >
              {PERSON_GROUP_LABELS[group]}
            </span>
          ))}
        </span>
      </div>
      {step.fields.length === 0 ? (
        <p className="px-1 text-[11px] text-brand-ink/40">
          This step has a heading and no questions under it.
        </p>
      ) : (
        <div className={cn(GRID_CLASS, "gap-2")}>
          {step.fields.map((field, fieldIndex) => (
            <div key={`${field.key}-${String(fieldIndex)}`} className={SPAN_CLASS[field.width]}>
              <QuestionRow field={field} />
            </div>
          ))}
        </div>
      )}
      {step.consentGroups.length > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-brand-ink/40">
          The applicant ticks one box for{" "}
          {step.consentGroups.map((group) => PERSON_GROUP_LABELS[group]).join(" and ")} before
          this step is accepted, and may decline it and still apply.
        </p>
      )}
    </section>
  );
}

function WalkBody({ walk }: { walk: FormPreviewWalk }) {
  if (walk.broken.length > 0) {
    return (
      <div className="space-y-2">
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-900">
          This walk does not compose, so an applicant here gets the built-in wizard and the
          console refuses a publish.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-rose-800">
          {walk.broken.map((reason, index) => (
            <li key={`${index}-${reason}`}>{reason}</li>
          ))}
        </ul>
      </div>
    );
  }

  const steps = walk.form?.steps ?? [];
  const questions = steps.reduce((total, step) => total + step.fields.length, 0);

  return (
    <div className="space-y-3">
      {walk.truncated && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          A read hit its bound, so this walk may be missing a global form or a question.
        </p>
      )}
      {!walk.showsDraft && (
        <p className="rounded-xl border border-brand-gold/40 bg-brand-sand/40 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/60">
          Your saved questions are not in this walk. They join it when the form is published
          and this opening asks it.
        </p>
      )}
      {questions === 0 ? (
        <p className="px-1 py-4 text-center text-[11px] text-brand-ink/45">
          Nothing to show — no global form and no question asks anything of the applicant yet.
        </p>
      ) : (
        steps.map((step, index) => <StepBlock key={`${step.heading ?? ""}-${String(index)}`} step={step} index={index} />)
      )}
      {walk.wouldNotPublish.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="text-[11px] font-bold text-amber-900">
            It composes, but it would not publish
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-amber-900">
            {walk.wouldNotPublish.map((issue, index) => (
              <li key={`${index}-${issue}`}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FormPreview({
  formId,
  formName,
  signature,
  preview,
  loadOpening,
}: {
  formId: string;
  formName: string;
  /** Changes with the form's version, so a saved layout drops cached walks. */
  signature: string;
  preview: FormPreviewPayload;
  /** The applicant's own read for one opening, as a server action. */
  loadOpening: (formId: string, openingId: string) => Promise<FormPreviewWalk>;
}) {
  const [active, setActive] = useState<string>(COMPOSITION_KEY);
  const [cache, setCache] = useState<{ signature: string; walks: Record<string, FormPreviewWalk> }>(
    { signature, walks: {} },
  );
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const walks = cache.signature === signature ? cache.walks : {};
  const opening = preview.tabs.find((tab) => tab.openingId === active);
  const walk: FormPreviewWalk | null =
    active === COMPOSITION_KEY ? preview.walk : walks[active] ?? null;

  async function openTab(tab: { openingId: string | null; label: string }) {
    setFailed(null);
    if (tab.openingId === null) {
      setActive(COMPOSITION_KEY);
      return;
    }
    const key = tab.openingId;
    if (walks[key]) {
      setActive(key);
      return;
    }
    setPending(true);
    try {
      const loaded = await loadOpening(formId, key);
      setCache({ signature, walks: { ...walks, [key]: loaded } });
      setActive(key);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The portal did not answer.");
    } finally {
      setPending(false);
    }
  }

  const total = walk?.form?.steps.reduce((count, step) => count + step.fields.length, 0) ?? 0;
  const steps = walk?.form?.steps.length ?? 0;

  return (
    <Card className="p-3">
      <CardHeader
        title="Applicant preview"
        meta={
          pending
            ? "Reading one opening…"
            : walk === null
              ? "Not read yet"
              : `${String(steps)} step${steps === 1 ? "" : "s"} · ${String(total)} question${total === 1 ? "" : "s"}`
        }
      />
      <div className="space-y-3 p-4 pt-3">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-brand-ink/50">
          <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-dark" aria-hidden />
          <span>
            The same projection the apply page is handed, in the applicant&apos;s order and
            with the same consent boxes. It is a picture, not a door: nothing here files an
            application, and unsaved questions on the canvas are not in it — Save first.
          </span>
        </p>

        <div
          role="tablist"
          aria-label={`Which application “${formName}” would be part of`}
          className="flex gap-1.5 overflow-x-auto pb-1"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const order = [
              { openingId: null, label: "Composition" },
              ...preview.tabs,
            ];
            const at = order.findIndex((tab) => (tab.openingId ?? COMPOSITION_KEY) === active);
            const next =
              event.key === "ArrowRight"
                ? order[(at + 1) % order.length]
                : order[(at - 1 + order.length) % order.length];
            if (next) {
              event.preventDefault();
              void openTab(next);
            }
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === COMPOSITION_KEY}
            onClick={() => void openTab({ openingId: null, label: "Composition" })}
            className={cn(
              "shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
              active === COMPOSITION_KEY
                ? "border-brand-gold bg-brand-sand text-brand-ink"
                : "border-brand-line bg-brand-cream/50 text-brand-ink/60 hover:border-brand-gold/60",
            )}
          >
            Composition
            <span className="ml-1.5 text-[10px] font-normal text-brand-ink/45">
              globals + “{formName}”
            </span>
          </button>
          {preview.tabs.map((tab) => (
            <button
              key={tab.openingId}
              type="button"
              role="tab"
              aria-selected={active === tab.openingId}
              onClick={() => void openTab(tab)}
              className={cn(
                "max-w-[220px] shrink-0 truncate rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                active === tab.openingId
                  ? "border-brand-gold bg-brand-sand text-brand-ink"
                  : "border-brand-line bg-brand-cream/50 text-brand-ink/60 hover:border-brand-gold/60",
              )}
              title={`What applicants to ${tab.label} are asked today`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {preview.isGlobal && (
          <p className="text-[10px] leading-relaxed text-brand-ink/40">
            A global form joins every application, so the composition tab is the whole of
            what it asks; the forms assigned to one opening sit after it there.
          </p>
        )}
        {!preview.isGlobal && preview.tabs.length === 0 && walk?.showsDraft && (
          <p className="text-[10px] leading-relaxed text-brand-ink/40">
            No opening asks this form yet, so this is the only walk it takes part in — the
            global set, and these questions beside it.
          </p>
        )}
        {!preview.isGlobal && preview.tabsTruncated && (
          <p className="text-[10px] leading-relaxed text-brand-ink/40">
            More openings ask this form than the {preview.tabs.length} listed.
          </p>
        )}

        {failed ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-900">
            {failed} Nothing was written.
          </p>
        ) : (
          <div role="tabpanel" aria-label={`${opening ? opening.label : "Composition"} walk`}>
            {pending ? (
              <p className="flex items-center gap-2 px-1 py-4 text-[11px] text-brand-ink/45">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Reading what {opening ? opening.label : "this opening"} asks today…
              </p>
            ) : walk === null ? (
              <div className="space-y-2 px-1 py-4 text-center">
                <p className="mx-auto max-w-prose text-[11px] leading-relaxed text-brand-ink/45">
                  The layout was saved, so the walks this panel read are dropped — it will not
                  show you one it can no longer vouch for.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void openTab(
                      opening ?? {
                        openingId: null,
                        label: "Composition",
                      },
                    )
                  }
                  className="rounded-xl border border-brand-gold bg-brand-sand px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-gold-dark"
                >
                  Read {opening ? opening.label : "this opening"} again
                </button>
              </div>
            ) : (
              <WalkBody walk={walk} />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
