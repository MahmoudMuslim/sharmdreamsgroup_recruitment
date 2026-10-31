"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@/types";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  MAX_DRAFTS_PER_RUN,
  type Difficulty,
  type GeneratedQuestion,
} from "@/modules/assessment/domain/aiAuthoring";
import {
  TYPE_HINTS,
  TYPE_LABELS,
  DraftCard,
} from "./QuestionEditorDrawer";
import {
  createDraftedSuite,
  draftSuite,
  getOpeningsForAuthoring,
  type AuthoringOpeningOption,
} from "./suite-authoring-actions";
import type { TemplateOptions } from "./AssessmentGrid";

/**
 * Suite authoring.
 *
 * Turns a job opening into a test: the model writes the shell and the questions,
 * the desk shows both, and the suite is only created when the recruiter clicks.
 * A model cannot issue a link, so the worst a bad run can do is waste a request.
 *
 * The drafted questions arrive read-only on purpose. Editing them here would mean
 * a second copy of the question form, and the desk that already edits questions —
 * the suite's own Questions drawer — applies the same rules to a created suite as
 * to a hand-written one.
 */

interface Shell {
  name: string;
  description: string;
  role_family: string;
  time_limit_minutes: string;
  block_copy_paste: boolean;
}

export function SuiteAuthoringDrawer({
  open,
  onClose,
  options,
  defaultDurationMinutes,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  options: TemplateOptions;
  defaultDurationMinutes: number;
  /** Refreshes the grid once a suite exists, so the new card is there to open. */
  onCreated: () => void;
}) {
  const [openingId, setOpeningId] = useState("");
  const [openings, setOpenings] = useState<AuthoringOpeningOption[]>([]);
  const [openingsNote, setOpeningsNote] = useState<string | null>(null);
  const [openingsError, setOpeningsError] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [types, setTypes] = useState<QuestionType[]>([
    "MULTIPLE_CHOICE",
    "CASE_STUDY",
    "EXCEL_MODEL",
  ]);
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState<Difficulty>("MID");
  const [pointsEach, setPointsEach] = useState("10");
  const [notes, setNotes] = useState("");
  const [companyId, setCompanyId] = useState(options.companies[0]?.id ?? "");

  const [shell, setShell] = useState<Shell | null>(null);
  const [cautions, setCautions] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<GeneratedQuestion[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [dropped, setDropped] = useState<string[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drafting" | "creating" | null>(null);

  // Read when the desk opens, not when the page loads: a role posted since the
  // page was rendered is a role a recruiter can write a test for today.
  useEffect(() => {
    let active = true;
    void getOpeningsForAuthoring().then((read) => {
      if (!active) return;
      setOpenings(read.openings);
      setOpeningsNote(read.note);
      setOpeningsError(read.error);
    });
    return () => {
      active = false;
    };
  }, []);

  function toggleType(type: QuestionType) {
    setTypes((current) =>
      current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]
    );
  }

  function patchShell(next: Partial<Shell>) {
    setShell((current) => (current ? { ...current, ...next } : current));
    setError(null);
    setSuccess(null);
  }

  const kept = drafts.filter((_, index) => !excluded.has(index));

  // Where the suite is filed when the model names a family that is not on file.
  // On a re-draft it is the family already showing on the desk, so a recruiter who
  // picked one does not lose it to the next run.
  const fallbackFamily = shell?.role_family || options.roleFamilies[0]?.key || "GENERAL";

  async function generate() {
    setBusy("drafting");
    setError(null);
    setSuccess(null);
    try {
      const result = await draftSuite({
        openingId,
        topic,
        types,
        count: Number(count),
        difficulty,
        pointsEach: Number(pointsEach),
        notes,
        roleFamily: fallbackFamily,
      });
      if (!result.ok || !result.suite) {
        setShell(null);
        setCautions([]);
        setDrafts([]);
        setModel(null);
        setError(result.error ?? "Nothing was drafted.");
        return;
      }
      setShell({
        name: result.suite.name,
        description: result.suite.description,
        role_family: result.suite.role_family || fallbackFamily,
        time_limit_minutes: String(result.suite.time_limit_minutes),
        block_copy_paste: result.suite.block_copy_paste,
      });
      setCautions(result.suite.cautions);
      setDrafts(result.drafts ?? []);
      setExcluded(new Set());
      setDropped(result.dropped ?? []);
      setModel(result.model ?? null);
      setSource(result.opening ?? null);
      setSummary(result.note ?? null);
    } catch {
      setError("The model could not be reached. Try again, or build the suite by hand.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!shell) return;
    setBusy("creating");
    setError(null);
    setSuccess(null);
    try {
      const result = await createDraftedSuite({
        companyId,
        name: shell.name,
        description: shell.description,
        roleFamily: shell.role_family,
        timeLimitMinutes: Number(shell.time_limit_minutes),
        blockCopyPaste: shell.block_copy_paste,
        drafts: kept,
      });
      if (!result.ok) {
        setError(result.error ?? "The suite could not be created.");
        return;
      }
      setSuccess(
        `“${shell.name.trim()}” is built with ${result.created ?? 0} question${
          (result.created ?? 0) === 1 ? "" : "s"
        }. Open its Questions drawer to edit them, then assign it.` +
          (result.warning ? ` ${result.warning}` : "")
      );
      onCreated();
      setTimeout(onClose, 1400);
    } catch {
      setError("The suite could not be created.");
    } finally {
      setBusy(null);
    }
  }

  const reviewed = shell !== null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Assessment engine"
      title={reviewed ? "Review the drafted suite" : "Draft a suite with AI"}
      subtitle={
        reviewed
          ? source
            ? `Written from the “${source}” opening. Nothing is stored until you create it.`
            : "Nothing is stored until you create it."
          : "Write a whole test from a job opening — a shell to check, questions to keep."
      }
      width="max-w-2xl"
      onSubmit={() => void (reviewed ? create() : generate())}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={
            reviewed ? `Create suite with ${kept.length} question${kept.length === 1 ? "" : "s"}` : "Draft suite"
          }
          pending={busy !== null}
          disabled={reviewed ? kept.length === 0 : types.length === 0}
          note={
            reviewed
              ? model
                ? `These words came from ${model}. Candidates see them only once you create the suite and assign it.`
                : "Candidates see them only once you create the suite and assign it."
              : `One run drafts up to ${MAX_DRAFTS_PER_RUN} questions and needs an AI provider key in Settings. A suite with no duration from the model opens at the ${defaultDurationMinutes} minutes Settings sets.`
          }
        />
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} success={success} />

        {/* ------------------------------------------------------------- brief */}
        <Field
          label="Write it for"
          htmlFor="sa-opening"
          hint={
            openingsError
              ? openingsError
              : "An opening supplies the role's own words. Or leave it on none and describe the subject below."
          }
        >
          <Select
            id="sa-opening"
            value={openingId}
            onChange={(e) => setOpeningId(e.target.value)}
          >
            <option value="">No opening — write from the subject only</option>
            {openings.map((opening) => (
              <option key={opening.id} value={opening.id}>
                {opening.label}
              </option>
            ))}
          </Select>
        </Field>
        {openingsNote && (
          <p className="rounded-lg bg-brand-cream px-3 py-2 text-[11px] leading-relaxed text-brand-ink/55">
            {openingsNote}
          </p>
        )}

        <Field
          label="What the test must cover"
          htmlFor="sa-topic"
          hint={
            openingId
              ? "Optional with an opening chosen — say so if the suite should focus on part of the role."
              : "Required when no opening is chosen: the skills, tools and judgements the role runs on."
          }
        >
          <TextArea
            id="sa-topic"
            rows={2}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Rate parity for a beach resort, and the Excel work behind it"
          />
        </Field>

        <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
          <legend className="px-1 text-xs font-bold">Question types to draft</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(TYPE_LABELS) as QuestionType[])
              // CODING has no drafting rules yet; the suite door would drop it.
              .filter((type) => type !== "CODING")
              .map((type) => (
                <label key={type} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={() => toggleType(type)}
                    className="mt-0.5 h-4 w-4 rounded border-brand-line"
                  />
                  <span>
                    <span className="font-semibold">{TYPE_LABELS[type]}</span>
                    <span className="block text-brand-ink/50">{TYPE_HINTS[type]}</span>
                  </span>
                </label>
              ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="How many" htmlFor="sa-count" hint={`Up to ${MAX_DRAFTS_PER_RUN} at a time.`}>
            <TextInput
              id="sa-count"
              type="number"
              min={1}
              max={MAX_DRAFTS_PER_RUN}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field label="Marks each" htmlFor="sa-points">
            <TextInput
              id="sa-points"
              type="number"
              min={1}
              max={100}
              value={pointsEach}
              onChange={(e) => setPointsEach(e.target.value)}
            />
          </Field>
          <Field label="Level" htmlFor="sa-level">
            <Select
              id="sa-level"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            >
              {DIFFICULTIES.map((level) => (
                <option key={level} value={level}>
                  {DIFFICULTY_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Extra guidance"
          htmlFor="sa-notes"
          hint="Optional. Anything the model must know about the tools candidates have, or what to leave out."
        >
          <TextArea
            id="sa-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="They have Excel only, no macro recorder. The group runs 12 resorts."
          />
        </Field>

        {/* -------------------------------------------------------- the review */}
        {reviewed && (
          <div className="space-y-4 border-t border-brand-line pt-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-brand-ink/45">
                The suite this creates
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">{summary}</p>
            </div>

            <Field label="Suite name" htmlFor="sa-name" required>
              <TextInput
                id="sa-name"
                value={shell.name}
                onChange={(e) => patchShell({ name: e.target.value })}
                placeholder="Revenue management Excel suite"
              />
            </Field>

            <Field
              label="What the candidate reads first"
              htmlFor="sa-description"
              hint="This is the description on the assignment screen."
            >
              <TextArea
                id="sa-description"
                rows={2}
                value={shell.description}
                onChange={(e) => patchShell({ description: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Role family" htmlFor="sa-family">
                <Select
                  id="sa-family"
                  value={shell.role_family}
                  onChange={(e) => patchShell({ role_family: e.target.value })}
                >
                  {options.roleFamilies.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Duration (minutes)" htmlFor="sa-duration" required>
                <TextInput
                  id="sa-duration"
                  type="number"
                  min={5}
                  max={480}
                  value={shell.time_limit_minutes}
                  onChange={(e) => patchShell({ time_limit_minutes: e.target.value })}
                />
              </Field>
              <Field label="Company" htmlFor="sa-company" required>
                <Select
                  id="sa-company"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  {options.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={shell.block_copy_paste}
                onChange={(e) => patchShell({ block_copy_paste: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-brand-line"
              />
              <span>Block copy and paste during the test</span>
            </label>
          </div>
        )}

        {reviewed && cautions.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold text-amber-900">
              Flagged while drafting — {cautions.length}{" "}
              {cautions.length === 1 ? "note" : "notes"} to check against your own edits
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900/80">
              {cautions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {dropped.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold text-amber-900">Refused before you could review them</p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900/80">
              {dropped.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-brand-ink/55">
                {kept.length} of {drafts.length} kept. Uncheck a question to leave it out.
              </p>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy !== null}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-semibold transition hover:bg-brand-sand disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Draft again
              </button>
            </div>

            {drafts.map((draft, index) => (
              <label
                key={`${draft.title}-${index}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-2 transition",
                  excluded.has(index)
                    ? "border-brand-line bg-brand-cream/60 opacity-60"
                    : "border-transparent"
                )}
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(index)}
                  onChange={() =>
                    setExcluded((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                  aria-label={`Keep “${draft.title}”`}
                  className="mt-3 h-4 w-4 shrink-0 rounded border-brand-line accent-brand-gold"
                />
                <div className="min-w-0 flex-1">
                  <DraftCard draft={draft} />
                </div>
              </label>
            ))}
          </div>
        )}

        {busy === "drafting" && (
          <p className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-cream px-4 py-6 text-sm text-brand-ink/55">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Writing the suite…
          </p>
        )}

        {!reviewed && drafts.length === 0 && busy === null && (
          <p className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-[11px] leading-relaxed text-brand-ink/55">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              A draft is not a test. The suite, and every question in it, is written only when you
              create it here — then you can edit, re-order or delete each one from its Questions
              drawer before assigning it to anyone.
            </span>
          </p>
        )}

        {openings.length === 0 && !openingsError && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-brand-ink/45">
            <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              No openings are hiring right now, so this desk writes from a subject only. Post an
              opening on Jobs and it appears here.
            </span>
          </p>
        )}
      </div>
    </Drawer>
  );
}
