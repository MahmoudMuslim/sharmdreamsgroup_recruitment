"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Library,
  List,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import { FormMessage } from "@/modules/analytics/presentation/Form";
import { Button, Card, EmptyState } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import { QuestionEditorDrawer } from "@/app/(admin)/assessments/QuestionEditorDrawer";
import { BankColumns } from "./BankColumns";
import { BankRow } from "./BankRow";
import { BankToolbar } from "./BankToolbar";
import { GateQuestionDrawer, type GateDrawerOpen, type JobChoice } from "./GateQuestionDrawer";
import {
  DEFAULT_BANK_VIEW,
  bankEntries,
  bankEntryQuestions,
  bankScopeKey,
  bankSuiteRowsByTemplate,
  bankViewSearch,
  filterBankQuestions,
  isBankViewFiltered,
  readBankViewState,
  type BankOutcome,
  type BankViewState,
  type BankWrites,
} from "./bankView";
import {
  copyBankQuestion,
  deleteBankSuiteQuestion,
  deleteGateQuestion,
  moveBankQuestionToPlace,
  moveGateQuestion,
  setGateQuestionActive,
  type BankData,
} from "./actions";
import {
  BANK_STORE_RAILS,
  SHARED_SCOPE,
  bankColumns,
  bankOpenPlaces,
  bankOrders,
  bankPlaceScope,
  bankScopeChoices,
  countBankRails,
  groupBankQuestions,
  type BankStore,
  type BankTarget,
} from "@/modules/questions/bank";

/**
 * The global question bank: both stores' questions in one place, with the editing
 * the two consoles used to keep apart.
 *
 * This screen owns no table. A form question is a row in `application_gate_questions`
 * and a test question is a row in `assessment_questions`, and every control here
 * writes one of those rows through the action that owns it — so the validation, the
 * permission and the change trail are the same whichever door a recruiter used. The
 * apply-form console that used to be a page of its own lives in this tab now, which
 * is why the wording of a question can be changed where its whole set is read.
 *
 * Two views of one set: a list, grouped any way the recruiter asks, and a board of
 * the places that ask the questions. The board takes one store at a time because a
 * column has to mean one thing — see `bankColumns`.
 */

/** One write's answer, whatever shape the action that produced it used. */
type WriteResult = { ok: boolean; error?: string };

const NOT_ANSWERED = "The portal did not answer, so nothing was written.";

export function BankBoard({ data }: { data: BankData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [gateOpen, setGateOpen] = useState<GateDrawerOpen | null>(null);
  const [suiteEditor, setSuiteEditor] = useState<{
    templateId: string;
    openAtId: string | null;
  } | null>(null);

  /* ------------------------------------------------------------------ the bank */

  const entries = useMemo(
    () => bankEntries(data.gate, data.suite, data.places),
    [data.gate, data.suite, data.places]
  );
  const questions = useMemo(() => bankEntryQuestions(entries), [entries]);
  const entriesByKey = useMemo(
    () => new Map(entries.map((entry) => [entry.question.key, entry])),
    [entries]
  );
  /** The rows the suite's own editor is opened with — it writes them, not the projections. */
  const suiteRowsByTemplate = useMemo(
    () => bankSuiteRowsByTemplate(data.suite),
    [data.suite]
  );

  const knownScopes = useMemo(
    () => new Set(questions.map(bankScopeKey)),
    [questions]
  );

  /*
   * The rails, the place filter, the grouping and the view all come from the
   * address bar, not local state, for the reason every other board in the portal
   * gives: the lit chip, the rows under it and the link a recruiter pastes into a
   * chat have to describe one set.
   */
  const view = useMemo(
    () => readBankViewState(params, knownScopes),
    [params, knownScopes]
  );

  // `?q=` seeds the box; the words stay local while typing and enter the URL when
  // the next rail is clicked. Typing wins until the address bar itself changes.
  const [query, setQuery] = useState(view.query);
  const [lastAppliedQuery, setLastAppliedQuery] = useState(view.query);
  if (view.query !== lastAppliedQuery) {
    setLastAppliedQuery(view.query);
    setQuery(view.query);
  }

  const activeView = useMemo<BankViewState>(() => ({ ...view, query }), [view, query]);
  const filtered = isBankViewFiltered(activeView);

  const counts = useMemo(() => countBankRails(questions), [questions]);
  const scopeChoices = useMemo(() => bankScopeChoices(questions), [questions]);
  const orders = useMemo(() => bankOrders(questions), [questions]);

  /** The rows the view leaves standing, kept as entries because the controls write rows. */
  const visible = useMemo(() => {
    const shown = new Set(
      filterBankQuestions(questions, activeView).map((question) => question.key)
    );
    return entries.filter((entry) => shown.has(entry.question.key));
  }, [entries, questions, activeView]);

  const visibleQuestions = useMemo(() => bankEntryQuestions(visible), [visible]);

  const groups = useMemo(
    () => groupBankQuestions(visibleQuestions, view.group),
    [visibleQuestions, view.group]
  );

  const jobPlaces = useMemo(() => bankOpenPlaces(data.places, "gate"), [data.places]);
  const suitePlaces = useMemo(() => bankOpenPlaces(data.places, "suite"), [data.places]);
  const jobChoices = useMemo<JobChoice[]>(
    () => jobPlaces.map((place) => ({ id: place.id, label: place.label })),
    [jobPlaces]
  );

  const boardStore: BankStore | null =
    view.store && view.mode === "board" ? view.store : null;

  const columns = useMemo(() => {
    if (!boardStore) return [];
    return bankColumns(
      boardStore,
      visibleQuestions,
      data.places,
      boardStore === "gate" ? data.can.form : data.can.suites
    );
  }, [boardStore, visibleQuestions, data.places, data.can]);

  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  /**
   * Reordering, and when the bank may offer it.
   *
   * Up and down swap a form question with the neighbour the apply form actually
   * asks next — within its own scope, whether or not this view shows that neighbour.
   * So the arrows only answer while the list holds a scope group complete and in
   * form order: grouped by place, with nothing filtered out. A test question's order
   * is not swapped here at all, because the suite's own editor is what re-deals the
   * paper.
   */
  const canReorder = !filtered && view.group === "place" && view.mode === "list";

  /* ------------------------------------------------------------------ the view */

  function writeView(patch: Partial<BankViewState>) {
    const next = { ...activeView, ...patch };
    // A board is one store's places, so a picked place would leave every other
    // column drawn empty beside it; switching to the board lets the places go.
    if (patch.mode === "board") next.scope = "";
    const search = bankViewSearch(next);
    // `history.replaceState`, not a router push: this build patches it so
    // `useSearchParams` re-renders while the rows already on the client do the
    // filtering. A filter is a view of loaded questions, not a new question to the
    // database, and Back should leave the page instead of replaying chips.
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
    setError(null);
    setNotice(null);
  }

  /* ------------------------------------------------------------------- writes */

  const apply = useCallback(
    async (write: () => Promise<WriteResult>, done: string): Promise<boolean> => {
      setError(null);
      setNotice(null);
      setPending(true);
      try {
        const result = await write();
        if (result.ok) {
          setNotice(done);
          // The list comes from the database rather than local state, so a saved
          // question shows up in the order the server put it.
          router.refresh();
        } else {
          setError(result.error ?? "That change could not be saved.");
        }
        return result.ok;
      } catch {
        setError(NOT_ANSWERED);
        return false;
      } finally {
        setPending(false);
      }
    },
    [router]
  );

  /** Both long writes answer with the sentence to print, or the reason they refused. */
  const outcomeOf = useCallback(
    (result: WriteResult & { moved?: string; landed?: string }): BankOutcome => {
      if (!result.ok) return { ok: false, message: result.error ?? NOT_ANSWERED };
      const message = result.moved ?? result.landed ?? "Written.";
      setNotice(message);
      router.refresh();
      return { ok: true, message };
    },
    [router]
  );

  const writes = useMemo<BankWrites>(
    () => ({
      editGate: (row) => {
        setError(null);
        setNotice(null);
        setGateOpen({ mode: "edit", question: row });
      },
      editSuite: (row) => {
        setError(null);
        setNotice(null);
        setSuiteEditor({ templateId: row.template_id, openAtId: row.id });
      },
      toggleActive: (row) => {
        void apply(
          () => setGateQuestionActive(row.id, !row.isActive),
          row.isActive ? "Question is no longer asked." : "Question is asked again."
        );
      },
      remove: (question) => {
        const entry = entriesByKey.get(question.key);
        if (!entry) return;
        if (entry.store === "gate") {
          // Deleting cannot un-answer a question that has already been put to
          // somebody, because the answer is stored as text on the application.
          if (
            !window.confirm(
              `Stop asking “${question.text}”?\n\n` +
                "Applications that already answered it keep their answers and their stage."
            )
          ) {
            return;
          }
          void apply(() => deleteGateQuestion(entry.row.id), "Question deleted.");
          return;
        }
        if (
          !window.confirm(
            `Delete “${entry.row.title}” from “${placeLabel(data.places, entry.row.template_id, "suite")}”?\n\n` +
              "Once a candidate has answered it the suite refuses the delete, because their paper would point at nothing."
          )
        ) {
          return;
        }
        void apply(
          () => deleteBankSuiteQuestion(entry.row.id, entry.row.template_id),
          "Question deleted from the suite."
        );
      },
      move: (row, direction) => {
        void apply(() => moveGateQuestion(row.id, direction), "Order updated.");
      },
      relocate: async (question, columnKey) => {
        setPending(true);
        setError(null);
        setNotice(null);
        try {
          const placeKey = bankPlaceScope(columnKey);
          const result =
            question.store === "gate"
              ? await moveBankQuestionToPlace({ store: "gate", id: question.id, placeKey })
              : await copyBankQuestion({
                  store: "suite",
                  id: question.id,
                  target: "suite",
                  placeKey,
                });
          return outcomeOf(result);
        } catch {
          setError(NOT_ANSWERED);
          return { ok: false, message: NOT_ANSWERED };
        } finally {
          setPending(false);
        }
      },
      copy: async (question, target: BankTarget) => {
        setPending(true);
        setError(null);
        setNotice(null);
        try {
          const result = await copyBankQuestion({
            store: question.store,
            id: question.id,
            target: target.store,
            placeKey: target.placeKey,
          });
          return outcomeOf(result);
        } catch {
          setError(NOT_ANSWERED);
          return { ok: false, message: NOT_ANSWERED };
        } finally {
          setPending(false);
        }
      },
      pending,
      places: { jobs: jobPlaces, suites: suitePlaces },
      can: data.can,
    }),
    [
      pending,
      data.can,
      data.places,
      entriesByKey,
      jobPlaces,
      suitePlaces,
      apply,
      outcomeOf,
    ]
  );

  function addGate(scopeKey?: string) {
    setError(null);
    setNotice(null);
    setGateOpen({
      mode: "new",
      jobId: scopeKey && scopeKey !== SHARED_SCOPE ? scopeKey : null,
    });
  }

  function addSuite(templateId: string) {
    setError(null);
    setNotice(null);
    setSuiteEditor({ templateId, openAtId: null });
  }

  /** The role an edited form question is asked on, for the drawer's own option. */
  const heldLabel =
    gateOpen && gateOpen.mode === "edit" && gateOpen.question.jobId
      ? placeLabel(data.places, gateOpen.question.jobId, "gate")
      : null;

  function toggleGroup(key: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* -------------------------------------------------------------------- view */

  const board = boardStore !== null;

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Library className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-dark" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">What this page is</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-brand-ink/65">
              <li>
                It holds both kinds of question the portal stores: the no-points ones a candidate
                answers on the apply form, and the marked ones inside a test suite. Nothing else is
                a question here — interview questions are never stored, and a CV screening prompt is
                not asked of a candidate.
              </li>
              <li>
                It owns no table of its own, so there is no third list of questions to keep in step
                by hand. Add, rewrite, reorder, switch off and delete all write a real row in one of
                the two stores, under that store&apos;s own rules and on the change trail.
              </li>
              <li>
                A form question is edited in the drawer on this page. A test question opens the
                suite&apos;s own editor, because its answer set, its marks, its brief or its
                spreadsheet grid are columns only that editor writes.
              </li>
              <li>
                Changing one question changes every role or suite that asks it, because it is the
                same row. To ask the same words somewhere else without sharing them, copy it —
                the copy is a new row that can be reworded and deleted on its own.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {view.store === "gate" && (
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-dark" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold">What the apply-form questions do</h2>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-brand-ink/65">
                <li>
                  They carry no points and are not part of the assessment. Each one is a requirement
                  the applicant answers about themselves.
                </li>
                <li>
                  An answer marked <strong>Rules out</strong> rejects the application the moment it is
                  submitted: it is stored as Rejected, with the question and the answer recorded as
                  the reason, and the AI screening step is skipped.
                </li>
                <li>
                  The candidate is never told an answer decided it. They get the same “application
                  received” screen as everyone else, then the standard rejection letter — the same
                  words a rejection you close by hand sends, and it names no question. What they
                  cannot see, they cannot answer their way around.
                </li>
                <li>
                  Candidates see the question and its possible answers. Which answer the role accepts
                  is never sent to their browser — it is scored on the server.
                </li>
                <li>
                  An applicant turned down this way can apply again; the rejection does not block
                  them.
                </li>
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which questions">
          {BANK_STORE_RAILS.map((rail) => {
            const active = view.store === rail.key;
            return (
              <button
                key={rail.key || "everywhere"}
                type="button"
                role="tab"
                id={`bank-tab-${rail.key || "all"}`}
                aria-selected={active}
                aria-controls="bank-panel"
                onClick={() => writeView({ store: rail.key })}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "bg-brand-ink text-brand-cream shadow-soft"
                    : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                {rail.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    active ? "bg-brand-cream/20" : "bg-brand-sand text-brand-ink/55"
                  )}
                >
                  {counts.get(rail.key) ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="How to show them">
          {(["list", "board"] as const).map((mode) => {
            const active = view.mode === mode && (mode === "list" || view.store !== "");
            const blocked = mode === "board" && view.store === "";
            return (
              <button
                key={mode}
                type="button"
                disabled={blocked}
                title={
                  blocked
                    ? "The board is one store's places, so pick the apply form or a test suite first."
                    : undefined
                }
                aria-pressed={active}
                onClick={() => writeView({ mode })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "bg-brand-ink text-brand-cream shadow-soft"
                    : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                {mode === "list" ? (
                  <List className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                )}
                {mode === "list" ? "List" : "Board"}
              </button>
            );
          })}
        </div>
      </div>

      <BankToolbar
        view={activeView}
        counts={counts}
        scopeChoices={scopeChoices}
        total={questions.length}
        shown={visible.length}
        filtered={filtered}
        canReorder={canReorder}
        can={data.can}
        suiteChoices={suitePlaces}
        onQuery={setQuery}
        onPatch={writeView}
        onClear={() => {
          setError(null);
          setNotice(null);
          setQuery("");
          writeView(DEFAULT_BANK_VIEW);
        }}
        onAddGate={() => addGate()}
        onAddSuite={addSuite}
      />

      <div
        id="bank-panel"
        role="tabpanel"
        aria-labelledby={`bank-tab-${view.store || "all"}`}
        className="space-y-6"
      >
        <FormMessage error={error} success={notice} />

        {entries.length === 0 ? (
          <Card>
            <EmptyState
              title="No questions written yet"
              description="Neither store has a question: no one has asked anything on an apply form, and no test suite holds one. Add them from the controls above, and they appear here."
              icon={<Library className="h-8 w-8" aria-hidden />}
            />
          </Card>
        ) : board && boardStore ? (
          <BankColumns
            store={boardStore}
            columns={columns}
            entries={entriesByKey}
            writes={writes}
            onAdd={(scopeKey) => {
              if (boardStore === "gate") addGate(scopeKey);
              else addSuite(scopeKey);
            }}
          />
        ) : visible.length === 0 ? (
          <Card>
            <EmptyState
              title="No question matches"
              description="Nothing in the bank carries those words, or sits in the surface, kind, place, live state or answer effect you picked. The tabs and the rails count every question the portal holds, so clearing them brings the rest back."
              icon={<SearchX className="h-8 w-8" aria-hidden />}
            />
            <div className="flex justify-center pb-8">
              <Button variant="outline" size="sm" onClick={() => writeView(DEFAULT_BANK_VIEW)}>
                Clear the filters
              </Button>
            </div>
          </Card>
        ) : (
          groups.map((group) => {
            const isClosed = group.key !== "" && closed.has(group.key);

            return (
              <section key={group.key || "bank"}>
                {group.label && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isClosed}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink/45 transition hover:text-brand-ink"
                    >
                      {isClosed ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {group.label}
                      <span className="rounded-full bg-brand-sand px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand-ink/55">
                        {group.rows.length}
                      </span>
                    </button>
                    {!isClosed && groupHeadingAdd(group, data.can) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (group.key.startsWith("gate:")) addGate(bankPlaceScope(group.key));
                          else addSuite(bankPlaceScope(group.key));
                        }}
                        className="text-[11px] font-bold text-brand-ink/45 underline transition hover:text-brand-ink"
                      >
                        Add one here
                      </button>
                    )}
                  </div>
                )}
                {!isClosed && (
                  <div className="space-y-2">
                    {group.rows.map((question, index) => {
                      const entry = entriesByKey.get(question.key);
                      if (!entry) return null;
                      return (
                        <BankRow
                          key={question.key}
                          entry={entry}
                          order={orders.get(question.key) ?? index + 1}
                          isFirst={index === 0}
                          isLast={index === group.rows.length - 1}
                          canReorder={canReorder}
                          writes={writes}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {/* --------------------------------------------------------------- drawers */}
      {gateOpen && (
        <GateQuestionDrawer
          key={gateOpen.mode === "edit" ? gateOpen.question.id : `new:${gateOpen.jobId ?? ""}`}
          open
          initial={gateOpen}
          jobs={jobChoices}
          heldLabel={heldLabel}
          onClose={() => setGateOpen(null)}
          onWritten={(message) => {
            setError(null);
            setNotice(message);
            router.refresh();
          }}
        />
      )}

      {suiteEditor && (
        <QuestionEditorDrawer
          key={`${suiteEditor.templateId}:${suiteEditor.openAtId ?? "new"}`}
          open
          onClose={() => setSuiteEditor(null)}
          templateId={suiteEditor.templateId}
          templateName={placeLabel(data.places, suiteEditor.templateId, "suite")}
          questions={suiteRowsByTemplate.get(suiteEditor.templateId) ?? []}
          editable={data.can.suites}
          situationalAvailable={data.situational.situational}
          situationalNote={data.situational.note}
          codingAvailable={data.situational.coding}
          codingNote={data.situational.codingNote}
          skillOptions={data.skills.skills}
          skillsNote={data.skills.note}
          onChanged={() => router.refresh()}
          openAtId={suiteEditor.openAtId ?? undefined}
        />
      )}
    </div>
  );
}

/** Whether this heading's store is one the account may write into. */
function groupHeadingAdd(group: { key: string }, can: { form: boolean; suites: boolean }) {
  if (group.key.startsWith("gate:")) return can.form;
  if (group.key.startsWith("suite:")) return can.suites;
  return false;
}

/**
 * The name of a place, read off the places the page was given.
 *
 * A row whose place has vanished still has to be named in a confirmation, so the
 * fallback is the fact rather than a uuid — the same wording the bank itself uses.
 */
function placeLabel(
  places: readonly { key: string; label: string }[],
  scopeKey: string,
  store: BankStore
): string {
  const found = places.find((place) => place.key === `${store}:${scopeKey}`);
  if (found) return found.label;
  return store === "gate" ? "a role no longer on file" : "a suite no longer on file";
}
