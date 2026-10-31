import type { QuestionConfig, QuestionType } from "@/types";
import { gateEffect, type GateEffect, type GateQuestion } from "@/modules/careers/gate-questions";
import { readJudgmentScore } from "@/modules/assessment/domain/situational";

/**
 * The question bank — every question a recruiter has written, wherever it is asked.
 *
 * The portal stores authored questions in exactly two places: `application_gate_questions`,
 * the no-points questions on the public apply form, and `assessment_questions`, the marked
 * questions inside a test suite. This module folds both into one shape so a recruiter can
 * read the whole set at once and move a question from one surface to the other.
 *
 * It owns no table and writes nothing. A copy is carried out by the two authoring actions
 * that already exist (`saveGateQuestion`, `saveQuestion`), which is why the mapping rules
 * below describe what those writers will accept rather than inventing a third set: a target
 * offered here and refused there is a button that only ever errors.
 *
 * Everything here is pure — no React, no database, nothing a browser has to have loaded.
 */

export type BankStore = "gate" | "suite";

/** The five things a question can ask for, across both stores. */
export type BankKind = "choice" | "judgment" | "written" | "spreadsheet" | "video";

export interface BankAnswer {
  /** What the candidate sees as the choice to make. */
  text: string;
  /**
   * On the apply form: this answer keeps the application in the running. In a quiz:
   * this is the right one. A judgment scene has no right answer, so every response
   * is false here and `score` is what ranks them.
   */
  accepted: boolean;
  /**
   * A judgment response's effectiveness, 0–100, or null everywhere else.
   *
   * Carried so a bank row can print the ranking without re-reading `config`. A
   * quiz and a form question leave it null: their answer set is a key, not a scale.
   */
  score: number | null;
}

export interface BankQuestion {
  /** `gate:<id>` or `suite:<id>` — no writer needs guessing which table a uuid belongs to. */
  key: string;
  store: BankStore;
  id: string;
  /** The question as the candidate reads it. */
  text: string;
  /** The guidance under it, or "". */
  guidance: string;
  /** The role, the shared every-role scope, or the suite it belongs to. */
  where: string;
  /** The picker value for `where`: a job id, `shared`, or a template id. */
  scopeKey: string;
  kind: BankKind;
  /**
   * What this answer set does to an application, or null for a question that gates nothing.
   *
   * Only the apply form scores an answer by whether it rules a candidate out, so a test
   * question — whose "accepted" flag means "this is the mark-correct option" — has no
   * effect to name. The rail and the grouping are offered on the form tab for that reason.
   */
  effect: GateEffect | null;
  answers: BankAnswer[];
  acceptedCount: number;
  /** Marks, or null for a question that carries none. */
  points: number | null;
  /** Whether anything can ask it right now — see `bankGateQuestions`. */
  isLive: boolean;
}

/** The shared scope: a question every published role asks. */
export const SHARED_SCOPE = "shared";

export const SHARED_LABEL = "Every published role";

export const KIND_LABELS: Record<BankKind, string> = {
  choice: "Choice",
  judgment: "Situational judgment",
  written: "Written answer",
  spreadsheet: "Spreadsheet model",
  video: "Video pitch",
};

const SUITE_KINDS: Record<QuestionType, BankKind> = {
  MULTIPLE_CHOICE: "choice",
  SITUATIONAL_JUDGMENT: "judgment",
  CASE_STUDY: "written",
  EXCEL_MODEL: "spreadsheet",
  VIDEO_PITCH: "video",
  CODING: "written",
};

/* -------------------------------------------------------------------------- */
/* Reading rows into the bank                                                  */
/* -------------------------------------------------------------------------- */

/** What a place (a role, a suite) is called, and whether it is switched on. */
export interface BankPlace {
  label: string;
  isOpen: boolean;
}

/**
 * Apply-form questions, in the order the form asks them.
 *
 * A question scoped to a role that has since closed is stored, is listed, and is asked by
 * nobody — which is the one fact worth filtering for on a board of questions meant to be
 * reused. `placeOf` answers for `null` with the shared scope, and answers `null` itself for
 * a role that is no longer on file.
 */
export function bankGateQuestions(
  rows: readonly GateQuestion[],
  placeOf: (jobId: string | null) => BankPlace | null
): BankQuestion[] {
  return rows.map((question) => {
    const place = placeOf(question.jobId);
    const label = place?.label ?? "A role no longer on file";
    const askedOn = !place || place.isOpen ? label : `${label} (no longer published)`;

    return {
      key: `gate:${question.id}`,
      store: "gate",
      id: question.id,
      text: question.question,
      guidance: question.helpText ?? "",
      where: askedOn,
      scopeKey: question.jobId ?? SHARED_SCOPE,
      kind: "choice",
      effect: gateEffect(question.options),
      answers: question.options.map((option) => ({
        text: option.label,
        accepted: option.passes,
        score: null,
      })),
      acceptedCount: question.options.reduce((n, option) => n + (option.passes ? 1 : 0), 0),
      points: null,
      isLive: question.isActive && (place?.isOpen ?? false),
    };
  });
}

/**
 * A raw `assessment_questions` row — every column the suite's own editor writes.
 *
 * The bank ships these to the browser rather than a slimmer projection because it
 * is where a question is now edited, and the editor needs the fields a list of
 * questions does not show: the answer set in `config`, the position the suite's
 * up/down arrows swap, and the per-question time limit. `/assessments` already
 * sends the same rows for the same editor.
 */
export interface SuiteQuestionRow {
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

/**
 * Quiz options live in `config.options` as `{ label, text, is_correct }`; a
 * judgment scene's options carry a 0–100 `score` and no correct one.
 *
 * jsonb is whatever a hand edit left in it, so an entry with no readable text is dropped
 * rather than printed — the same rule the apply-form parser follows. A percentage that
 * is not a number in range is left null for the same reason: the row is shown without
 * pretending to know its ranking.
 */
function parseChoiceOptions(value: unknown): BankAnswer[] {
  if (!Array.isArray(value)) return [];
  const answers: BankAnswer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    answers.push({
      text,
      accepted: row.is_correct === true,
      score: readJudgmentScore(row.score),
    });
  }
  return answers;
}

/**
 * Suite questions, and a row whose suite the read did not return is dropped.
 *
 * That happens when a suite is deleted between the two queries the page runs — a paper with
 * no owner is not a question a recruiter can use, and a heading of "(unknown suite)" would
 * read as a bug in the board rather than as a row that vanished.
 */
export function bankSuiteQuestions(
  rows: readonly SuiteQuestionRow[],
  placeOf: (templateId: string) => BankPlace | null
): BankQuestion[] {
  const banked: BankQuestion[] = [];

  for (const row of rows) {
    const place = placeOf(row.template_id);
    if (!place) continue;

    const prompt = row.prompt?.trim() ?? "";
    if (!prompt) continue;

    const kind = SUITE_KINDS[row.question_type] ?? "written";
    const answers =
      kind === "choice" || kind === "judgment" ? parseChoiceOptions(row.config?.options) : [];

    banked.push({
      key: `suite:${row.id}`,
      store: "suite",
      id: row.id,
      text: prompt,
      guidance: row.instructions?.trim() ?? "",
      where: place.isOpen ? place.label : `${place.label} (a paused suite)`,
      scopeKey: row.template_id,
      kind,
      effect: null,
      answers,
      acceptedCount: answers.reduce((n, answer) => n + (answer.accepted ? 1 : 0), 0),
      points: Number.isFinite(row.points) ? row.points : null,
      isLive: place.isOpen,
    });
  }

  return banked;
}

/* -------------------------------------------------------------------------- */
/* Searching                                                                    */
/* -------------------------------------------------------------------------- */

/** What the bank's search box promises to read, in the recruiter's words. */
export function bankSearchWords(): string {
  return "question, guidance, answer, role or suite";
}

/**
 * Keep the questions whose text, guidance, answers or place hold the words.
 *
 * The same case-insensitive substring as every other box in the portal, and an empty box
 * filters nothing.
 */
export function searchBankQuestions(
  rows: readonly BankQuestion[],
  query: string
): BankQuestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];

  return rows.filter((question) => {
    const haystack = [
      question.text,
      question.guidance,
      question.where,
      ...question.answers.map((answer) => answer.text),
    ];
    return haystack.some((value) => value.toLowerCase().includes(q));
  });
}

/* -------------------------------------------------------------------------- */
/* Moving a question from one surface to the other                              */
/* -------------------------------------------------------------------------- */

export interface BankTarget {
  /** Which writer the copy ends up in. */
  store: BankStore;
  /** A job id, `shared` for every published role, or a template id. */
  placeKey: string;
  label: string;
  /** What the copy does to the question, printed beside the target's name. */
  note: string;
}

const VERBATIM_ON_FORM =
  "Asked word for word, with the same answers and the same ones that rule someone out.";
const VERBATIM_IN_SUITE = "Copied as the same kind, with its marks, guidance and answer set.";
const FORM_TO_QUIZ =
  "Becomes a quiz question worth 10 marks: the answer that lets an applicant through is the one marked correct.";
const QUIZ_TO_FORM =
  "Becomes a no-points apply-form question: the correct answer is the one that keeps an application in the running.";

/**
 * The surfaces this question can genuinely be put on.
 *
 * Two of the four mappings are verbatim and always offered — a question stays exactly itself
 * inside its own store. Two cross stores, and each is only legal one way:
 *
 *  • an apply-form question becomes a quiz question only when exactly one of its answers is
 *    accepted, because `saveQuestion` refuses a quiz that does not have one right option;
 *  • a quiz question becomes an apply-form question whenever it has one right option, because
 *    that answer is the gate's accepted one and the form writer's rules (two answers minimum,
 *    at least one accepted) are already satisfied.
 *
 * A question's own place is never a target, so the picker cannot offer to duplicate a question
 * onto the form or suite it is already asked on. A judgment scene is copied suite to suite
 * verbatim, scores and all, but never onto a form: the form's answer set is a pass/fail key
 * and a scene's is a scale, so there is no single accepted answer to carry across.
 */
export function bankTargetsFor(
  question: BankQuestion,
  jobs: readonly { id: string | null; label: string }[],
  suites: readonly { id: string; label: string }[]
): BankTarget[] {
  const shared: { id: string | null; label: string } = { id: null, label: SHARED_LABEL };
  // The scope is filtered out with the roles, so a question already asked by every
  // published role cannot offer to be copied onto every published role again.
  const formPlaces = [shared, ...jobs].filter(
    (job) => (job.id ?? SHARED_SCOPE) !== question.scopeKey
  );
  const suitePlaces = suites.filter((suite) => suite.id !== question.scopeKey);

  if (question.store === "gate") {
    const targets = formPlaces.map(
      (job): BankTarget => ({
        store: "gate",
        placeKey: job.id ?? SHARED_SCOPE,
        label: job.label,
        note: VERBATIM_ON_FORM,
      })
    );
    if (question.acceptedCount === 1) {
      for (const suite of suitePlaces) {
        targets.push({ store: "suite", placeKey: suite.id, label: suite.label, note: FORM_TO_QUIZ });
      }
    }
    return targets;
  }

  const targets: BankTarget[] = suitePlaces.map(
    (suite): BankTarget => ({
      store: "suite",
      placeKey: suite.id,
      label: suite.label,
      note: VERBATIM_IN_SUITE,
    })
  );
  if (question.kind === "choice" && question.acceptedCount === 1) {
    for (const job of formPlaces) {
      targets.push({
        store: "gate",
        placeKey: job.id ?? SHARED_SCOPE,
        label: job.label,
        note: QUIZ_TO_FORM,
      });
    }
  }
  return targets;
}

/**
 * Why this question cannot cross stores, in the recruiter's words, or null when it can.
 *
 * Printed beside a picker that offers only its own kind: "there are no other suites to copy
 * it into" and "a video pitch has no answer to gate an application with" are different facts,
 * and a recruiter who is offered two targets out of nine should be told which two are missing.
 */
export function bankCrossStoreReason(
  question: BankQuestion,
  otherStore: BankStore
): string | null {
  if (otherStore === "suite") {
    if (question.store === "suite") return null;
    if (question.acceptedCount !== 1) {
      return "This form question accepts more than one answer, and a quiz is scored by picking the single right option, so there is nothing here to mark correct.";
    }
    return null;
  }

  if (question.store === "gate") return null;
  if (question.kind === "judgment") {
    return "This is a judgment scene: each response earns a percentage of the marks rather than being right or wrong. The apply form gates an application by which answers rule someone out, so there is no pass/fail key here to copy.";
  }
  if (question.kind !== "choice") {
    return "This asks for a written answer, a spreadsheet or a video. The apply form gates an application by which option was picked, so there is no answer here to mark as ruling someone out.";
  }
  if (question.acceptedCount !== 1) {
    return "This quiz's answers do not leave exactly one to accept, so the apply form could not score it.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Rails, scopes and groups                                                     */
/* -------------------------------------------------------------------------- */

export type BankStoreRail = "" | BankStore;
export type BankKindRail = "" | BankKind;
export type BankLiveRail = "" | "LIVE" | "IDLE";
export type BankEffectRail = "" | GateEffect;
export type BankGroupKey = "place" | "store" | "kind" | "live" | "effect" | "none";

export const BANK_STORE_RAILS = [
  { key: "", label: "Everywhere" },
  { key: "gate", label: "On the apply form" },
  { key: "suite", label: "In a test suite" },
] as const satisfies readonly { key: BankStoreRail; label: string }[];

export const BANK_KIND_RAILS = [
  { key: "", label: "Any kind" },
  { key: "choice", label: KIND_LABELS.choice },
  { key: "judgment", label: KIND_LABELS.judgment },
  { key: "written", label: KIND_LABELS.written },
  { key: "spreadsheet", label: KIND_LABELS.spreadsheet },
  { key: "video", label: KIND_LABELS.video },
] as const satisfies readonly { key: BankKindRail; label: string }[];

export const BANK_LIVE_RAILS = [
  { key: "", label: "Any of them" },
  { key: "LIVE", label: "Asked right now" },
  { key: "IDLE", label: "Nothing asks it now" },
] as const satisfies readonly { key: BankLiveRail; label: string }[];

/**
 * The answer sets, by what they do to an application.
 *
 * Offered on the apply-form tab only: three rails that partition it — a question either has
 * both kinds of answer, only accepting ones, or only ruling-out ones. A test question has
 * no effect to name, so the chips are not shown where they could only ever answer "nothing".
 */
export const BANK_EFFECT_RAILS = [
  { key: "", label: "Any effect" },
  { key: "HARD", label: "Can rule someone out" },
  { key: "SOFT", label: "Cannot rule anyone out" },
  { key: "BLOCKED", label: "Rules out every answer" },
] as const satisfies readonly { key: BankEffectRail; label: string }[];

export interface BankGroupOption {
  key: BankGroupKey;
  label: string;
  /**
   * Whether only the apply-form tab may offer this grouping.
   *
   * Spelled as an annotation rather than `as const` because the flag sits on one entry:
   * a literal tuple would give the others no `gateOnly` property at all, and the picker
   * that filters on it would not compile.
   */
  gateOnly?: boolean;
}

export const BANK_GROUPS: readonly BankGroupOption[] = [
  { key: "place", label: "By where it is asked" },
  { key: "store", label: "By the surface that holds it" },
  { key: "kind", label: "By the kind of answer" },
  { key: "live", label: "By whether anything asks it" },
  { key: "effect", label: "By what the answers do", gateOnly: true },
  { key: "none", label: "One list" },
];

/** The count each rail holds — over the whole bank, not over what the current view left standing. */
export function countBankRails(rows: readonly BankQuestion[]): Map<string, number> {
  const counts = new Map<string, number>([["", rows.length]]);
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const question of rows) {
    bump(question.store);
    bump(question.kind);
    bump(question.isLive ? "LIVE" : "IDLE");
    if (question.effect) bump(question.effect);
  }
  return counts;
}

export interface BankScopeChoice {
  value: string;
  label: string;
  count: number;
}

/**
 * The places that actually hold a question, with how many each holds.
 *
 * Keyed by store as well as place, because a role id and a suite id are both uuids and a
 * picker that mixed them would filter the board by a name from the other half of it.
 */
export function bankScopeChoices(rows: readonly BankQuestion[]): BankScopeChoice[] {
  const byScope = new Map<string, { label: string; count: number }>();

  for (const question of rows) {
    const value = `${question.store}:${question.scopeKey}`;
    const existing = byScope.get(value);
    if (existing) existing.count += 1;
    else byScope.set(value, { label: question.where, count: 1 });
  }

  return [...byScope.entries()]
    .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface BankGroup {
  /** "" is the ungrouped bank — one list, no heading. */
  key: string;
  label: string;
  rows: BankQuestion[];
}

function groupKeyOf(question: BankQuestion, group: BankGroupKey): string {
  switch (group) {
    case "store":
      return question.store;
    case "kind":
      return question.kind;
    case "live":
      return question.isLive ? "LIVE" : "IDLE";
    case "effect":
      return question.effect ?? "NONE";
    default:
      return `${question.store}:${question.scopeKey}`;
  }
}

function groupLabelOf(rows: readonly BankQuestion[], group: BankGroupKey): string {
  const first = rows[0];
  if (!first) return "";
  if (group === "store") return BANK_STORE_RAILS.find((rail) => rail.key === first.store)?.label ?? "";
  if (group === "kind") return KIND_LABELS[first.kind];
  if (group === "live") return first.isLive ? "Asked right now" : "Nothing asks it now";
  if (group === "effect")
    return (
      BANK_EFFECT_RAILS.find((rail) => rail.key === first.effect)?.label ??
      "Gates nothing — it is not on an apply form"
    );
  return first.where;
}

/** Leads a group the way the rails print it, so headings and chips agree on the order. */
const GROUP_RANK: Record<string, number> = {
  gate: 0,
  suite: 1,
  LIVE: 0,
  IDLE: 1,
  HARD: 0,
  SOFT: 1,
  BLOCKED: 2,
  NONE: 3,
};

/**
 * The bank split into the sections its heading promises.
 *
 * Rows arrive in the order the page read them — apply form first, then suites — so grouping
 * preserves that without re-sorting the rows themselves. `place` keeps the two halves apart
 * by key, which is what stops a role and a suite of the same name sharing a heading.
 */
export function groupBankQuestions(
  rows: readonly BankQuestion[],
  group: BankGroupKey
): BankGroup[] {
  if (group === "none" || rows.length === 0) return [{ key: "", label: "", rows: [...rows] }];

  const buckets = new Map<string, BankQuestion[]>();
  for (const question of rows) {
    const key = groupKeyOf(question, group);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(question);
    else buckets.set(key, [question]);
  }

  const groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: groupLabelOf(bucket, group),
    rows: bucket,
  }));

  return groups.sort((a, b) => {
    const rank = (GROUP_RANK[a.key] ?? 99) - (GROUP_RANK[b.key] ?? 99);
    return rank !== 0 ? rank : a.label.localeCompare(b.label);
  });
}

/* -------------------------------------------------------------------------- */
/* Places, and the board's columns                                              */
/* -------------------------------------------------------------------------- */

/**
 * The number to print beside each question: its place in the group it is asked in.
 *
 * Read off the whole bank rather than the visible rows, so filtering down to two
 * questions does not relabel the second as the first — and because a shared
 * question and a role's own both start at 1, which is how the form asks them. A
 * suite's questions are numbered the same way, in the order the paper is dealt.
 */
export function bankOrders(rows: readonly BankQuestion[]): Map<string, number> {
  const seen = new Map<string, number>();
  const orders = new Map<string, number>();

  for (const question of rows) {
    const scope = bankPlaceKey(question.store, question.scopeKey);
    const next = (seen.get(scope) ?? 0) + 1;
    seen.set(scope, next);
    orders.set(question.key, next);
  }
  return orders;
}

/**
 * One place a question is asked, as the page read it.
 *
 * Keyed by store and scope together because a role id and a suite id are both
 * uuids, and the board's filter, its picker and its copy targets all name a place
 * by that pair.
 */
export interface BankPlaceRow {
  key: string;
  label: string;
  /** A published role, a suite that is not paused, or the shared every-role scope. */
  isOpen: boolean;
}

export function bankPlaceKey(store: BankStore, scopeKey: string): string {
  return `${store}:${scopeKey}`;
}

export function bankPlaceScope(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

/** The lookups the two row readers need, built once from the places the page read. */
export function bankPlaceLookup(places: readonly BankPlaceRow[]) {
  const byKey = new Map(places.map((place) => [place.key, place]));

  return {
    /** A form question's role — null for the shared scope, and null for a role that left the register. */
    job: (jobId: string | null): BankPlace | null =>
      byKey.get(bankPlaceKey("gate", jobId ?? SHARED_SCOPE)) ?? null,
    suite: (templateId: string): BankPlace | null =>
      byKey.get(bankPlaceKey("suite", templateId)) ?? null,
  };
}

/**
 * The places of one store that will actually receive a question.
 *
 * The shared scope is left out: `bankTargetsFor` adds it itself, as the one option
 * with no job id, and a picker that listed it twice would offer two names for the
 * same write.
 */
export function bankOpenPlaces(
  places: readonly BankPlaceRow[],
  store: BankStore
): { id: string; label: string }[] {
  const shared = bankPlaceKey("gate", SHARED_SCOPE);
  return places
    .filter((place) => place.isOpen && place.key !== shared)
    .filter((place) => place.key.startsWith(`${store}:`))
    .map((place) => ({ id: bankPlaceScope(place.key), label: place.label }));
}

/** The permission that owns writes in a store, said the way the console says it. */
export function bankPermissionWords(store: BankStore): string {
  return store === "gate"
    ? "Editing apply-form questions needs the Manage jobs permission."
    : "Editing test-suite questions needs the Create assessments permission.";
}

export interface BankColumn {
  key: string;
  label: string;
  /** The state worth printing under the name: shared, not published, paused, gone. */
  state: string;
  /** What a card dropped here becomes, since the two stores answer a drop differently. */
  note: string;
  acceptsDrop: boolean;
  /** Why a drop is refused here, or null when one would be written. */
  refuse: string | null;
  rows: BankQuestion[];
}

const MOVE_ON_FORM =
  "A drop asks the question here — it moves, so it stops being asked where it was.";
const COPY_INTO_SUITE =
  "A drop copies the question into this suite. It stays where it was written, because a candidate's saved paper is answered against its own suite.";

/**
 * The store's places as board columns, holding the questions asked in each.
 *
 * Two rules shape the set. Every place that holds a question is a column, even one
 * nothing can be dropped onto — a question that vanishes because its role closed
 * would read as the board losing rows. And a place that is switched off is still a
 * column while it is open in the register, so there is somewhere to drop into.
 *
 * The two stores cannot share a verb. An apply-form question's place is a column
 * on the question's own row, so a drop is a move; a suite question's place is
 * `template_id`, and re-pointing it would pull the question out of the paper of
 * everyone who already sat it, so a drop is a copy. The note says which, on the
 * column a recruiter is about to drop onto.
 */
export function bankColumns(
  store: BankStore,
  questions: readonly BankQuestion[],
  places: readonly BankPlaceRow[],
  canWrite: boolean
): BankColumn[] {
  const holders = new Map<string, BankQuestion[]>();
  for (const question of questions) {
    if (question.store !== store) continue;
    const bucket = holders.get(question.scopeKey);
    if (bucket) bucket.push(question);
    else holders.set(question.scopeKey, [question]);
  }

  const known = new Map<string, BankPlaceRow>();
  for (const place of places) {
    if (!place.key.startsWith(`${store}:`)) continue;
    known.set(bankPlaceScope(place.key), place);
  }

  const scopeKeys = new Set<string>();
  if (store === "gate") scopeKeys.add(SHARED_SCOPE);
  for (const [scopeKey, place] of known) if (place.isOpen) scopeKeys.add(scopeKey);
  for (const scopeKey of holders.keys()) scopeKeys.add(scopeKey);

  const columns: BankColumn[] = [];

  for (const scopeKey of scopeKeys) {
    const shared = scopeKey === SHARED_SCOPE;
    const place = known.get(scopeKey) ?? null;
    const rows = holders.get(scopeKey) ?? [];
    const label = shared
      ? SHARED_LABEL
      : (place?.label ?? rows[0]?.where ?? "A role no longer on file");
    const isOpen = shared || (place?.isOpen ?? false);

    const refuse = !canWrite
      ? bankPermissionWords(store)
      : !place && !shared
        ? store === "gate"
          ? "That role is no longer on file, so no form can be asked to show it."
          : "That suite no longer exists."
        : !isOpen
          ? store === "gate"
            ? `“${label}” is not published, so nobody would be asked it.`
            : `“${label}” is paused, so no new candidate could sit it.`
          : null;

    columns.push({
      key: bankPlaceKey(store, scopeKey),
      label,
      state: shared
        ? "Every published role"
        : !place
          ? "No longer on file"
          : isOpen
            ? store === "gate"
              ? "Published role"
              : "Taking questions"
            : store === "gate"
              ? "Not published"
              : "Paused",
      note: store === "gate" ? MOVE_ON_FORM : COPY_INTO_SUITE,
      acceptsDrop: refuse === null,
      refuse,
      rows,
    });
  }

  return columns.sort((a, b) => {
    if (a.key === bankPlaceKey("gate", SHARED_SCOPE)) return -1;
    if (b.key === bankPlaceKey("gate", SHARED_SCOPE)) return 1;
    const rank = Number(b.acceptsDrop) - Number(a.acceptsDrop);
    return rank !== 0 ? rank : a.label.localeCompare(b.label);
  });
}
