"use client";

import { useCallback, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { Badge } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { QuestionConfig, QuestionType, RubricCriterion } from "@/types";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  GRID_COLUMNS,
  MAX_DRAFTS_PER_RUN,
  reviewNote,
  sheetNote,
  type Difficulty,
  type GeneratedQuestion,
} from "@/modules/assessment/domain/aiAuthoring";
import { columnLetters } from "@/modules/assessment/domain/attemptAnswers";
import {
  MAX_RUBRIC_CRITERIA,
  MIN_RUBRIC_CRITERIA,
  RUBRIC_WEIGHT_TOTAL,
  isRubricType,
  type RubricType,
} from "@/modules/assessment/domain/rubric";
import {
  CODE_STARTER_CAP,
  CODING_LANGUAGES,
} from "@/modules/assessment/domain/coding";
import {
  addDraftedQuestions,
  deleteQuestion,
  draftQuestions,
  moveQuestion,
  saveQuestion,
  type ChoiceDraft,
} from "./question-actions";
import type { SkillOption } from "@/modules/assessment/domain/skillTags";

/**
 * Question editor.
 *
 * Opens from a suite and lets every question be added, rewritten, re-ordered or
 * removed. The previous suite drawer could only edit the template's own
 * settings, which left seeded questions read-only.
 */

export interface EditableQuestion {
  id: string;
  template_id: string;
  question_type: QuestionType;
  title: string;
  prompt: string;
  instructions: string | null;
  config: QuestionConfig;
  points: number;
  position: number;
  time_limit_minutes: number | null;
  shuffle_options: boolean;
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  CASE_STUDY: "Case study",
  EXCEL_MODEL: "Spreadsheet model",
  VIDEO_PITCH: "Video pitch",
  SITUATIONAL_JUDGMENT: "Situational judgment",
  CODING: "Coding",
};

export const TYPE_HINTS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Candidate picks one option. Exactly one must be correct.",
  CASE_STUDY: "Written response graded against the criteria you set.",
  EXCEL_MODEL:
    "Candidate builds and uploads a spreadsheet. The workbook definition is kept as-is.",
  VIDEO_PITCH: "Candidate records a short video answer.",
  SITUATIONAL_JUDGMENT:
    "A workplace scene with plausible responses. Each response earns a percentage; no single one is correct.",
  CODING: "The candidate writes code in a plain text box. Nothing runs it.",
};

/**
 * What each type's marks can actually be seen in.
 *
 * A criterion the grader cannot read from the answer is a criterion whose marks
 * go nowhere, so the panel names the one thing each type puts in front of the
 * model: a case's words, a pitch's transcript.
 */
const RUBRIC_NOTES: Record<RubricType, string> = {
  CASE_STUDY:
    "The grader reads the written answer against each criterion and gives it a share of that criterion's marks. The question's total is the sum of those marks, never a number the model chose.",
  VIDEO_PITCH:
    "A pitch is graded from its transcript, so name only what the transcript carries. Delivery, presence and anything off-camera stay with the human reviewer.",
};

interface Draft {
  id: string | null;
  question_type: QuestionType;
  title: string;
  prompt: string;
  instructions: string;
  points: string;
  time_limit_minutes: string;
  shuffle_options: boolean;
  options: ChoiceDraft[];
  context: string;
  min_words: string;
  min_duration_seconds: string;
  max_duration_seconds: string;
  language: string;
  starter_code: string;
  rubric: RubricRow[];
  preserve_config: QuestionConfig | null;
}

/** One criterion as the author is writing it — every field a string until it leaves. */
interface RubricRow {
  label: string;
  weight: string;
  description: string;
  /** The catalogue id, or "" for a criterion tied to no skill. */
  skill_id: string;
  /** The stored spelling, kept only so a retired tag can still be read. */
  skill_name: string;
}

const blankRubricRows = (): RubricRow[] =>
  Array.from({ length: MIN_RUBRIC_CRITERIA }, () => ({
    label: "",
    weight: "",
    description: "",
    skill_id: "",
    skill_name: "",
  }));

/**
 * The stored scheme, back in the panel that wrote it.
 *
 * A question whose config carries no criteria opens on the minimum two blank rows
 * rather than none: an author who has never set a scheme still sees the panel
 * asking for the two names it needs, and an emptied panel stays the way to retire
 * one that exists.
 */
function rubricRowsFrom(rows: RubricCriterion[] | undefined): RubricRow[] {
  if (!rows || rows.length === 0) return blankRubricRows();
  return rows.map((criterion) => ({
    label: criterion.label,
    weight: String(criterion.weight),
    description: criterion.description ?? "",
    skill_id: criterion.skill_id ?? "",
    skill_name: criterion.skill_name ?? "",
  }));
}

/**
 * A weight the validator can read, or nothing at all.
 *
 * The rubric refuses a weight sent as text, so an empty box leaves as an absent
 * key rather than `0` — a criterion nobody weighted is a criterion the author
 * still has to write, not one worth nothing.
 */
function weightNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const weight = Number(trimmed);
  return Number.isFinite(weight) ? weight : undefined;
}

function toDraft(question: EditableQuestion | null): Draft {
  if (!question) {
    return {
      id: null,
      question_type: "MULTIPLE_CHOICE",
      title: "",
      prompt: "",
      instructions: "",
      points: "10",
      time_limit_minutes: "",
      shuffle_options: false,
      options: [
        { text: "", is_correct: true },
        { text: "", is_correct: false },
        { text: "", is_correct: false },
      ],
      context: "",
      min_words: "",
      min_duration_seconds: "",
      max_duration_seconds: "120",
      language: "",
      starter_code: "",
      rubric: blankRubricRows(),
      preserve_config: null,
    };
  }

  const config = question.config ?? {};
  return {
    id: question.id,
    question_type: question.question_type,
    title: question.title,
    prompt: question.prompt,
    instructions: question.instructions ?? "",
    points: String(question.points),
    time_limit_minutes: question.time_limit_minutes ? String(question.time_limit_minutes) : "",
    shuffle_options: question.shuffle_options,
    options: (config.options ?? []).map((option) => ({
      text: option.text,
      is_correct: option.is_correct,
      score: option.score ?? null,
    })),
    context: config.context ?? "",
    min_words: config.min_words ? String(config.min_words) : "",
    min_duration_seconds: config.min_duration_seconds
      ? String(config.min_duration_seconds)
      : "",
    max_duration_seconds: config.max_duration_seconds
      ? String(config.max_duration_seconds)
      : "120",
    language: config.language ?? "",
    starter_code: config.starter_code ?? "",
    rubric: rubricRowsFrom(config.rubric),
    // Handed back untouched so EXCEL_MODEL workbooks survive an edit.
    preserve_config: config,
  };
}

const numberOrNull = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

export function QuestionEditorDrawer({
  open,
  onClose,
  templateId,
  templateName,
  questions,
  editable,
  onChanged,
  openAtId,
  situationalAvailable = true,
  situationalNote = null,
  codingAvailable = true,
  codingNote = null,
  skillOptions = [],
  skillsNote = null,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
  questions: EditableQuestion[];
  editable: boolean;
  onChanged: () => void;
  /**
   * Open the editor on one of the suite's questions instead of on its list.
   *
   * The question bank reaches the suite editor from a single row, and an editor
   * that only ever opened on the list would make the recruiter find the same
   * question again by hand.
   */
  /**
   * Open the editor on one of the suite's questions instead of on its list.
   *
   * The question bank reaches the suite editor from a single row, and an editor
   * that only ever opened on the list would make the recruiter find the same
   * question again by hand. Read once, on mount: the bank mounts a fresh editor
   * per row, and a later re-read of the suite must not reopen the form over a
   * draft the recruiter has already typed into.
   */
  openAtId?: string;
  /** Whether `public.question_type` carries SITUATIONAL_JUDGMENT yet (034). */
  situationalAvailable?: boolean;
  /** Why it does not, shown where the type would otherwise be offered. */
  situationalNote?: string | null;
  /** Whether `public.question_type` carries CODING yet (039). */
  codingAvailable?: boolean;
  /** Why it does not, shown where the type would otherwise be saved. */
  codingNote?: string | null;
  /** Active catalogue skills a rubric criterion may name. */
  skillOptions?: SkillOption[];
  /** Why the list is empty, printed beside the rubric rows. */
  skillsNote?: string | null;
}) {
  const [editing, setEditing] = useState<Draft | null>(() => {
    if (!openAtId) return null;
    const target = questions.find((question) => question.id === openAtId);
    return target ? toDraft(target) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ------------------------------------------------------------- AI drafting
  const [authoring, setAuthoring] = useState(false);
  const [topic, setTopic] = useState("");
  const [types, setTypes] = useState<QuestionType[]>(["MULTIPLE_CHOICE", "CASE_STUDY"]);
  const [count, setCount] = useState("3");
  const [difficulty, setDifficulty] = useState<Difficulty>("MID");
  const [pointsEach, setPointsEach] = useState("10");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<GeneratedQuestion[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [askedFor, setAskedFor] = useState(0);
  const [model, setModel] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);
  const [authorError, setAuthorError] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const sorted = [...questions].sort((a, b) => a.position - b.position);

  function toggleType(type: QuestionType) {
    setTypes((current) =>
      current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]
    );
  }

  async function generate() {
    setDrafting(true);
    setAuthorError(null);
    setAddedNote(null);
    try {
      const result = await draftQuestions({
        templateId,
        topic,
        types,
        count: Number(count),
        difficulty,
        pointsEach: Number(pointsEach),
        notes,
      });
      if (!result.ok) {
        setDrafts([]);
        setDropped([]);
        setModel(null);
        setAuthorError(result.error ?? "Nothing was drafted.");
        return;
      }
      setDrafts(result.drafts ?? []);
      setDropped(result.dropped ?? []);
      setAskedFor(Number(count));
      setModel(result.model ?? null);
    } catch {
      setAuthorError("The model could not be reached. Try again, or write the question by hand.");
    } finally {
      setDrafting(false);
    }
  }

  async function addDrafts(chosen: GeneratedQuestion[]) {
    if (chosen.length === 0) return;
    setAddingTitle(chosen.length === 1 ? chosen[0].title : "__all__");
    setAuthorError(null);
    setAddedNote(null);
    try {
      const result = await addDraftedQuestions(templateId, chosen);
      const refused = result.refused ?? [];
      const refusedIndexes = new Set(refused.map((entry) => entry.index));
      // Only the refused drafts stay on the desk; the rest are in the suite now.
      const staying = chosen.filter((_, index) => refusedIndexes.has(index));
      setDrafts((current) =>
        current.filter((draft) => !chosen.includes(draft) || staying.includes(draft))
      );

      if (!result.ok && (result.created ?? 0) === 0) {
        setAuthorError(result.error ?? "The suite refused those drafts.");
        return;
      }

      setAddedNote(
        `${result.created} added to “${result.suite ?? "this suite"}”` +
          (refused.length > 0
            ? `, and ${refused.length} ${
                refused.length === 1 ? "was" : "were"
              } refused: ${refused
                .map((entry) => `${entry.title} — ${entry.reason}`)
                .join(" ")}`
            : "")
      );
      onChanged();
    } catch {
      setAuthorError("The drafts could not be written to the suite.");
    } finally {
      setAddingTitle(null);
    }
  }

  const patch = useCallback((next: Partial<Draft>) => {
    setEditing((current) => (current ? { ...current, ...next } : current));
    setError(null);
    setSaved(false);
  }, []);

  function openNew() {
    setEditing(toDraft(null));
    setError(null);
    setSaved(false);
  }

  function openExisting(question: EditableQuestion) {
    setEditing(toDraft(question));
    setError(null);
    setSaved(false);
  }

  async function submit() {
    if (!editing) return;
    setPending(true);
    setError(null);
    try {
      const result = await saveQuestion({
        id: editing.id,
        template_id: templateId,
        question_type: editing.question_type,
        title: editing.title,
        prompt: editing.prompt,
        instructions: editing.instructions,
        points: Number(editing.points),
        position: editing.id === null ? sorted.length : findPosition(editing.id),
        time_limit_minutes: numberOrNull(editing.time_limit_minutes),
        shuffle_options: editing.shuffle_options,
        options: editing.options,
        context: editing.context,
        min_words: numberOrNull(editing.min_words),
        min_duration_seconds: numberOrNull(editing.min_duration_seconds),
        max_duration_seconds: numberOrNull(editing.max_duration_seconds),
        // Only a coding question names a language or offers a starter; an
        // absent key on any other type means the same as it always did.
        ...(editing.question_type === "CODING"
          ? { language: editing.language, starter_code: editing.starter_code }
          : {}),
        // Only a type with a panel speaks of a marking scheme: an absent key
        // means "keep what is stored", which is what a quiz or a workbook draft
        // must mean, since neither ever read one.
        ...(isRubricType(editing.question_type)
          ? {
              rubric: editing.rubric.map((row) => ({
                label: row.label,
                weight: weightNumber(row.weight),
                description: row.description,
                skill_id: row.skill_id || undefined,
              })),
            }
          : {}),
        preserve_config: editing.preserve_config,
      });

      if (result.ok) {
        setSaved(true);
        setEditing(null);
        onChanged();
      } else {
        setError(result.error ?? "Could not save the question.");
      }
    } catch {
      setError("Something went wrong saving the question.");
    } finally {
      setPending(false);
    }
  }

  function findPosition(id: string): number {
    return sorted.findIndex((question) => question.id === id);
  }

  async function remove(question: EditableQuestion) {
    if (
      !window.confirm(
        `Delete “${question.title}”? This cannot be undone once any candidate has answered it.`
      )
    ) {
      return;
    }
    setBusyId(question.id);
    const result = await deleteQuestion(question.id, templateId);
    setBusyId(null);
    if (result.ok) {
      onChanged();
    } else {
      setError(result.error ?? "Could not delete that question.");
    }
  }

  async function move(question: EditableQuestion, direction: "up" | "down") {
    setBusyId(question.id);
    const result = await moveQuestion(question.id, templateId, direction);
    setBusyId(null);
    if (result.ok) {
      onChanged();
    } else {
      setError(result.error ?? "Could not re-order that question.");
    }
  }

  if (editing) {
    return (
      <Drawer
        open={open}
        onClose={() => setEditing(null)}
        eyebrow={editing.id === null ? "New question" : "Edit question"}
        title={editing.id === null ? "Add question" : "Edit question"}
        subtitle={templateName}
        width="max-w-2xl"
        onSubmit={submit}
        footer={
          <DrawerActions
            onCancel={() => setEditing(null)}
            submitLabel={editing.id === null ? "Add question" : "Save question"}
            pending={pending}
            disabled={editing.question_type === "CODING" && !codingAvailable}
            note="Changes apply to attempts that start after this point."
          />
        }
      >
        <div className="space-y-4">
          <Field label="Question type" htmlFor="q-type" required hint={TYPE_HINTS[editing.question_type]}>
            <Select
              id="q-type"
              value={editing.question_type}
              onChange={(e) =>
                patch({ question_type: e.target.value as QuestionType })
              }
            >
              {(Object.keys(TYPE_LABELS) as QuestionType[])
                .filter(
                  (type) =>
                    (type !== "SITUATIONAL_JUDGMENT" || situationalAvailable) &&
                    (type !== "CODING" || codingAvailable)
                )
                .map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
            </Select>
          </Field>

          {editing.question_type === "CODING" && !codingAvailable && codingNote ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
              {codingNote}
            </p>
          ) : null}

          <Field label="Short title" htmlFor="q-title" required hint="Shown in the candidate's contents list.">
            <TextInput
              id="q-title"
              value={editing.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Investment logic quiz"
            />
          </Field>

          <Field label="Question" htmlFor="q-prompt" required>
            <TextArea
              id="q-prompt"
              rows={4}
              value={editing.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="What exactly should the candidate answer?"
            />
          </Field>

          <Field
            label="Extra instructions"
            htmlFor="q-instructions"
            hint="Optional. Shown under the question, above the answer area."
          >
            <TextArea
              id="q-instructions"
              rows={2}
              value={editing.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="Keep it to one side. State assumptions explicitly."
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Points" htmlFor="q-points" required>
              <TextInput
                id="q-points"
                type="number"
                min={1}
                max={100}
                value={editing.points}
                onChange={(e) => patch({ points: e.target.value })}
              />
            </Field>

            <Field
              label="Time limit (minutes)"
              htmlFor="q-time"
              hint="Blank uses the suite's total time."
            >
              <TextInput
                id="q-time"
                type="number"
                min={1}
                max={480}
                value={editing.time_limit_minutes}
                onChange={(e) => patch({ time_limit_minutes: e.target.value })}
                placeholder="—"
              />
            </Field>
          </div>

          {editing.question_type === "MULTIPLE_CHOICE" && (
            <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
              <legend className="px-1 text-xs font-bold">Answer options</legend>
              <p className="mb-3 text-[11px] text-brand-ink/45">
                Mark the correct answer. Changing wording is safe; removing an option is not
                available once a candidate has answered.
              </p>

              <ul className="space-y-2">
                {editing.options.map((option, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct-option"
                      checked={option.is_correct}
                      onChange={() =>
                        patch({
                          // Exactly one correct is enforced on both sides, so
                          // selecting an option clears the previous one.
                          options: editing.options.map((o, i) => ({
                            ...o,
                            is_correct: i === index,
                          })),
                        })
                      }
                      aria-label={`Mark option ${index + 1} as correct`}
                      className="h-4 w-4 shrink-0 accent-brand-gold"
                    />
                    <TextInput
                      value={option.text}
                      onChange={(e) =>
                        patch({
                          options: editing.options.map((o, i) =>
                            i === index ? { ...o, text: e.target.value } : o
                          ),
                        })
                      }
                      placeholder={`Option ${index + 1}`}
                      aria-label={`Option ${index + 1} text`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patch({ options: editing.options.filter((_, i) => i !== index) })
                      }
                      disabled={editing.options.length <= 2}
                      aria-label={`Remove option ${index + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() =>
                  patch({
                    options: [
                      ...editing.options,
                      { text: "", is_correct: false },
                    ],
                  })
                }
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add option
              </button>

              <label className="mt-4 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={editing.shuffle_options}
                  onChange={(e) => patch({ shuffle_options: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-brand-line"
                />
                <span>Shuffle these options per candidate</span>
              </label>
            </fieldset>
          )}

          {editing.question_type === "SITUATIONAL_JUDGMENT" && (
            <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
              <legend className="px-1 text-xs font-bold">Responses and effectiveness</legend>
              <p className="mb-3 text-[11px] leading-relaxed text-brand-ink/45">
                Write the responses a candidate could plausibly give. Score each from 0
                (makes things worse) to 100 (the response to coach). At least two scores
                must differ — no single response is the correct one, and a pick earns its
                share of the question&rsquo;s points.
              </p>

              <ul className="space-y-2">
                {editing.options.map((option, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-[11px] font-bold text-brand-ink/45">
                      {index + 1}
                    </span>
                    <TextInput
                      value={option.text}
                      onChange={(e) =>
                        patch({
                          options: editing.options.map((o, i) =>
                            i === index ? { ...o, text: e.target.value } : o
                          ),
                        })
                      }
                      placeholder={`Response ${index + 1}`}
                      aria-label={`Response ${index + 1} text`}
                    />
                    <TextInput
                      type="number"
                      min={0}
                      max={100}
                      value={option.score ?? ""}
                      onChange={(e) =>
                        patch({
                          options: editing.options.map((o, i) =>
                            i === index
                              ? {
                                  ...o,
                                  score:
                                    e.target.value === "" ? null : Number(e.target.value),
                                }
                              : o
                          ),
                        })
                      }
                      placeholder="0–100"
                      aria-label={`Effectiveness of response ${index + 1}`}
                      className="w-24 shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patch({ options: editing.options.filter((_, i) => i !== index) })
                      }
                      disabled={editing.options.length <= 2}
                      aria-label={`Remove response ${index + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() =>
                  patch({
                    options: [...editing.options, { text: "", is_correct: false, score: null }],
                  })
                }
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add response
              </button>

              <label className="mt-4 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={editing.shuffle_options}
                  onChange={(e) => patch({ shuffle_options: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-brand-line"
                />
                <span>Shuffle these responses per candidate</span>
              </label>
            </fieldset>
          )}

          {editing.question_type === "CASE_STUDY" && (
            <div className="grid grid-cols-1 gap-4">
              <Field
                label="Scenario context"
                htmlFor="q-context"
                hint="The brief the candidate reads before answering."
              >
                <TextArea
                  id="q-context"
                  rows={4}
                  value={editing.context}
                  onChange={(e) => patch({ context: e.target.value })}
                  placeholder="A resort is facing a 30% drop in occupancy after a competitor opens…"
                />
              </Field>
              <Field
                label="Minimum words"
                htmlFor="q-minwords"
                hint="Blank means no minimum."
              >
                <TextInput
                  id="q-minwords"
                  type="number"
                  min={0}
                  value={editing.min_words}
                  onChange={(e) => patch({ min_words: e.target.value })}
                  placeholder="150"
                />
              </Field>
            </div>
          )}

          {editing.question_type === "CODING" && (
            <div className="space-y-4">
              <Field
                label="Language"
                htmlFor="q-language"
                required
                hint="The language the candidate writes in. Nothing runs their code."
              >
                <Select
                  id="q-language"
                  name="language"
                  aria-label="Language"
                  value={editing.language}
                  onChange={(e) => patch({ language: e.target.value })}
                  required
                >
                  <option value="">Pick a language</option>
                  {CODING_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Starter code"
                htmlFor="q-starter"
                hint="Shown beside the prompt and never graded. Blank means no starter."
              >
                <TextArea
                  id="q-starter"
                  name="starter_code"
                  aria-label="Starter code"
                  rows={6}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  maxLength={CODE_STARTER_CAP}
                  className="font-mono"
                  value={editing.starter_code}
                  onChange={(e) => patch({ starter_code: e.target.value })}
                />
              </Field>
              <p className="text-xs text-brand-ink/45">
                {editing.starter_code.length.toLocaleString("en-US")} of{" "}
                {CODE_STARTER_CAP.toLocaleString("en-US")} starter characters.
              </p>
            </div>
          )}

          {editing.question_type === "VIDEO_PITCH" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Maximum length (seconds)" htmlFor="q-maxsec">
                <TextInput
                  id="q-maxsec"
                  type="number"
                  min={10}
                  max={1800}
                  value={editing.max_duration_seconds}
                  onChange={(e) => patch({ max_duration_seconds: e.target.value })}
                />
              </Field>
              <Field
                label="Minimum length (seconds)"
                htmlFor="q-minsec"
                hint="Blank means no minimum."
              >
                <TextInput
                  id="q-minsec"
                  type="number"
                  min={0}
                  max={1800}
                  value={editing.min_duration_seconds}
                  onChange={(e) => patch({ min_duration_seconds: e.target.value })}
                  placeholder="—"
                />
              </Field>
            </div>
          )}

          {isRubricType(editing.question_type) && (
            <RubricFieldset
              rows={editing.rubric}
              note={RUBRIC_NOTES[editing.question_type]}
              skillOptions={skillOptions}
              skillsNote={skillsNote}
              onChange={(rubric) => patch({ rubric })}
            />
          )}

          {editing.question_type === "EXCEL_MODEL" && (
            <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/55">
              The spreadsheet definition and expected outputs are kept exactly as they are.
              Changing the type to something editable will replace them, so do that only if you
              intend to drop the workbook.
            </p>
          )}

          <FormMessage error={error} success={saved ? "Question saved." : null} />
        </div>
      </Drawer>
    );
  }

  // ------------------------------------------------------------- draft mode
  if (authoring) {
    return (
      <Drawer
        open={open}
        onClose={() => setAuthoring(false)}
        eyebrow={templateName}
        title="Draft questions with AI"
        subtitle="Nothing is stored until you add it"
        width="max-w-2xl"
        onSubmit={() => void generate()}
        footer={
          <DrawerActions
            onCancel={() => setAuthoring(false)}
            submitLabel={drafts.length > 0 ? "Draft again" : "Draft questions"}
            pending={drafting}
            note={
              model
                ? `These words came from ${model}. A candidate sees a question only after you add it.`
                : "A candidate sees a question only after you add it here."
            }
          />
        }
      >
        <div className="space-y-4">
          <Field
            label="What is being tested"
            htmlFor="ai-topic"
            required
            hint="A skill, a tool, or a judgement — the model writes the questions around this."
          >
            <TextArea
              id="ai-topic"
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Occupancy forecasting for a resort revenue analyst"
            />
          </Field>

          <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
            <legend className="px-1 text-xs font-bold">Question types to draft</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(TYPE_LABELS) as QuestionType[])
                .filter((type) => type !== "SITUATIONAL_JUDGMENT" || situationalAvailable)
                .filter((type) => type !== "CODING" || codingAvailable)
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
            <Field label="How many" htmlFor="ai-count" hint={`Up to ${MAX_DRAFTS_PER_RUN} at a time.`}>
              <TextInput
                id="ai-count"
                type="number"
                min={1}
                max={MAX_DRAFTS_PER_RUN}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
            <Field label="Marks each" htmlFor="ai-points">
              <TextInput
                id="ai-points"
                type="number"
                min={1}
                max={100}
                value={pointsEach}
                onChange={(e) => setPointsEach(e.target.value)}
              />
            </Field>
            <Field label="Level" htmlFor="ai-level">
              <Select
                id="ai-level"
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
            htmlFor="ai-notes"
            hint="Optional. Anything the model must know about the role or the tools candidates have."
          >
            <TextArea
              id="ai-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="They use Excel only, no macro recorder. The group runs 12 resorts."
            />
          </Field>

          <FormMessage error={authorError} success={addedNote} />

          {dropped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-bold text-amber-900">
                Refused before you could review them
              </p>
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
                  {reviewNote(
                    { drafts, dropped, shortBy: Math.max(0, askedFor - drafts.length) },
                    askedFor
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => void addDrafts(drafts)}
                  disabled={addingTitle !== null}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-ink px-3 py-2 text-xs font-semibold text-brand-cream transition hover:bg-brand-ink/90 disabled:opacity-50"
                >
                  {addingTitle === "__all__" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Add all {drafts.length}
                </button>
              </div>

              {drafts.map((draft) => (
                <DraftCard
                  key={`${draft.title}-${draft.question_type}`}
                  draft={draft}
                  pending={addingTitle === draft.title}
                  onAdd={() => void addDrafts([draft])}
                />
              ))}
            </div>
          )}

          {drafting && drafts.length === 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-cream px-4 py-6 text-sm text-brand-ink/55">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Writing the drafts…
            </p>
          )}
        </div>
      </Drawer>
    );
  }

  // --------------------------------------------------------------- list mode
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={templateName}
      title="Questions"
      subtitle="Edit, re-order or add questions."
      width="max-w-xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            {sorted.length} question{sorted.length === 1 ? "" : "s"} ·{" "}
            {sorted.reduce((sum, q) => sum + q.points, 0)} points
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
            >
              Done
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => {
                  setAuthoring(true);
                  setAuthorError(null);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-sand"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Draft with AI
              </button>
            )}
            {editable && (
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add question
              </button>
            )}
          </div>
        </div>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      {!situationalAvailable && situationalNote && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
          {situationalNote}
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-brand-line bg-brand-cream px-4 py-8 text-center text-sm text-brand-ink/50">
          This suite has no questions yet.
          {editable && ' Use "Add question" to create the first one.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((question, index) => (
            <li
              key={question.id}
              className="rounded-xl border border-brand-line bg-white p-3.5"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-sand text-[11px] font-bold">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{question.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-brand-ink/55">{question.prompt}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{TYPE_LABELS[question.question_type]}</Badge>
                    <Badge tone="gold">{question.points} pts</Badge>
                    {question.time_limit_minutes ? (
                      <Badge tone="neutral">{question.time_limit_minutes} min</Badge>
                    ) : null}
                  </p>
                </div>

                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void move(question, "up")}
                      disabled={index === 0 || busyId === question.id}
                      aria-label={`Move ${question.title} up`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => void move(question, "down")}
                      disabled={index === sorted.length - 1 || busyId === question.id}
                      aria-label={`Move ${question.title} down`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => openExisting(question)}
                      aria-label={`Edit ${question.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-brand-sand hover:text-brand-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(question)}
                      disabled={busyId === question.id}
                      aria-label={`Delete ${question.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                    >
                      {busyId === question.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/**
 * The marking scheme an author writes for a case study or a pitch.
 *
 * Rows are kept in the draft as text, because a weight typed as "40" and a weight
 * left blank mean different things to the validator — and only the second one
 * means "the author has not decided yet". Removal is never blocked: an emptied
 * panel is how a scheme is retired, so a row the author cannot delete is a scheme
 * they cannot undo.
 */
function RubricFieldset({
  rows,
  note,
  skillOptions,
  skillsNote,
  onChange,
}: {
  rows: RubricRow[];
  note: string;
  skillOptions: SkillOption[];
  skillsNote: string | null;
  onChange: (rows: RubricRow[]) => void;
}) {
  const write = (index: number, next: Partial<RubricRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  const total = rows.reduce((sum, row) => sum + (weightNumber(row.weight) ?? 0), 0);
  // With an empty catalogue, one tagged row makes "every criterion saves
  // untagged" false for the whole scheme, so the fallback narrows to this row.
  const anyTagged = rows.some((row) => Boolean(row.skill_id));

  return (
    <fieldset className="rounded-xl border border-brand-line bg-brand-cream p-4">
      <legend className="px-1 text-xs font-bold">Marking scheme</legend>
      <p className="mb-3 text-[11px] leading-relaxed text-brand-ink/45">
        Name {MIN_RUBRIC_CRITERIA} to {MAX_RUBRIC_CRITERIA} criteria. Their weights are shares of
        this question&rsquo;s marks and must add up to {RUBRIC_WEIGHT_TOTAL}. {note}
      </p>

      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <TextInput
                value={row.label}
                onChange={(e) => write(index, { label: e.target.value })}
                placeholder={`Criterion ${index + 1}`}
                aria-label={`Name of criterion ${index + 1}`}
              />
              <TextInput
                type="number"
                min={1}
                max={RUBRIC_WEIGHT_TOTAL}
                value={row.weight}
                onChange={(e) => write(index, { weight: e.target.value })}
                placeholder="Weight"
                aria-label={`Weight of criterion ${index + 1}`}
                className="w-24 shrink-0"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/50 transition hover:bg-rose-50 hover:text-rose-700"
              >
                <X className="h-4 w-4" aria-hidden />
                <span className="sr-only">{`Remove criterion ${index + 1}`}</span>
              </button>
            </div>
            <TextArea
              rows={2}
              value={row.description}
              onChange={(e) => write(index, { description: e.target.value })}
              placeholder="What a strong answer shows (optional)"
              aria-label={`What a strong answer shows for criterion ${index + 1}`}
            />
            {/*
              A stored tag keeps the select even with an empty catalogue: the
              criterion already carries an id, and a row that can only be read
              as an absence is a row whose tag cannot be cleared, which leaves
              the save refused with no control on screen that could fix it.
            */}
            {skillOptions.length > 0 || row.skill_id ? (
              <>
                <select
                  value={row.skill_id}
                  onChange={(e) => write(index, { skill_id: e.target.value })}
                  aria-label={`Skill of criterion ${index + 1}`}
                  className="w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-ink"
                >
                  <option value="">Not tied to a skill</option>
                  {row.skill_id &&
                    !skillOptions.some((skill) => skill.id === row.skill_id) && (
                      <option value={row.skill_id} disabled>
                        {row.skill_name || "Retired skill"}
                      </option>
                    )}
                  {skillOptions.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </select>
                {skillOptions.length === 0 && (
                  <p className="text-[11px] leading-relaxed text-brand-ink/45">
                    {skillsNote ??
                      "Skill tagging is unavailable because no active skills are on file. Choose “Not tied to a skill” to save this criterion untagged."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-brand-ink/45">
                {skillsNote ??
                  (anyTagged
                    ? "Skill tagging is unavailable because no active skills are on file. This criterion still saves untagged."
                    : "Skill tagging is unavailable because no active skills are on file. Every criterion still saves untagged.")}
              </p>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { label: "", weight: "", description: "", skill_id: "", skill_name: "" },
          ])
        }
        disabled={rows.length >= MAX_RUBRIC_CRITERIA}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add criterion
      </button>

      <p className="mt-2 text-[11px] text-brand-ink/45">
        Weights so far add up to {total} of {RUBRIC_WEIGHT_TOTAL}.
      </p>
    </fieldset>
  );
}

/**
 * One drafted question, shown as the candidate would receive it.
 *
 * Shared by both AI desks: the question desk offers it with an "Add to suite"
 * button, and the suite desk shows it under a keep-checkbox before the whole
 * suite is created. The card itself never decides what happens to a draft.
 */
export function DraftCard({
  draft,
  pending = false,
  onAdd,
}: {
  draft: GeneratedQuestion;
  pending?: boolean;
  onAdd?: () => void;
}) {
  // The best-rated response, so the recruiter sees the key the model chose
  // without having to compare six percentages themselves.
  const bestJudgment =
    draft.question_type === "SITUATIONAL_JUDGMENT"
      ? draft.options.reduce<number | null>(
          (top, option) =>
            option.score === null || option.score === undefined
              ? top
              : Math.max(top ?? 0, option.score),
          null
        )
      : null;

  return (
    <article className="rounded-xl border border-brand-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{draft.title}</p>
          <p className="mt-1 text-xs text-brand-ink/45">
            {draft.points} marks
            {draft.time_limit_minutes ? ` · ${draft.time_limit_minutes} min` : ""}
          </p>
        </div>
        <Badge tone="neutral">{TYPE_LABELS[draft.question_type]}</Badge>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{draft.prompt}</p>
      {draft.instructions && (
        <p className="mt-2 text-xs text-brand-ink/55">{draft.instructions}</p>
      )}

      {draft.question_type === "CASE_STUDY" && draft.context && (
        <div className="mt-3 rounded-lg bg-brand-cream px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
            Scenario the candidate reads
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-brand-ink/70">{draft.context}</p>
          {draft.min_words ? (
            <p className="mt-1 text-[11px] text-brand-ink/45">Minimum {draft.min_words} words.</p>
          ) : null}
        </div>
      )}

      {draft.question_type === "MULTIPLE_CHOICE" && (
        <ul className="mt-3 space-y-1.5">
          {draft.options.map((option) => (
            <li key={option.text} className="flex items-start gap-2 text-xs">
              {option.is_correct ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span className={option.is_correct ? "font-semibold" : "text-brand-ink/70"}>
                {option.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft.question_type === "SITUATIONAL_JUDGMENT" && (
        <div className="mt-3 space-y-1.5">
          {draft.options.map((option) => {
            const isBest = bestJudgment !== null && option.score === bestJudgment;
            return (
              <div key={option.text} className="flex items-start justify-between gap-2 text-xs">
                <span
                  className={cn(
                    "flex min-w-0 items-start gap-2",
                    isBest ? "font-semibold" : "text-brand-ink/70"
                  )}
                >
                  {isBest ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  {option.text}
                </span>
                {option.score !== null && option.score !== undefined && (
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      isBest ? "font-semibold text-emerald-700" : "text-brand-ink/45"
                    )}
                  >
                    {option.score}%
                  </span>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[11px] leading-relaxed text-brand-ink/45">
            Percentages are the model&apos;s effectiveness ratings, shown here only. The candidate
            reads the responses and is never shown a score.
          </p>
        </div>
      )}

      {draft.question_type === "VIDEO_PITCH" && (
        <p className="mt-3 text-xs text-brand-ink/55">
          {draft.max_duration_seconds
            ? `At most ${draft.max_duration_seconds} seconds`
            : "No length limit"}
          {draft.min_duration_seconds ? `, at least ${draft.min_duration_seconds} seconds` : ""}.
        </p>
      )}

      {draft.question_type === "EXCEL_MODEL" && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-brand-ink/55">{sheetNote(draft)}</p>
          <SheetPreview draft={draft} />
          <ul className="space-y-1 text-xs">
            {draft.outputs.map((output) => (
              <li key={output.cell}>
                <span className="font-mono font-semibold">{output.cell}</span> —{" "}
                {output.description}
                {output.formula_hint ? (
                  <span className="text-brand-ink/45"> (hint: {output.formula_hint})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft.cautions.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {draft.cautions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {onAdd && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onAdd}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-xs font-semibold transition hover:bg-brand-sand disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            Add to suite
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * The paper a spreadsheet question hands out, with the cells it asks for marked.
 *
 * A given-away answer is only catchable by looking at the grid, so this shows the
 * sheet as the candidate receives it and marks every cell the question expects
 * them to produce.
 */
function SheetPreview({ draft }: { draft: GeneratedQuestion }) {
  const required = new Set(draft.outputs.map((output) => output.cell));

  return (
    <div className="overflow-x-auto rounded-lg border border-brand-line">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-brand-sand text-brand-ink/55">
          <tr>
            <th className="px-2 py-1" aria-label="Row number" />
            {Array.from({ length: GRID_COLUMNS }, (_, index) => (
              <th key={index} className="px-2 py-1 font-semibold">
                {columnLetters(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.sheet.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-brand-line">
              <th className="bg-brand-sand/60 px-2 py-1 font-semibold">{rowIndex + 1}</th>
              {Array.from({ length: GRID_COLUMNS }, (_, colIndex) => {
                const ref = `${columnLetters(colIndex)}${rowIndex + 1}`;
                const asked = required.has(ref);
                return (
                  <td
                    key={ref}
                    className={cn(
                      "px-2 py-1",
                      asked && "bg-amber-50 text-center font-bold text-amber-800"
                    )}
                  >
                    {asked ? "answer" : (row[colIndex] ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}