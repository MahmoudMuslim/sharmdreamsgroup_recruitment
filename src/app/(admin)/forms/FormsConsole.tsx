"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Field, FormMessage, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
} from "@/modules/analytics/presentation/ui";
import type { FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import { draftIssues } from "@/modules/form-builder/domain/draftIssues";
import type { FieldType } from "@/modules/form-builder/domain/field-types";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import { isHireable, openingOptionLabel } from "@/modules/jobs/domain/hireable";
import {
  assignFormToJob,
  createForm,
  draftWithAI,
  listForms,
  publishForm,
  retireForm,
  saveFormLayout,
  saveFormMeta,
  unassignFormFromJob,
  type FormMutation,
  type FormsConsoleData,
  type FormSummary,
} from "@/modules/form-builder/application/formActions";
import { cn } from "@/lib/utils";
import { Canvas } from "./Canvas";
import { FieldPalette } from "./FieldPalette";
import { defaultsFor, Inspector } from "./Inspector";

/**
 * The `/forms` console (spec §6).
 *
 * The selected form lives in `?form=`: a link a recruiter pastes opens the same
 * form, and a server refresh — the live channel's, or the one every write
 * triggers — cannot quietly hand back a different one. The editor's rows are
 * client state because a drag must not cost a round trip; one Save commits the
 * whole set through `saveFormLayout`, at the version this screen was opened on.
 *
 * No `window.confirm`: switching forms with unsaved work, retiring a form and
 * removing a field all answer inline, because a native dialog blocks the tab in
 * the embedded browser the owner uses.
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

function signatureOf(selection: FormsConsoleData["selected"]): string {
  if (!selection) return "none";
  const { form } = selection;
  return `${form.id}|${form.version}|${form.status}|${form.archivedAt ?? ""}`;
}

const STATUS_TONES = {
  DRAFT: "neutral",
  PUBLISHED: "success",
} as const;

export function FormsConsole({ data }: { data: FormsConsoleData }) {
  const router = useRouter();

  // The list and the openings live on the server; a refresh re-reads both, and
  // mirroring them into state is what would need an effect to stay in step.
  const forms = data.forms;
  const jobs = data.jobs;
  const [selected, setSelected] = useState<FormsConsoleData["selected"]>(data.selected);
  const [fields, setFields] = useState<EditorField[]>(() =>
    data.selected ? toEditor(data.selected.fields) : [],
  );
  const [version, setVersion] = useState<number>(data.selected?.form.version ?? 0);
  const [meta, setMeta] = useState<MetaDraft>(() =>
    data.selected ? metaOf(data.selected.form) : { name: "", description: "", isGlobal: false },
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(() =>
    data.selected && data.selected.fields.length > 0 ? 0 : null,
  );
  // Which row the inspector should land on after a reload. State, not a ref:
  // the server's form is adopted during render, and a ref may not be read there.
  const [selectedKey, setSelectedKey] = useState<string | null>(
    data.selected?.fields[0]?.key ?? null,
  );

  const [layoutDirty, setLayoutDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [blockedId, setBlockedId] = useState<string | null>(null);
  const [retireArmed, setRetireArmed] = useState(false);
  const [assignJobId, setAssignJobId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<MetaDraft>({
    name: "",
    description: "",
    isGlobal: false,
  });
  const [draftBrief, setDraftBrief] = useState("");
  // The create panel owns its own failure text: with no form selected the centre
  // column has nowhere to print an error, and a failed create must not be silent.
  const [createError, setCreateError] = useState<string | null>(null);
  const [createIssues, setCreateIssues] = useState<string[]>([]);
  // Keyed by form so the outcome card follows the form it describes, and a later
  // navigation to a different form does not leave last run's sentence on screen.
  const [drafted, setDrafted] = useState<{
    formId: string;
    note: string;
    refusals: string[];
  } | null>(null);

  const selectedId = selected?.form.id ?? null;
  const current = selectedId ? forms.find((form) => form.id === selectedId) ?? null : null;
  const currentForm = current ?? selected?.form ?? null;
  const retired = Boolean(currentForm?.archivedAt);
  const canEdit = data.canWrite && currentForm !== null && !retired;
  const dirty = layoutDirty || metaDirty;

  const signature = signatureOf(data.selected);

  const adopt = useCallback((selection: FormsConsoleData["selected"], kept: string | null) => {
    const nextFields = selection ? toEditor(selection.fields) : [];
    setSelected(selection);
    setFields(nextFields);
    setVersion(selection?.form.version ?? 0);
    setMeta(
      selection ? metaOf(selection.form) : { name: "", description: "", isGlobal: false },
    );
    setLayoutDirty(false);
    setMetaDirty(false);
    setRetireArmed(false);
    setAssignJobId("");
    setBlockedId(null);
    setStale(false);
    const keptIndex = nextFields.findIndex((field) => field.key === kept);
    const index = nextFields.length === 0 ? null : keptIndex >= 0 ? keptIndex : 0;
    setSelectedIndex(index);
    setSelectedKey(index === null ? null : nextFields[index].key);
  }, []);

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
    else adopt(data.selected, selectedKey);
  }

  const drafts = useMemo(() => toDrafts(fields), [fields]);
  const liveIssues = useMemo(() => draftIssues(drafts), [drafts]);
  const activeField = selectedIndex === null ? null : fields[selectedIndex] ?? null;

  /* ------------------------------------------------------------------ writes */

  const apply = useCallback(
    async (
      write: () => Promise<FormMutation>,
      done: (result: FormMutation) => string,
    ): Promise<boolean> => {
      setError(null);
      setIssues([]);
      setNotice(null);
      setStale(false);
      setPending(true);
      try {
        const result = await write();
        if (!result.ok) {
          setError(result.error ?? NOT_ANSWERED);
          setIssues(result.issues ?? []);
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
      const next = await listForms(selectedId);
      adopt(next.selected, selectedKey);
      if (!next.available && next.note) setError(next.note);
      // The rail and the opening picker come from the page, so the reload has to
      // reach the server render too — the adopt above only replaces the canvas.
      router.refresh();
    } catch {
      setError(NOT_ANSWERED);
    } finally {
      setPending(false);
    }
  }, [adopt, router, selectedId, selectedKey]);

  const openForm = (id: string) => {
    if (pending) return;
    if (id === selectedId) return;
    if (dirty) {
      setBlockedId(id);
      setError(null);
      setIssues([]);
      setNotice("Save or discard your changes before opening another form.");
      return;
    }
    setError(null);
    setIssues([]);
    setNotice(null);
    setStale(false);
    router.push(`/forms?form=${encodeURIComponent(id)}`);
  };

  const discardAndOpen = () => {
    if (!blockedId) return;
    const id = blockedId;
    setLayoutDirty(false);
    setMetaDirty(false);
    setBlockedId(null);
    setError(null);
    setNotice(null);
    router.push(`/forms?form=${encodeURIComponent(id)}`);
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

  const addField = (type: FieldType, at: number) => {
    if (!canEdit) return;
    const draft: EditorField = {
      uid: newUid(),
      key: uniqueKey(type === "section_heading" ? "heading" : "field"),
      type,
      label: "",
      helpText: null,
      placeholder: null,
      required: false,
      config: defaultsFor(type),
      systemKey: null,
    };
    const next = [...fields];
    const index = Math.max(0, Math.min(at, next.length));
    next.splice(index, 0, draft);
    setFields(next);
    setSelectedIndex(index);
    setSelectedKey(draft.key);
    setLayoutDirty(true);
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
              config: defaultsFor(type),
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

  const saveLayout = async () => {
    if (!currentForm || !canEdit) return;
    const saved = await apply(
      () => saveFormLayout(currentForm.id, drafts, version),
      (result) =>
        `Saved ${fields.length} field${fields.length === 1 ? "" : "s"} as version ${
          result.version ?? version + 1
        }.`,
    );
    // A refused write leaves the editor dirty, or the next save would claim a
    // clean form and quietly drop the rows that never landed.
    if (saved) setLayoutDirty(false);
  };

  const saveMeta = async () => {
    if (!currentForm || !canEdit) return;
    const saved = await apply(
      () => saveFormMeta(currentForm.id, meta),
      (result) => `Saved the details of “${meta.name.trim()}” (version ${result.version ?? version}).`,
    );
    if (saved) setMetaDirty(false);
  };

  const publish = async () => {
    if (!currentForm || !canEdit) return;
    if (guardDirty("Save or discard your changes first — publish checks the layout the database holds.")) return;
    await apply(
      () => publishForm(currentForm.id),
      (result) => `“${currentForm.name}” is published as version ${result.version ?? version + 1}.`,
    );
  };

  const retire = async () => {
    if (!currentForm || !canEdit) return;
    if (guardDirty("Save or discard your changes before retiring this form.")) return;
    const done = await apply(
      () => retireForm(currentForm.id),
      () => `Retired “${currentForm.name}”. Applications already filed keep the questions they answered.`,
    );
    if (done) setRetireArmed(false);
  };

  const assign = async () => {
    if (!currentForm || !canEdit || !assignJobId) return;
    const job = jobs.find((entry) => entry.id === assignJobId);
    const done = await apply(
      () => assignFormToJob(assignJobId, currentForm.id, currentForm.assignedJobs.length),
      () => `Assigned “${currentForm.name}” to “${job?.title ?? "the opening"}”.`,
    );
    if (done) setAssignJobId("");
  };

  const unassign = async (jobId: string, title: string) => {
    if (!currentForm || !canEdit) return;
    await apply(
      () => unassignFormFromJob(jobId, currentForm.id),
      () => `Removed “${currentForm.name}” from “${title}”.`,
    );
  };

  const submitCreate = async () => {
    setError(null);
    setIssues([]);
    setNotice(null);
    setCreateError(null);
    setCreateIssues([]);
    setPending(true);
    try {
      const result = await createForm({
        name: createDraft.name,
        description: createDraft.description || null,
        isGlobal: createDraft.isGlobal,
      });
      if (!result.ok || !result.id) {
        setCreateError(result.error ?? NOT_ANSWERED);
        setCreateIssues(result.issues ?? []);
        return;
      }
      setShowCreate(false);
      setCreateDraft({ name: "", description: "", isGlobal: false });
      setNotice(`Created “${createDraft.name.trim()}”. Add its fields below.`);
      router.push(`/forms?form=${encodeURIComponent(result.id)}`);
    } catch {
      setCreateError(NOT_ANSWERED);
    } finally {
      setPending(false);
    }
  };

  /**
   * Draft a form's questions through the AI path.
   *
   * The form is created on the server; on success this opens it so the recruiter
   * lands on the fields that were just written. A partial write (the form exists
   * but its questions did not store) still opens it, because the error text on
   * the create panel would otherwise point at a form the panel cannot show.
   */
  const submitDraft = async () => {
    setError(null);
    setIssues([]);
    setNotice(null);
    setCreateError(null);
    setCreateIssues([]);
    setDrafted(null);
    setPending(true);
    try {
      const result = await draftWithAI({
        name: createDraft.name,
        description: createDraft.description || null,
        isGlobal: createDraft.isGlobal,
        prompt: draftBrief,
      });
      if (!result.id) {
        setCreateError(result.error ?? NOT_ANSWERED);
        setCreateIssues(result.issues ?? []);
        return;
      }
      const name = createDraft.name.trim();
      setShowCreate(false);
      setCreateDraft({ name: "", description: "", isGlobal: false });
      setDraftBrief("");
      setDrafted({
        formId: result.id,
        note: result.ok
          ? result.note ?? `Drafted “${name}”. Review it before publishing.`
          : result.error ?? NOT_ANSWERED,
        refusals: result.issues ?? [],
      });
      router.push(`/forms?form=${encodeURIComponent(result.id)}`);
    } catch {
      setCreateError(NOT_ANSWERED);
    } finally {
      setPending(false);
    }
  };

  /* ------------------------------------------------------------------ render */

  const assigned = currentForm?.assignedJobs ?? [];
  const assignable = jobs
    .filter((job) => isHireable(job.status))
    .filter((job) => !assigned.some((entry) => entry.id === job.id));
  const controlDisabled = pending || !canEdit;

  if (!data.available) {
    return (
      <Card className="p-6">
        <p className="font-display text-lg font-bold">The form tables are not on this database yet</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-ink/60">
          {data.note ??
            "Migration 044_application_forms.sql has not been applied. Nothing is read or written until it is."}
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)_330px]">
      {/* ------------------------------------------------------------ left rail */}
      <aside className="space-y-4">
        <Card>
          <CardHeader title="Forms" meta={`${forms.length}`} />
          <div className="max-h-80 space-y-1 overflow-y-auto p-2">
            {forms.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-brand-ink/45">
                No form has been written yet.
              </p>
            )}
            {forms.map((form) => {
              const isSelected = form.id === selectedId;
              return (
                <button
                  key={form.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => openForm(form.id)}
                  className={cn(
                    "w-full rounded-xl border px-2.5 py-2 text-left transition",
                    isSelected
                      ? "border-brand-ink bg-brand-ink text-brand-cream"
                      : "border-brand-line bg-white hover:border-brand-gold/60 hover:bg-brand-sand/50",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-xs font-bold">{form.name}</span>
                    <Badge
                      tone={form.archivedAt ? "danger" : STATUS_TONES[form.status]}
                      className={isSelected ? "shrink-0" : "shrink-0"}
                    >
                      {form.archivedAt ? "Retired" : form.status === "PUBLISHED" ? "Live" : "Draft"}
                    </Badge>
                  </span>
                  <span
                    className={cn(
                      "mt-1 block text-[10px] leading-relaxed",
                      isSelected ? "text-brand-cream/65" : "text-brand-ink/45",
                    )}
                  >
                    {form.isGlobal
                      ? "Asked on every role"
                      : `${form.assignedJobs.length} role${form.assignedJobs.length === 1 ? "" : "s"}`}
                    {" · "}
                    {form.fieldCount} field{form.fieldCount === 1 ? "" : "s"}
                    {" · v"}
                    {form.version}
                    {form.updatedAt ? ` · ${form.updatedAt.slice(0, 10)}` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          {data.canWrite && (
            <div className="border-t border-brand-line p-2">
              {showCreate ? (
                <div className="space-y-2">
                  <Field label="New form name" htmlFor="new-form-name" required>
                    <TextInput
                      id="new-form-name"
                      value={createDraft.name}
                      maxLength={120}
                      autoFocus
                      onChange={(event) =>
                        setCreateDraft({ ...createDraft, name: event.target.value })
                      }
                      className="text-xs"
                      placeholder="e.g. Hospitality application"
                    />
                  </Field>
                  <Field label="Description" htmlFor="new-form-description">
                    <TextArea
                      id="new-form-description"
                      value={createDraft.description}
                      rows={2}
                      maxLength={2000}
                      onChange={(event) =>
                        setCreateDraft({ ...createDraft, description: event.target.value })
                      }
                      className="text-xs"
                    />
                  </Field>
                  <label className="flex items-start gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={createDraft.isGlobal}
                      onChange={(event) =>
                        setCreateDraft({ ...createDraft, isGlobal: event.target.checked })
                      }
                      className="mt-0.5 h-3.5 w-3.5 accent-brand-gold-dark"
                    />
                    Ask it on every open role
                  </label>
                  <Field label="Draft the questions with AI" htmlFor="form-brief">
                    <TextArea
                      id="form-brief"
                      value={draftBrief}
                      rows={3}
                      maxLength={1500}
                      onChange={(event) => setDraftBrief(event.target.value)}
                      className="text-xs"
                      placeholder="The role and what a recruiter needs to judge — e.g. front-desk agent: hotel systems, shift availability, languages spoken"
                    />
                  </Field>
                  <p className="text-[10px] leading-relaxed text-brand-ink/40">
                    Name and description come from this panel. The AI writes only the questions,
                    keeps name, email, phone, CV, LinkedIn and About, and leaves the result as a
                    draft for you to edit and publish.
                  </p>
                  {createError && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] leading-relaxed text-rose-700">
                      {createError}
                    </p>
                  )}
                  {createIssues.length > 0 && (
                    <ul className="max-h-40 list-disc space-y-1 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 pl-5 text-[10px] leading-relaxed text-rose-700">
                      {createIssues.map((issue, index) => (
                        <li key={`${index}-${issue}`}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending || createDraft.name.trim().length < 2}
                      onClick={submitCreate}
                      className="flex-1"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        pending ||
                        createDraft.name.trim().length < 2 ||
                        draftBrief.trim().length < 20
                      }
                      onClick={submitDraft}
                      className="flex-1"
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Draft with AI
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setShowCreate(false);
                      setCreateError(null);
                      setCreateIssues([]);
                    }}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCreate(true);
                    setError(null);
                    setNotice(null);
                    setCreateError(null);
                    setCreateIssues([]);
                  }}
                  className="w-full"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New form
                </Button>
              )}
            </div>
          )}
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
        {!currentForm ? (
          <Card>
            <EmptyState
              title={forms.length === 0 ? "No form yet" : "No form selected"}
              description={
                forms.length === 0
                  ? data.canWrite
                    ? "Create the first form on the left, then drag the questions a candidate should answer."
                    : "A recruiter with the Manage jobs permission can write the first form."
                  : "Pick a form on the left to open its layout."
              }
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-extrabold tracking-tight">
                    {currentForm.name}
                  </h2>
                  <Badge tone={retired ? "danger" : STATUS_TONES[currentForm.status]}>
                    {retired ? "Retired" : currentForm.status === "PUBLISHED" ? "Published" : "Draft"}
                  </Badge>
                  <Badge tone={currentForm.isGlobal ? "gold" : "neutral"}>
                    {currentForm.isGlobal ? "Every role" : `${assigned.length} role${assigned.length === 1 ? "" : "s"}`}
                  </Badge>
                  <span className="text-[11px] tabular-nums text-brand-ink/45">
                    version {version} · {fields.length}/{LIMITS.fields_per_form} fields
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-ink/55">
                  {currentForm.description ||
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
            {drafted && currentForm.id === drafted.formId && (
              <Card className="border-brand-gold/60 bg-brand-sand/50 p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  AI draft
                </p>
                <p className="mt-1 text-xs leading-relaxed text-brand-ink/70">{drafted.note}</p>
                {drafted.refusals.length > 0 && (
                  <>
                    <p className="mt-2 text-[11px] font-bold text-brand-ink/70">
                      Offered but not added:
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-brand-ink/70">
                      {drafted.refusals.map((refusal, index) => (
                        <li key={`${index}-${refusal}`}>{refusal}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/50">
                  It is a draft: nothing is asked until you publish it, and it is not assigned to
                  an opening yet.
                </p>
              </Card>
            )}
            {issues.length > 0 && (
              <Card className="border-rose-200 bg-rose-50/70 p-4">
                <p className="text-xs font-bold text-rose-700">
                  {currentForm.status === "DRAFT" ? "Publish refused" : "The write was refused"} — every
                  reason is listed:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-800">
                  {issues.map((issue, index) => (
                    <li key={`${index}-${issue}`}>{issue}</li>
                  ))}
                </ul>
              </Card>
            )}
            {blockedId && (
              <Card className="border-brand-gold/60 bg-brand-sand/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs leading-relaxed text-brand-ink/70">
                    Unsaved changes in “{currentForm.name}”. Opening another form would discard them.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBlockedId(null);
                        setNotice(null);
                      }}
                    >
                      Keep editing
                    </Button>
                    <Button size="sm" onClick={discardAndOpen}>
                      Discard and open
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
                <p className="text-[10px] text-brand-ink/40">
                  {layoutDirty ? "Unsaved changes" : "Saved"}
                  {liveIssues.length > 0 && layoutDirty
                    ? ` · ${liveIssues.length} thing${liveIssues.length === 1 ? "" : "s"} to fix before Save`
                    : ""}
                </p>
              </div>
              <Canvas
                fields={fields}
                selectedIndex={selectedIndex}
                disabled={!canEdit || pending}
                onSelect={selectIndex}
                onAdd={(type, at) => addField(type, at)}
                onMove={moveField}
                onRemove={removeField}
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
                A drop lands before the row it is dropped on. The arrows are the
                keyboard path; a heading starts a new step on the candidate&apos;s form.
              </p>
            </Card>

            <Card>
              <CardHeader
                title="Where it is asked"
                meta={currentForm.isGlobal ? "Every open role, by definition" : `${assigned.length}/${LIMITS.forms_assigned_per_opening} roles`}
              />
              <div className="space-y-3 p-4">
                {currentForm.isGlobal ? (
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

                    {currentForm.status === "DRAFT" ? (
                      <p className="rounded-xl border border-brand-gold/40 bg-brand-sand/40 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/60">
                        Publish “{currentForm.name}” before assigning it — an opening
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
                        Retire “{currentForm.name}”? It leaves the list of forms that can be
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
          </>
        )}
      </section>

      {/* ------------------------------------------------------------- inspector */}
      <aside className="min-w-0 2xl:sticky 2xl:top-4 2xl:self-start">
        <Card className="p-4">
          {activeField ? (
            <Inspector
              key={activeField.uid}
              field={activeField}
              htmlId={activeField.uid}
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
          ) : currentForm ? (
            <div className="px-1 py-6 text-center">
              <p className="font-display text-sm font-bold">Nothing selected</p>
              <p className="mx-auto mt-1 max-w-[220px] text-[11px] leading-relaxed text-brand-ink/50">
                Pick a question in the canvas, or add one from the palette, and its
                settings appear here.
              </p>
            </div>
          ) : (
            <div className="px-1 py-6 text-center">
              <p className="font-display text-sm font-bold">Inspector</p>
              <p className="mx-auto mt-1 max-w-[220px] text-[11px] leading-relaxed text-brand-ink/50">
                Open a form to edit its questions.
              </p>
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}
