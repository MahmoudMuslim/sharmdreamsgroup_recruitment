"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Send,
  X,
} from "lucide-react";
import { Field, FormMessage, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import { Badge, Button, Card, CardHeader } from "@/modules/analytics/presentation/ui";
import { Kbd } from "@/modules/shell/presentation/AppBarPrimitives";
import { navBack } from "@/modules/shell/domain/navTransition";
import { PERSON_GROUP_LABELS } from "@/modules/candidates/domain/person-fields";
import type { FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import { draftIssues } from "@/modules/form-builder/domain/draftIssues";
import {
  stepTitle,
  stepsOfCanvas,
  type StepView,
} from "@/modules/form-builder/domain/editorSteps";
import type { FieldType } from "@/modules/form-builder/domain/field-types";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import { beside, widthOf, type FieldWidth } from "@/modules/form-builder/domain/rowLayout";
import { formUsageHref } from "@/modules/form-builder/domain/formBoard";
import { isHireable, openingOptionLabel } from "@/modules/jobs/domain/hireable";
import {
  assignFormToJob,
  formEditorData,
  publishForm,
  retireForm,
  saveFormLayout,
  saveFormMeta,
  unassignFormFromJob,
  type FormEditorProps,
  type FormMutation,
  type FormSummary,
} from "@/modules/form-builder/application/formActions";
import {
  previewFormOnOpening,
  type FormPreviewPayload,
} from "@/modules/form-builder/application/formPreview";
import { cn } from "@/lib/utils";
import { Canvas, type DragPayload } from "./Canvas";
import { FieldPalette, FIELD_TYPE_LABELS } from "./FieldPalette";
import { defaultsFor, Inspector } from "./Inspector";
import { FormPreview } from "./FormPreview";

/**
 * One form's own page (`/forms/[id]`, spec §6).
 *
 * The address is the form: a link a recruiter pastes opens the same layout, and a
 * server refresh — the live channel's, or the one every write triggers — cannot
 * quietly hand back a different one. The rows are client state because a drag must
 * not cost a round trip; one Save commits the whole set through `saveFormLayout`,
 * at the version this screen was opened on.
 *
 * No `window.confirm`: leaving with unsaved work, retiring a form and removing a
 * field all answer inline, because a native dialog blocks the tab in the embedded
 * browser the owner uses. Creating a form and drafting one by AI belong to the
 * board at `/forms`, which is where the list of every form lives.
 *
 * Above the canvas, the step strip prints the walk the applicant takes — the step
 * name, its questions, and the consent group each needs — built by
 * `stepsOfCanvas`, which splits with `splitIntoSteps`, the rule `resolveLayout`
 * composes the real wizard with, so a chip cannot promise a step the apply page
 * will not render. Ctrl/Cmd+S saves what is unsaved.
 */

type EditorField = FieldDraft & { uid: string };

type MetaDraft = { name: string; description: string; isGlobal: boolean };

const NOT_ANSWERED = "The portal did not answer, so nothing was written.";

function toDrafts(fields: readonly EditorField[]): FieldDraft[] {
  return fields.map((field) => ({
    key: field.key,
    type: field.type,
    label: field.label,
    helpText: field.helpText,
    placeholder: field.placeholder,
    required: field.required,
    config: field.config,
    systemKey: field.systemKey,
  }));
}

function newUid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Math.random().toString(36).slice(2)}`;
}

function toEditor(fields: readonly FieldDraft[]): EditorField[] {
  return fields.map((field) => ({ ...field, uid: newUid() }));
}

function metaOf(form: FormSummary): MetaDraft {
  return { name: form.name, description: form.description ?? "", isGlobal: form.isGlobal };
}

function signatureOf(form: FormSummary): string {
  return `${form.id}|${form.version}|${form.status}|${form.archivedAt ?? ""}`;
}

const STATUS_TONES = {
  DRAFT: "neutral",
  PUBLISHED: "success",
} as const;

export function FormEditor({
  data,
  preview,
}: {
  data: FormEditorProps;
  /** The applicant's walk as the page read it, before any drag on this screen. */
  preview: FormPreviewPayload;
}) {
  const router = useRouter();
  const { jobs } = data;

  // The openings live on the server, so a refresh re-reads them; mirroring them
  // into state is what would need an effect to stay in step.
  const [form, setForm] = useState<FormSummary>(data.form);
  const [fields, setFields] = useState<EditorField[]>(() => toEditor(data.fields));
  const [version, setVersion] = useState<number>(data.form.version);
  const [meta, setMeta] = useState<MetaDraft>(() => metaOf(data.form));
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    data.fields.length > 0 ? 0 : null,
  );
  // Which row the inspector should land on after a reload. State, not a ref:
  // the server's form is adopted during render, and a ref may not be read there.
  const [selectedKey, setSelectedKey] = useState<string | null>(data.fields[0]?.key ?? null);

  const [layoutDirty, setLayoutDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  /** Which control the list of refusals belongs to, so the header cannot blame Publish for a Save. */
  const [refused, setRefused] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [leaving, setLeaving] = useState(false);
  const [retireArmed, setRetireArmed] = useState(false);
  const [assignJobId, setAssignJobId] = useState("");

  const retired = Boolean(form.archivedAt);
  const canEdit = data.canWrite && !retired;
  const dirty = layoutDirty || metaDirty;

  const signature = signatureOf(data.form);

  const adopt = useCallback(
    (next: FormSummary, nextRows: readonly FieldDraft[], kept: string | null) => {
      const nextFields = toEditor(nextRows);
      setForm(next);
      setFields(nextFields);
      setVersion(next.version);
      setMeta(metaOf(next));
      setLayoutDirty(false);
      setMetaDirty(false);
      setRetireArmed(false);
      setAssignJobId("");
      setStale(false);
      const keptIndex = nextFields.findIndex((field) => field.key === kept);
      const index = nextFields.length === 0 ? null : keptIndex >= 0 ? keptIndex : 0;
      setSelectedIndex(index);
      setSelectedKey(index === null ? null : nextFields[index].key);
    },
    [],
  );

  /*
   * Adopt the server's form when its signature moves — but during render, not in
   * an effect, so the canvas never paints one form's fields under another's
   * header. Dirty work is the exception: a refresh from another tab must not
   * replace unsaved rows, so the editor stays and a banner offers the reload.
   */
  const [seenSignature, setSeenSignature] = useState(signature);
  if (seenSignature !== signature) {
    setSeenSignature(signature);
    if (dirty) setStale(true);
    else adopt(data.form, data.fields, selectedKey);
  }

  const drafts = useMemo(() => toDrafts(fields), [fields]);
  const liveIssues = useMemo(() => draftIssues(drafts), [drafts]);
  const activeField = selectedIndex === null ? null : fields[selectedIndex] ?? null;

  const steps = useMemo(() => stepsOfCanvas(fields, form.name), [fields, form.name]);
  const activeStep = selectedIndex === null
    ? -1
    : steps.findIndex((step) => selectedIndex >= step.rowStart && selectedIndex <= step.rowEnd);
  const groupsOnCanvas = steps.some((step) => step.groups.length > 0);

  /* ------------------------------------------------------------------ writes */

  /**
   * One write, its refusal list, and the sentence it prints when it lands.
   *
   * `label` names the control that was pressed, because the same list of refusals
   * means something different under "Publish was refused" and "Save layout was
   * refused" — a required field refused at Save is not a publish the recruiter
   * ever asked for.
   */
  const apply = useCallback(
    async (
      write: () => Promise<FormMutation>,
      label: string,
      done: (result: FormMutation) => string,
    ): Promise<boolean> => {
      setError(null);
      setIssues([]);
      setRefused(null);
      setNotice(null);
      setStale(false);
      setPending(true);
      try {
        const result = await write();
        if (!result.ok) {
          setError(result.error ?? NOT_ANSWERED);
          setIssues(result.issues ?? []);
          setRefused(label);
          return false;
        }
        if (typeof result.version === "number") setVersion(result.version);
        setNotice(done(result));
        router.refresh();
        return true;
      } catch {
        setError(NOT_ANSWERED);
        return false;
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  const reloadFromServer = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const next = await formEditorData(form.id);
      if (!next.available && next.note) {
        setError(next.note);
      } else if (next.form) {
        adopt(next.form, next.fields, selectedKey);
      } else {
        setError("That form is not on this database, so nothing was re-read.");
      }
      // The openings come from the page's own read, so the reload has to reach the
      // server render too — the adopt above only replaces the layout.
      router.refresh();
    } catch {
      setError(NOT_ANSWERED);
    } finally {
      setPending(false);
    }
  }, [adopt, form.id, router, selectedKey]);

  /* --------------------------------------------------------------- leaving */

  /**
   * The one door out of this page is the back link, and a dirty layout has to be
   * named before it is walked through. The Link is cancelled rather than
   * answered by a native dialog, so the choice — keep, save, or throw away — is
   * on the screen the recruiter is already looking at.
   */
  const leave = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (!dirty) return;
    event.preventDefault();
    setError(null);
    setIssues([]);
    setNotice(null);
    setStale(false);
    setLeaving(true);
  };

  const discardAndLeave = () => {
    setLayoutDirty(false);
    setMetaDirty(false);
    setLeaving(false);
    router.push("/forms");
  };

  /** Both writes land before the page changes, and a refusal keeps the editor open. */
  const saveAndLeave = async () => {
    if (layoutDirty && !(await saveLayout())) return;
    if (metaDirty && !(await saveMeta())) return;
    setLeaving(false);
    router.push("/forms");
  };

  /* ------------------------------------------------------------- the canvas */

  const uniqueKey = (base: string): string => {
    const used = new Set(fields.map((field) => field.key));
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  };

  const selectIndex = (index: number) => {
    setSelectedIndex(index);
    setSelectedKey(fields[index]?.key ?? null);
  };

  /** A chip picks its heading and brings the row it names into view. */
  const jumpToStep = (step: StepView) => {
    if (step.focusIndex === null) return;
    selectIndex(step.focusIndex);
    document
      .getElementById(`form-field-row-${step.focusIndex}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const draftFor = (type: FieldType, width: FieldWidth = "full"): EditorField => ({
    uid: newUid(),
    key: uniqueKey(type === "section_heading" ? "heading" : "field"),
    type,
    label: "",
    helpText: null,
    placeholder: null,
    required: false,
    config: { ...defaultsFor(type), width },
    systemKey: null,
  });

  const addField = (type: FieldType, at: number) => {
    if (!canEdit) return;
    const draft = draftFor(type);
    const next = [...fields];
    const index = Math.max(0, Math.min(at, next.length));
    next.splice(index, 0, draft);
    setFields(next);
    setSelectedIndex(index);
    setSelectedKey(draft.key);
    setLayoutDirty(true);
  };

  /**
   * The third drop rule: land on a card's right edge and the two questions are
   * asked in one row.
   *
   * That is a reorder as well as a resize — auto-placement packs the list in
   * order, so the dragged field has to sit directly after its partner for the
   * pairing the author aimed at to be the pairing they get. The widths, the
   * refusal and the sentence are the layout module's, so the console cannot get
   * the noun wrong: a live proof dropped a file on a URL field and the console
   * blamed the URL field for taking a whole row.
   */
  const placeBeside = (payload: DragPayload, target: number) => {
    if (!canEdit) return;
    const targetField = fields[target];
    const draggedType = payload.kind === "new" ? payload.type : fields[payload.index]?.type;
    if (!targetField || !draggedType) return;
    // A card dropped on its own edge asks a field to share its row with itself.
    if (payload.kind === "move" && payload.index === target) return;

    const pair = beside({
      dragged: {
        type: draggedType,
        label:
          payload.kind === "new"
            ? FIELD_TYPE_LABELS[payload.type]
            : fields[payload.index].label || fields[payload.index].key,
      },
      target: {
        type: targetField.type,
        label: targetField.label || targetField.key,
        width: widthOf(targetField),
      },
    });
    if (!pair.ok) {
      setError(pair.error);
      return;
    }

    const next = [...fields];
    let draggedIndex: number;
    let targetIndex: number;
    if (payload.kind === "move") {
      const [moved] = next.splice(payload.index, 1);
      targetIndex = payload.index < target ? target - 1 : target;
      draggedIndex = targetIndex + 1;
      next.splice(draggedIndex, 0, moved);
    } else {
      draggedIndex = target + 1;
      targetIndex = target;
      next.splice(draggedIndex, 0, draftFor(payload.type, pair.dragged));
    }
    next[targetIndex] = {
      ...next[targetIndex],
      config: { ...next[targetIndex].config, width: pair.target },
    };
    next[draggedIndex] = {
      ...next[draggedIndex],
      config: { ...next[draggedIndex].config, width: pair.dragged },
    };

    setFields(next);
    setSelectedIndex(draggedIndex);
    setSelectedKey(next[draggedIndex].key);
    setLayoutDirty(true);
    setError(null);
    setNotice(pair.notice);
  };

  const updateField = (index: number, patch: Partial<FieldDraft>) => {
    setFields((previous) =>
      previous.map((field, row) => (row === index ? { ...field, ...patch } : field)),
    );
    if (patch.key !== undefined) setSelectedKey(patch.key);
    setLayoutDirty(true);
  };

  const changeType = (index: number, type: FieldType) => {
    setFields((previous) =>
      previous.map((field, row) =>
        row === index
          ? {
              ...field,
              type,
              // The width survives a type change the layout can still honour —
              // a half question that becomes another half question — and a type
              // that takes the row resets it, because `widthOf` says so.
              config: { ...defaultsFor(type), width: widthOf({ ...field, type }) },
              systemKey: null,
              ...(type === "section_heading" ? { required: false } : {}),
            }
          : field,
      ),
    );
    setLayoutDirty(true);
  };

  const removeField = (index: number) => {
    const next = fields.filter((_, row) => row !== index);
    setFields(next);
    const landing = next.length === 0 ? null : Math.min(index, next.length - 1);
    setSelectedIndex(landing);
    setSelectedKey(landing === null ? null : next[landing].key);
    setLayoutDirty(true);
  };

  const moveField = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    const target = Math.max(0, Math.min(from < to ? to - 1 : to, next.length));
    next.splice(target, 0, moved);
    setFields(next);
    setSelectedIndex(target);
    setSelectedKey(moved.key);
    setLayoutDirty(true);
  };

  /* ------------------------------------------------------------------ guards */

  const guardDirty = (sentence: string): boolean => {
    if (!dirty) return false;
    setError(null);
    setIssues([]);
    setNotice(sentence);
    return true;
  };

  const saveLayout = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return false;
    const saved = await apply(
      () => saveFormLayout(form.id, drafts, version),
      "Save layout",
      (result) =>
        `Saved ${fields.length} field${fields.length === 1 ? "" : "s"} as version ${
          result.version ?? version + 1
        }.`,
    );
    // A refused write leaves the editor dirty, or the next save would claim a
    // clean form and quietly drop the rows that never landed.
    if (saved) setLayoutDirty(false);
    return saved;
  }, [apply, canEdit, drafts, fields.length, form.id, version]);

  const saveMeta = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return false;
    const saved = await apply(
      () => saveFormMeta(form.id, meta),
      "Save details",
      (result) => `Saved the details of “${meta.name.trim()}” (version ${result.version ?? version}).`,
    );
    if (saved) setMetaDirty(false);
    return saved;
  }, [apply, canEdit, form.id, meta, version]);

  /**
   * Ctrl/Cmd+S saves what is unsaved — the layout, then the details.
   *
   * It answers with a sentence when there is nothing to save, because the
   * keystroke is swallowed either way and a silent one reads as a broken button.
   */
  const saveEverything = useCallback(async () => {
    if (pending) return;
    if (!canEdit) {
      setNotice(
        retired
          ? "This form is retired, so nothing can be saved."
          : "You can read every form here; saving one needs the Manage jobs permission.",
      );
      return;
    }
    if (!layoutDirty && !metaDirty) {
      setNotice("Nothing to save — this form is as the database holds it.");
      return;
    }
    if (layoutDirty && !(await saveLayout())) return;
    if (metaDirty) await saveMeta();
  }, [canEdit, layoutDirty, metaDirty, pending, retired, saveLayout, saveMeta]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void saveEverything();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveEverything]);

  const publish = async () => {
    if (!canEdit) return;
    if (guardDirty("Save or discard your changes first — publish checks the layout the database holds.")) return;
    await apply(
      () => publishForm(form.id),
      "Publish",
      (result) => `“${form.name}” is published as version ${result.version ?? version + 1}.`,
    );
  };

  const retire = async () => {
    if (!canEdit) return;
    if (guardDirty("Save or discard your changes before retiring this form.")) return;
    const done = await apply(
      () => retireForm(form.id),
      "Retire",
      () => `Retired “${form.name}”. Applications already filed keep the questions they answered.`,
    );
    if (done) setRetireArmed(false);
  };

  const assign = async () => {
    if (!canEdit || !assignJobId) return;
    const job = jobs.find((entry) => entry.id === assignJobId);
    const done = await apply(
      () => assignFormToJob(assignJobId, form.id, form.assignedJobs.length),
      "Assign",
      () => `Assigned “${form.name}” to “${job?.title ?? "the opening"}”.`,
    );
    if (done) setAssignJobId("");
  };

  const unassign = async (jobId: string, title: string) => {
    if (!canEdit) return;
    await apply(
      () => unassignFormFromJob(jobId, form.id),
      "Remove from the opening",
      () => `Removed “${form.name}” from “${title}”.`,
    );
  };

  /* ------------------------------------------------------------------ render */

  const assigned = form.assignedJobs;
  const assignable = jobs
    .filter((job) => isHireable(job.status))
    .filter((job) => !assigned.some((entry) => entry.id === job.id));
  const controlDisabled = pending || !canEdit;

  return (
    <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)_330px]">
      {/* ------------------------------------------------------------ left rail */}
      <aside className="space-y-4">
        <Card className="p-3">
          <Link
            href="/forms"
            transitionTypes={navBack}
            onClick={leave}
            className="flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold transition hover:border-brand-gold/60 hover:bg-brand-sand/50"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            All forms
          </Link>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
            <Badge tone={retired ? "danger" : STATUS_TONES[form.status]}>
              {retired ? "Retired" : form.status === "PUBLISHED" ? "Published" : "Draft"}
            </Badge>
            <Badge tone={form.isGlobal ? "gold" : "neutral"}>
              {form.isGlobal ? "Every role" : "Assigned by hand"}
            </Badge>
          </p>
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-brand-ink/45">
            {form.isGlobal
              ? "A global form joins every application, before the forms assigned to the role, and cannot be assigned by hand."
              : `This form is asked on ${assigned.length} opening${assigned.length === 1 ? "" : "s"}. The board at All forms is where it is created, retired and read as a list.`}
          </p>
          <Link
            href={formUsageHref(form.id)}
            title="Every application filed against this form, as a report in CSV, Excel or PDF"
            className="mt-2 flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold transition hover:border-brand-gold/60 hover:bg-brand-sand/50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Its applications
            {data.usage && (
              <span className="ml-auto rounded-full bg-brand-sand px-2 py-0.5 text-[10px] tabular-nums text-brand-ink/60">
                {data.usage.byForm[form.id]?.applications ?? 0}
              </span>
            )}
          </Link>
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-brand-ink/40">
            {data.usage
              ? data.usage.basis === "view"
                ? "That figure comes from the usage view (migration 045): every application whose filed snapshot named this form."
                : data.usage.capped
                  ? `That figure is counted over the newest ${data.usage.read.toLocaleString()} applications only, so it is a floor, not a total, until the usage view (migration 045) is applied.`
                  : `That figure is counted over all ${data.usage.read.toLocaleString()} applications read; the usage view (migration 045) is not on this database yet.`
              : data.usageNote}
          </p>
        </Card>

        <Card className="p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            Field palette
          </p>
          <FieldPalette
            disabled={!canEdit || pending}
            onAdd={(type) => addField(type, fields.length)}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-brand-ink/40">
            Click to append, or drag a type into the canvas. Section headings divide
            the form into steps.
          </p>
        </Card>
      </aside>

      {/* --------------------------------------------------------------- centre */}
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-extrabold tracking-tight">
                {form.name}
              </h2>
              <Badge tone={retired ? "danger" : STATUS_TONES[form.status]}>
                {retired ? "Retired" : form.status === "PUBLISHED" ? "Published" : "Draft"}
              </Badge>
              <Badge tone={form.isGlobal ? "gold" : "neutral"}>
                {form.isGlobal ? "Every role" : `${assigned.length} role${assigned.length === 1 ? "" : "s"}`}
              </Badge>
              <span className="text-[11px] tabular-nums text-brand-ink/45">
                version {version} · {fields.length}/{LIMITS.fields_per_form} fields
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-ink/55">
              {form.description ||
                "No description yet. The description is for recruiters; a candidate never sees it."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={reloadFromServer}
              title="Reload this form from the database, discarding local edits"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
              Reload
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={controlDisabled || !layoutDirty}
              onClick={saveLayout}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              Save layout
            </Button>
            <Button size="sm" disabled={controlDisabled || retired} onClick={publish}>
              <Send className="h-3.5 w-3.5" aria-hidden />
              Publish
            </Button>
          </div>
        </div>

        <FormMessage error={error} success={notice} notice={stale ? "Someone changed this form on the server while you were editing. Reload before saving, or save and read the conflict if you lose the race." : null} />
        {issues.length > 0 && (
          <Card className="border-rose-200 bg-rose-50/70 p-4">
            <p className="text-xs font-bold text-rose-700">
              {refused ?? "The write"} was refused — every reason is listed:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-800">
              {issues.map((issue, index) => (
                <li key={`${index}-${issue}`}>{issue}</li>
              ))}
            </ul>
          </Card>
        )}
        {leaving && (
          <Card className="border-brand-gold/60 bg-brand-sand/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs leading-relaxed text-brand-ink/70">
                Unsaved changes in “{form.name}”. Going back to the board would discard them.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLeaving(false);
                    setNotice(null);
                  }}
                >
                  Keep editing
                </Button>
                <Button size="sm" disabled={pending} onClick={saveAndLeave}>
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Save and leave
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={discardAndLeave}>
                  Discard and leave
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name" htmlFor="form-name" required>
              <TextInput
                id="form-name"
                value={meta.name}
                disabled={!canEdit || pending}
                maxLength={120}
                onChange={(event) => {
                  setMeta({ ...meta, name: event.target.value });
                  setMetaDirty(true);
                }}
              />
            </Field>
            <div className="flex flex-col justify-end gap-2 text-xs">
              <label className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2">
                <input
                  type="checkbox"
                  checked={meta.isGlobal}
                  disabled={!canEdit || pending}
                  onChange={(event) => {
                    setMeta({ ...meta, isGlobal: event.target.checked });
                    setMetaDirty(true);
                  }}
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-gold-dark"
                />
                <span>
                  <span className="font-bold">Asked on every open role</span>
                  <span className="block text-[10px] leading-relaxed text-brand-ink/45">
                    A global form joins every application, before any form assigned
                    to the opening.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <Field label="Description for recruiters" htmlFor="form-description" className="mt-3">
            <TextArea
              id="form-description"
              value={meta.description}
              disabled={!canEdit || pending}
              rows={2}
              maxLength={2000}
              onChange={(event) => {
                setMeta({ ...meta, description: event.target.value });
                setMetaDirty(true);
              }}
              className="text-xs"
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] leading-relaxed text-brand-ink/40">
              The name and description are for staff. They never appear on the
              candidate&apos;s form.
            </p>
            <Button size="sm" disabled={!canEdit || pending || !metaDirty} onClick={saveMeta}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              Save details
            </Button>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
              Layout
            </p>
            <p className="flex flex-wrap items-center gap-2 text-[10px] text-brand-ink/40">
              <span>
                {layoutDirty ? "Unsaved changes" : "Saved"}
                {liveIssues.length > 0 && layoutDirty
                  ? ` · ${liveIssues.length} thing${liveIssues.length === 1 ? "" : "s"} to fix before Save`
                  : ""}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Ctrl/⌘ + S</Kbd>
                <span>saves what is unsaved</span>
              </span>
            </p>
          </div>

          {steps.length > 0 && (
            <>
              <ol className="mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="The steps the applicant walks, in order">
                {steps.map((step, index) => (
                  <li key={`step-${index}`} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => jumpToStep(step)}
                      disabled={step.focusIndex === null}
                      title={stepTitle(step, index)}
                      aria-current={index === activeStep ? "true" : undefined}
                      className={cn(
                        "flex w-[190px] flex-col gap-1 rounded-xl border px-2.5 py-1.5 text-left transition",
                        step.headed
                          ? "border-brand-line bg-brand-cream/50 hover:border-brand-gold/60"
                          : "border-amber-300 bg-amber-50/70 hover:border-amber-400",
                        index === activeStep && "ring-2 ring-brand-gold/70 ring-offset-1",
                        step.focusIndex === null && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="text-[10px] font-bold tabular-nums text-brand-ink/35">
                          {index + 1}
                        </span>
                        <span className="min-w-0 truncate text-xs font-bold">{step.name}</span>
                      </span>
                      <span
                        className={cn(
                          "text-[10px]",
                          step.questionCount === 0 ? "text-amber-700" : "text-brand-ink/45",
                        )}
                      >
                        {step.questionCount === 0
                          ? "No questions yet"
                          : `${step.questionCount} question${step.questionCount === 1 ? "" : "s"}`}
                        {step.requiredCount > 0 && ` · ${step.requiredCount} required`}
                      </span>
                      {step.groups.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {step.groups.map((group) => (
                            <span
                              key={group}
                              className="rounded bg-brand-gold/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-gold-dark"
                            >
                              {PERSON_GROUP_LABELS[group]}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
              {groupsOnCanvas && (
                <p className="mb-2 px-1 text-[10px] leading-relaxed text-brand-ink/40">
                  A gold group is a consent box the applicant ticks before the step is
                  accepted. It is asked once, on the first step that needs it, and the
                  walk joins every global form before this one — so an earlier form may
                  ask it first.
                </p>
              )}
            </>
          )}

          <Canvas
            fields={fields}
            selectedIndex={selectedIndex}
            disabled={!canEdit || pending}
            onSelect={selectIndex}
            onAdd={(type, at) => addField(type, at)}
            onMove={moveField}
            onRemove={removeField}
            onPlaceBeside={placeBeside}
          />
          {layoutDirty && liveIssues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2 pl-7 text-[11px] leading-relaxed text-amber-900">
              {liveIssues.slice(0, 8).map((issue, index) => (
                <li key={`${index}-${issue.fieldKey}-${issue.message}`}>{issue.message}</li>
              ))}
              {liveIssues.length > 8 && (
                <li>{liveIssues.length - 8} more — Save lists them all.</li>
              )}
            </ul>
          )}
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-brand-ink/40">
            A drop on a row lands before it; the strip at the bottom appends, and
            the arrows are the keyboard path. Drop on a row&apos;s gold right edge
            to ask the two fields in one row — the Width control in the inspector
            is the keyboard path for that. A heading, a long answer or a file
            always takes the whole row.
          </p>
        </Card>

        <FormPreview
          formId={data.form.id}
          formName={data.form.name}
          signature={signature}
          preview={preview}
          loadOpening={previewFormOnOpening}
        />

        <Card>
          <CardHeader
            title="Where it is asked"
            meta={form.isGlobal ? "Every open role, by definition" : `${assigned.length}/${LIMITS.forms_assigned_per_opening} roles`}
          />
          <div className="space-y-3 p-4">
            {form.isGlobal ? (
              <p className="text-xs leading-relaxed text-brand-ink/55">
                This form is global: it joins every open role before the forms
                assigned to that role, and it cannot be assigned by hand.
              </p>
            ) : (
              <>
                {assigned.length === 0 ? (
                  <p className="text-xs leading-relaxed text-brand-ink/55">
                    Not assigned to an opening yet. A published form can be assigned
                    below; a draft has to be published first.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {assigned.map((job) => (
                      <li
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line bg-brand-cream/40 px-3 py-2"
                      >
                        <span className="text-xs font-semibold">
                          {job.title}
                          <span className="ml-1.5 text-[10px] font-normal text-brand-ink/45">
                            {job.status.toLowerCase()}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={!canEdit || pending}
                          onClick={() => unassign(job.id, job.title)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-40"
                        >
                          <X className="h-3 w-3" aria-hidden />
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {form.status === "DRAFT" ? (
                  <p className="rounded-xl border border-brand-gold/40 bg-brand-sand/40 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/60">
                    Publish “{form.name}” before assigning it — an opening
                    must never ask a form that has not passed the identity check.
                  </p>
                ) : retired ? (
                  <p className="text-[11px] text-brand-ink/45">
                    A retired form keeps the assignments it had; it can no longer be
                    edited or newly assigned.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      aria-label="Opening to assign this form to"
                      value={assignJobId}
                      disabled={!canEdit || pending || assignable.length === 0}
                      onChange={(event) => setAssignJobId(event.target.value)}
                      className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-xs focus:border-brand-gold focus:bg-white focus:outline-none disabled:opacity-60"
                    >
                      <option value="">
                        {assignable.length === 0
                          ? jobs.length === 0
                            ? "No openings exist yet"
                            : "No open role is left to assign"
                          : "Choose an opening…"}
                      </option>
                      {assignable.map((job) => (
                        <option key={job.id} value={job.id}>
                          {openingOptionLabel(job.title, job.status)}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!canEdit || pending || !assignJobId}
                      onClick={assign}
                      className="shrink-0"
                    >
                      Assign
                    </Button>
                  </div>
                )}
              </>
            )}

            <div className="border-t border-brand-line pt-3">
              {!data.canWrite ? (
                <p className="text-[11px] leading-relaxed text-brand-ink/50">
                  You can read every form here. Writing one needs the Manage jobs
                  permission.
                </p>
              ) : retired ? (
                <p className="text-[11px] leading-relaxed text-brand-ink/50">
                  This form is retired. Applications already filed keep the questions
                  they answered; the form cannot be edited, published or assigned again.
                </p>
              ) : retireArmed ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-rose-800">
                    Retire “{form.name}”? It leaves the list of forms that can be
                    assigned, and applications already filed keep their answers.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setRetireArmed(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={retire}
                      className="bg-rose-700 text-white hover:bg-rose-800"
                    >
                      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                      Yes, retire
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={controlDisabled}
                  onClick={() => {
                    setError(null);
                    setIssues([]);
                    setNotice(null);
                    setRetireArmed(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                  Retire this form
                </button>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------- inspector */}
      <aside className="min-w-0 2xl:sticky 2xl:top-4 2xl:self-start">
        <Card className="p-4">
          {activeField ? (
            <Inspector
              key={activeField.uid}
              field={activeField}
              disabled={!canEdit || pending}
              onChange={(patch) => {
                if (selectedIndex !== null) updateField(selectedIndex, patch);
              }}
              onTypeChange={(type) => {
                if (selectedIndex !== null) changeType(selectedIndex, type);
              }}
              onRemove={() => {
                if (selectedIndex !== null) removeField(selectedIndex);
              }}
            />
          ) : (
            <div className="px-1 py-6 text-center">
              <p className="font-display text-sm font-bold">Nothing selected</p>
              <p className="mx-auto mt-1 max-w-[220px] text-[11px] leading-relaxed text-brand-ink/50">
                Pick a question in the canvas, or add one from the palette, and its
                settings appear here.
              </p>
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}
