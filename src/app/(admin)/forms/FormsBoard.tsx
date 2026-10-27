"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Copy,
  ExternalLink,
  FileText,
  Globe2,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  Table,
  X,
} from "lucide-react";
import { Field, FormMessage, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import { Badge, Button, Card, EmptyState, FilterRail } from "@/modules/analytics/presentation/ui";
import { navForward } from "@/modules/shell/domain/navTransition";
import { signalNavigationPending } from "@/modules/shell/presentation/NavigationPending";
import {
  createForm,
  draftWithAI,
  duplicateForm,
  publishForm,
  retireForm,
  type FormMutation,
  type FormsBoardData,
  type FormSummary,
  type FormUsageRead,
} from "@/modules/form-builder/application/formActions";
import {
  BOARD_SORTS,
  BOARD_STATES,
  boardHref,
  countBoardStates,
  filterBoardRows,
  formUsageHref,
  parseBoardView,
  sortBoardRows,
  stateOfForm,
  type BoardSort,
  type BoardState,
  type BoardView,
} from "@/modules/form-builder/domain/formBoard";
import { cn } from "@/lib/utils";

/**
 * The board (`/forms`, spec §6): every application form in the estate, in the
 * three states a form can be in, with the writes that move it between them.
 *
 * Two drawings of one set. **Board** is a column per state, because a form's state
 * is decided by a door — publish checks the whole composition against every opening
 * that would ask it, and retire is terminal — so there is nothing to drag. **List**
 * is the same rows as rows, which is the drawing that answers "how many questions
 * does each of these hold, and when did it last change" across the whole estate at
 * once. Both read the same search, the same rail and the same order from the
 * address, and both run the same writes: switching the drawing changes nothing else.
 *
 * A card's body and a row's name are the link into `/forms/[id]`, where the
 * questions themselves are written: this page creates, publishes, retires and
 * reads, and never edits a layout.
 *
 * The rail chips count the whole window the page loaded, not what the search left
 * standing — so a chip never promises cards or rows the drawing below cannot show.
 *
 * No `window.confirm` anywhere: a retire is armed inline on the card or the row it
 * retires, because a native dialog blocks the tab in the embedded browser the owner
 * uses.
 */

const NOT_ANSWERED = "The portal did not answer, so nothing was written.";

/** The three states, in the order the board draws its columns. */
const STATE_LABEL: Record<Exclude<BoardState, "all">, string> = {
  draft: "Draft",
  published: "Published",
  retired: "Retired",
};

const STATE_HINT: Record<Exclude<BoardState, "all">, string> = {
  draft: "Written, not asked. A draft can be edited freely and publishes only when its questions pass the identity check.",
  published: "Asked on the openings it is assigned to, and on every application if it is global.",
  retired: "Off the list a recruiter can assign. Applications already filed keep the questions they answered.",
};

const STATE_EMPTY: Record<Exclude<BoardState, "all">, string> = {
  draft: "No draft forms.",
  published: "No published forms.",
  retired: "Nothing retired.",
};

const STATE_TONE: Record<Exclude<BoardState, "all">, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  published: "success",
  retired: "danger",
};

const SORT_LABEL: Record<BoardSort, string> = {
  named: "Name A–Z",
  recent: "Changed last",
  questions: "Most questions",
  roles: "Asked on most roles",
};

/**
 * A form's usage figure, in the words a recruiter reads.
 *
 * The count is applications whose filed snapshot named this form — not the
 * openings it is assigned to, which is a plan and not a use. The basis is
 * printed once in the footer rather than on every card, because the read behind
 * every figure on this board is the same read.
 */
function usageCount(usage: FormUsageRead, formId: string): string {
  const count = usage.byForm[formId]?.applications ?? 0;
  if (count === 0) return "no application filed";
  return `${count.toLocaleString()} application${count === 1 ? "" : "s"} filed`;
}

/** The report the figure came from, opened on this form's rows. */
function usageHrefTitle(name: string): string {
  return `Open every application filed against “${name}” as a report, in CSV, Excel or PDF`;
}

const SURFACES: readonly { value: BoardView["surface"]; label: string; icon: typeof Table; hint: string }[] = [
  {
    value: "board",
    label: "Board",
    icon: LayoutGrid,
    hint: "A column per state — the three doors a form moves through",
  },
  {
    value: "list",
    label: "List",
    icon: Table,
    hint: "Every form as a row, with its state, questions and openings side by side",
  },
];

export function FormsBoard({ data }: { data: FormsBoardData }) {
  const router = useRouter();
  const params = useSearchParams();

  /**
   * The view, read off the address.
   *
   * Parsed from the query string rather than kept in local state, so the assistant's
   * link, a bookmark and the Guide all land on the surface, the rail, the order and
   * the words a recruiter had typed — and so no control can reset another, because
   * each one names the whole view.
   */
  const qs = params.toString();
  const view = useMemo(() => parseBoardView(new URLSearchParams(qs)), [qs]);

  /** The words in the box — only a submit writes them, so typing pushes no screen per key. */
  const [typed, setTyped] = useState(view.q);

  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "", isGlobal: false });
  const [draftBrief, setDraftBrief] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Every refusal the last write answered with, and the control that pressed it. */
  const [refused, setRefused] = useState<{ label: string; issues: string[] } | null>(null);
  /** The card or row whose retire is armed, so only one can ask at a time. */
  const [retiringId, setRetiringId] = useState<string | null>(null);

  const go = useCallback(
    (next: BoardView) => {
      signalNavigationPending();
      router.push(boardHref(next));
    },
    [router],
  );

  const clearMessages = () => {
    setError(null);
    setNotice(null);
    setRefused(null);
  };

  const write = useCallback(
    async (
      id: string | null,
      label: string,
      run: () => Promise<FormMutation>,
      done: (result: FormMutation) => string,
    ) => {
      clearMessages();
      setRetiringId(null);
      setPending(id ?? label);
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error ?? NOT_ANSWERED);
          setRefused({ label, issues: result.issues ?? [] });
          return;
        }
        setNotice(done(result));
        router.refresh();
      } catch {
        setError(NOT_ANSWERED);
      } finally {
        setPending(null);
      }
    },
    [router],
  );

  const submitCreate = () =>
    write(
      "create",
      "Create",
      () =>
        createForm({
          name: createDraft.name,
          description: createDraft.description,
          isGlobal: createDraft.isGlobal,
        }),
      () =>
        `Created “${createDraft.name.trim()}” as a draft${
          createDraft.isGlobal ? ", asked on every open role" : ""
        }. Open its card to write the questions.`,
    );

  /** The model's refusals stay on the screen: an omitted question is a decision the recruiter has to see. */
  const submitDraft = () =>
    write(
      "draft",
      "Draft with AI",
      () =>
        draftWithAI({
          name: createDraft.name,
          description: createDraft.description,
          isGlobal: createDraft.isGlobal,
          prompt: draftBrief,
        }),
      (result) => result.note ?? "The questions are drafted and stored as a draft.",
    );

  const publish = (form: FormSummary) =>
    write(
      form.id,
      "Publish",
      () => publishForm(form.id),
      (result) =>
        `“${form.name}” is published as version ${result.version ?? form.version + 1}.`,
    );

  const retire = (form: FormSummary) =>
    write(form.id, "Retire", () => retireForm(form.id), () => `Retired “${form.name}”.`);

  /**
   * The copy lands as its own draft with the same questions and no opening
   * assigned, so it can be rewritten before it is ever put in front of an
   * applicant. `duplicateForm` writes the trail entry and answers with what
   * actually stored, which is what the notice repeats.
   */
  const duplicate = (form: FormSummary) =>
    write(
      form.id,
      "Copy",
      () => duplicateForm(form.id),
      (result) => result.note ?? `Copied “${form.name}” as a draft.`,
    );

  const armRetire = (id: string) => {
    clearMessages();
    setRetiringId(id);
  };

  const counts = countBoardStates(data.forms);
  const rows = sortBoardRows(filterBoardRows(data.forms, view), view.sort);

  const columns: readonly Exclude<BoardState, "all">[] =
    view.state === "all" ? BOARD_STATES : [view.state];

  const filtered = rows.length !== data.forms.length;

  return (
    <div className="space-y-4">
      <FormMessage error={error} success={notice} />

      {refused && refused.issues.length > 0 && (
        <Card className="border-rose-200 bg-rose-50/70 p-4">
          <p className="text-xs font-bold text-rose-700">
            {refused.label} was refused — every reason is listed:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-rose-800">
            {refused.issues.map((issue, index) => (
              <li key={`${index}-${issue}`}>{issue}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------------------ create */}
      {data.canWrite &&
        (showCreate ? (
          <Card className="p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
              New form
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" htmlFor="new-form-name" required>
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
              <label className="flex items-start gap-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2 text-xs md:mt-6">
                <input
                  type="checkbox"
                  checked={createDraft.isGlobal}
                  onChange={(event) =>
                    setCreateDraft({ ...createDraft, isGlobal: event.target.checked })
                  }
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-gold-dark"
                />
                <span>
                  <span className="font-bold">Ask it on every open role</span>
                  <span className="block text-[10px] leading-relaxed text-brand-ink/45">
                    A global form joins every application, before any form assigned to the
                    opening, and cannot be assigned by hand.
                  </span>
                </span>
              </label>
            </div>
            <Field label="Description for recruiters" htmlFor="new-form-description" className="mt-3">
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
            <Field label="Draft the questions with AI" htmlFor="new-form-brief" className="mt-3">
              <TextArea
                id="new-form-brief"
                value={draftBrief}
                rows={3}
                maxLength={1500}
                onChange={(event) => setDraftBrief(event.target.value)}
                className="text-xs"
                placeholder="The role and what a recruiter needs to judge — e.g. front-desk agent: hotel systems, shift availability, languages spoken"
              />
            </Field>
            <p className="mt-2 text-[10px] leading-relaxed text-brand-ink/40">
              The name and description come from this panel. The AI writes only the questions,
              keeps name, email, phone, CV, LinkedIn and About, and leaves the result as a draft
              in the column below — nothing is asked of a candidate until you publish it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending !== null || createDraft.name.trim().length < 2}
                onClick={submitCreate}
              >
                {pending === "create" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                Create empty
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  pending !== null ||
                  createDraft.name.trim().length < 2 ||
                  draftBrief.trim().length < 20
                }
                onClick={submitDraft}
              >
                {pending === "draft" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                Draft the questions with AI
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending !== null}
                onClick={() => {
                  setShowCreate(false);
                  clearMessages();
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New form
          </Button>
        ))}

      {/* ------------------------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go({ ...view, q: typed.trim() });
          }}
          className="relative min-w-[220px] flex-1"
          role="search"
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
            aria-hidden
          />
          <input
            id="forms-search"
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search names and descriptions"
            aria-label="Search forms"
            className="w-full rounded-xl border border-brand-line bg-white py-2 pl-10 pr-3 text-sm focus:border-brand-gold focus:outline-none"
          />
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        {(view.q !== "" || typed.trim() !== "") && (
          <button
            type="button"
            onClick={() => {
              setTyped("");
              go({ ...view, q: "" });
            }}
            title="Drop the words and show the whole window again."
            className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-2.5 py-2 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        )}

        <select
          value={view.sort}
          onChange={(event) => go({ ...view, sort: event.target.value as BoardSort })}
          aria-label="Order the forms"
          title="The order both drawings use. Every tie ends at the form's id, so a reload cannot shuffle it."
          className="rounded-xl border border-brand-line bg-white px-3 py-2 text-sm focus:border-brand-gold focus:outline-none"
        >
          {BOARD_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABEL[sort]}
            </option>
          ))}
        </select>

        <span
          className="text-xs text-brand-ink/50"
          title="Forms on this page, out of the window the board loaded. The chips count the whole window."
        >
          {rows.length} of {data.forms.length} listed
        </span>

        {/* Which drawing the rails' rows are shown in. Both read the same search,
            rail and order, so this changes only the drawing — and the same writes. */}
        <div className="flex items-center gap-1" role="group" aria-label="Choose how the forms are drawn">
          {SURFACES.map((surface) => (
            <button
              key={surface.value}
              type="button"
              onClick={() => go({ ...view, surface: surface.value })}
              aria-pressed={view.surface === surface.value}
              title={surface.hint}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition",
                view.surface === surface.value
                  ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                  : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand",
              )}
            >
              <surface.icon className="h-3.5 w-3.5" aria-hidden />
              {surface.label}
            </button>
          ))}
        </div>
      </div>

      {/* The rail. On the board a lit state leaves one column standing; on the list
          it leaves the rows of that state. */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...BOARD_STATES] as const).map((state) => (
          <FilterRail
            key={state}
            label={state === "all" ? "Every form" : STATE_LABEL[state]}
            count={counts[state]}
            active={view.state === state}
            tone="muted"
            onClick={() => go({ ...view, state })}
          />
        ))}
      </div>

      {/* ------------------------------------------------------------ the set */}
      {data.forms.length === 0 ? (
        <Card>
          <EmptyState
            title="No form yet"
            description={
              data.canWrite
                ? "Create the first form, then open it and drag in the questions a candidate should answer."
                : "A recruiter with the Manage jobs permission writes the first form."
            }
            icon={<Sparkles className="h-6 w-6" aria-hidden />}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="space-y-3">
          <EmptyState
            title="Nothing matches"
            description={`None of the ${data.forms.length} form${
              data.forms.length === 1 ? "" : "s"
            } the board loaded carry those words, or sit in that state. The chips count the whole window, so clearing them brings the rest back.`}
            icon={<Search className="h-6 w-6" aria-hidden />}
          />
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTyped("");
                go({ ...view, q: "", state: "all" });
              }}
            >
              Show every form
            </Button>
          </div>
        </Card>
      ) : view.surface === "list" ? (
        <FormList
          rows={rows}
          canWrite={data.canWrite}
          pending={pending}
          retiringId={retiringId}
          usage={data.usage}
          onRetireArmed={armRetire}
          onCancelRetire={() => setRetiringId(null)}
          onPublish={publish}
          onConfirmRetire={retire}
          onDuplicate={duplicate}
        />
      ) : (
        <div
          className="board-cols flex gap-3 overflow-x-auto pb-2"
          tabIndex={0}
          aria-label="Forms by state. Scroll sideways to see every column."
        >
          {columns.map((state) => {
            const columnRows = rows.filter((row) => stateOfForm(row) === state);
            return (
              <section
                key={state}
                className="board-in flex w-[300px] shrink-0 flex-col gap-2 rounded-2xl border border-brand-line bg-brand-cream/60 p-2.5"
              >
                <header className="flex items-baseline justify-between gap-2 px-1">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/55">
                    {STATE_LABEL[state]}
                  </h2>
                  <span
                    className="text-[11px] font-semibold text-brand-ink/45"
                    title={
                      filtered
                        ? `Cards drawn here after the search — the chip above counts every ${STATE_LABEL[state].toLowerCase()} form the board loaded.`
                        : `Forms in this column.`
                    }
                  >
                    {columnRows.length}
                  </span>
                </header>
                <p className="px-1 text-[10px] leading-relaxed text-brand-ink/45">
                  {STATE_HINT[state]}
                </p>

                {columnRows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-brand-line px-3 py-6 text-center text-[11px] leading-relaxed text-brand-ink/40">
                    {STATE_EMPTY[state]}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {columnRows.map((form) => (
                      <FormCard
                        key={form.id}
                        form={form}
                        canWrite={data.canWrite}
                        pending={pending === form.id}
                        retiring={retiringId === form.id}
                        usage={data.usage}
                        onRetireArmed={() => armRetire(form.id)}
                        onCancelRetire={() => setRetiringId(null)}
                        onPublish={() => publish(form)}
                        onRetire={() => retire(form)}
                        onDuplicate={duplicate}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-brand-ink/50">
        {data.forms.length} form{data.forms.length === 1 ? "" : "s"} loaded
        {filtered && `, ${rows.length} shown by the chips and the words`}
        . Tap a card or a row to write its questions; publishing and retiring are on both
        drawings, and both check the same rules the form&apos;s own page runs.
        {data.usage ? (
          <span className="block">
            {data.usage.basis === "view"
              ? "The figure beside each form counts every application whose filed snapshot named it, from the usage view (migration 045)."
              : data.usage.capped
                ? `The figure beside each form is counted over the newest ${data.usage.read.toLocaleString()} applications only: the usage view (migration 045) is not on this database yet, so for a form whose older applications fall outside that window this is a floor, not a total.`
                : `The figure beside each form is counted over all ${data.usage.read.toLocaleString()} applications read: the usage view (migration 045) is not on this database yet.`}
          </span>
        ) : data.usageNote ? (
          <span className="block">{data.usageNote}</span>
        ) : null}
        {(data.formsAtCap || data.jobsAtCap) && (
          <span className="block">
            {data.formsAtCap &&
              "The form read is bounded and its window is full, so a form outside it is not on this board — open it by its address or find it on the form's own page. "}
            {data.jobsAtCap &&
              "The opening read is bounded and its window is full, so the openings named on a card are drawn from that bounded list."}
          </span>
        )}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The list drawing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The same rows as a table.
 *
 * The columns are the four facts a recruiter compares across the estate — state,
 * questions, where it is asked, and when it last changed — and the version and the
 * description are carried in the name cell, because a row is a form and both belong
 * to it. The writes are the board's, unchanged: publish, and a retire armed inside
 * the row it retires.
 */
function FormList({
  rows,
  canWrite,
  pending,
  retiringId,
  usage,
  onRetireArmed,
  onCancelRetire,
  onPublish,
  onConfirmRetire,
  onDuplicate,
}: {
  rows: FormSummary[];
  canWrite: boolean;
  pending: string | null;
  retiringId: string | null;
  usage: FormUsageRead | null;
  onRetireArmed: (id: string) => void;
  onCancelRetire: () => void;
  onPublish: (form: FormSummary) => void;
  onConfirmRetire: (form: FormSummary) => void;
  onDuplicate: (form: FormSummary) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
            <tr>
              <th className="px-4 py-3">Form</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Questions</th>
              <th className="px-4 py-3">Applications</th>
              <th className="px-4 py-3">Asked on</th>
              <th className="px-4 py-3">Changed</th>
              <th className="px-4 py-3 text-right">Desk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-line">
            {rows.map((form) => {
              const state = stateOfForm(form);
              const retired = state === "retired";
              return (
                <tr key={form.id} className="align-top transition hover:bg-brand-cream">
                  <td className="px-4 py-3">
                    <Link
                      href={`/forms/${form.id}`}
                      transitionTypes={navForward}
                      className="font-semibold hover:text-brand-gold-dark hover:underline"
                      title={`Write the questions “${form.name}” asks`}
                    >
                      {form.name}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {form.isGlobal && (
                        <Badge tone="gold">
                          <Globe2 className="mr-1 inline h-3 w-3" aria-hidden />
                          Every role
                        </Badge>
                      )}
                      <span className="text-[11px] tabular-nums text-brand-ink/45">
                        version {form.version}
                      </span>
                    </p>
                    <p className="mt-1 max-w-md text-[11px] leading-relaxed text-brand-ink/50">
                      {form.description || "No description. The description is for recruiters."}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-brand-ink/65">
                    {form.fieldCount} question{form.fieldCount === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-brand-ink/65">
                    <Link
                      href={formUsageHref(form.id)}
                      className="font-semibold hover:text-brand-gold-dark hover:underline"
                      title={usageHrefTitle(form.name)}
                    >
                      {usage ? usageCount(usage, form.id) : "Open the report"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-ink/65">
                    {form.isGlobal ? (
                      <span title="A global form joins every application, before any form assigned to the opening.">
                        Every open role
                      </span>
                    ) : (
                      <>
                        <p className="tabular-nums">
                          {form.assignedJobs.length} opening
                          {form.assignedJobs.length === 1 ? "" : "s"}
                        </p>
                        {form.assignedJobs.length > 0 && (
                          <p className="max-w-52 truncate text-[11px] text-brand-ink/45">
                            {form.assignedJobs
                              .slice(0, 2)
                              .map((job) => job.title)
                              .join(", ")}
                            {form.assignedJobs.length > 2
                              ? ` +${form.assignedJobs.length - 2} more`
                              : ""}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] tabular-nums text-brand-ink/55">
                    {new Date(form.updatedAt).toLocaleDateString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    <span className="block text-brand-ink/40">
                      {new Date(form.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Link
                        href={`/forms/${form.id}`}
                        transitionTypes={navForward}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand/60 hover:text-brand-ink"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        Open
                      </Link>
                      {canWrite && form.status === "DRAFT" && !retired && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending !== null}
                          onClick={() => onPublish(form)}
                        >
                          {pending === form.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Send className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Publish
                        </Button>
                      )}
                      {canWrite && !retired && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending !== null}
                          onClick={() => onDuplicate(form)}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                          Copy
                        </Button>
                      )}
                      {canWrite && !retired && (
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() => onRetireArmed(form.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-40"
                        >
                          <Archive className="h-3 w-3" aria-hidden />
                          Retire
                        </button>
                      )}
                      {retired && (
                        <p className="text-right text-[10px] leading-relaxed text-brand-ink/45">
                          Its applications keep the answers they filed.
                        </p>
                      )}
                    </div>

                    {retiringId === form.id && (
                      <RetireAsk
                        form={form}
                        pending={pending === form.id}
                        onCancel={onCancelRetire}
                        onRetire={() => onConfirmRetire(form)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* One card                                                                    */
/* -------------------------------------------------------------------------- */

function FormCard({
  form,
  canWrite,
  pending,
  retiring,
  usage,
  onRetireArmed,
  onCancelRetire,
  onPublish,
  onRetire,
  onDuplicate,
}: {
  form: FormSummary;
  canWrite: boolean;
  pending: boolean;
  retiring: boolean;
  usage: FormUsageRead | null;
  onRetireArmed: () => void;
  onCancelRetire: () => void;
  onPublish: () => void;
  onRetire: () => void;
  onDuplicate: (form: FormSummary) => void;
}) {
  const retired = Boolean(form.archivedAt);
  const href = `/forms/${form.id}`;

  return (
    <li
      className={cn(
        "rounded-xl border border-brand-line bg-white p-3 transition",
        !retired && "hover:border-brand-gold/60 hover:shadow-soft",
        pending && "opacity-60",
      )}
    >
      <Link href={href} transitionTypes={navForward} className="block">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 text-sm font-semibold leading-tight">{form.name}</span>
          {form.isGlobal && (
            <Badge tone="gold">
              <Globe2 className="mr-1 inline h-3 w-3" aria-hidden />
              Every role
            </Badge>
          )}
          {retired && <Badge tone="danger">Retired</Badge>}
        </p>
        <p className="mt-1 text-[11px] tabular-nums text-brand-ink/50">
          {form.fieldCount} question{form.fieldCount === 1 ? "" : "s"} · version {form.version}
          {!form.isGlobal &&
            ` · asked on ${form.assignedJobs.length} opening${
              form.assignedJobs.length === 1 ? "" : "s"
            }`}
          {usage && ` · ${usageCount(usage, form.id)}`}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-brand-ink/55">
          {form.description || "No description. The description is for recruiters."}
        </p>
        {!form.isGlobal && form.assignedJobs.length > 0 && (
          <p className="mt-1 text-[10px] leading-relaxed text-brand-ink/45">
            {form.assignedJobs
              .slice(0, 2)
              .map((job) => job.title)
              .join(", ")}
            {form.assignedJobs.length > 2 ? ` +${form.assignedJobs.length - 2} more` : ""}
          </p>
        )}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-brand-line/70 pt-2">
        <Link
          href={href}
          transitionTypes={navForward}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand/60 hover:text-brand-ink"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          Open
        </Link>

        <Link
          href={formUsageHref(form.id)}
          title={usageHrefTitle(form.name)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand/60 hover:text-brand-ink"
        >
          <FileText className="h-3 w-3" aria-hidden />
          Applications
        </Link>

        {canWrite && form.status === "DRAFT" && !retired && (
          <Button size="sm" variant="outline" disabled={pending} onClick={onPublish}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            Publish
          </Button>
        )}

        {canWrite && !retired && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onDuplicate(form)}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
        )}

        {canWrite && !retired && (
          <button
            type="button"
            disabled={pending}
            onClick={onRetireArmed}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-40"
          >
            <Archive className="h-3 w-3" aria-hidden />
            Retire
          </button>
        )}

        {retired && (
          <p className="text-[10px] leading-relaxed text-brand-ink/45">
            Its applications keep the answers they filed.
          </p>
        )}
      </div>

      {retiring && (
        <RetireAsk form={form} pending={pending} onCancel={onCancelRetire} onRetire={onRetire} />
      )}
    </li>
  );
}

/** The second press a retire needs, printed where the first one happened. */
function RetireAsk({
  form,
  pending,
  onCancel,
  onRetire,
}: {
  form: FormSummary;
  pending: boolean;
  onCancel: () => void;
  onRetire: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
      <p className="text-[11px] leading-relaxed text-rose-800">
        Retire “{form.name}”? It leaves the list of forms that can be assigned, and applications
        already filed keep their answers. This cannot be undone here.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={onRetire}
          className="bg-rose-700 text-white hover:bg-rose-800"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Yes, retire
        </Button>
      </div>
    </div>
  );
}
