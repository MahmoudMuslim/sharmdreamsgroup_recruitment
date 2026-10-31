import {
  BANK_EFFECT_RAILS,
  BANK_GROUPS,
  bankGateQuestions,
  bankPlaceLookup,
  bankSuiteQuestions,
  searchBankQuestions,
  type BankEffectRail,
  type BankGroupKey,
  type BankKind,
  type BankKindRail,
  type BankLiveRail,
  type BankPlaceRow,
  type BankQuestion,
  type BankStore,
  type BankStoreRail,
  type BankTarget,
  type SuiteQuestionRow,
} from "@/modules/questions/bank";
import type { GateQuestion } from "@/modules/careers/gate-questions";

/**
 * The Question Bank's view state, and the write surface its components share.
 *
 * The same rule every filtered board in the portal follows, and for the same
 * reason — the chips, the counts beside them, the groups they fall into and the
 * link a recruiter copies all have to describe one set. Two copies of that logic is
 * how a rail starts counting a question the board below it does not show.
 *
 * Kept apart from the components so the pure half of the bank stays in the domain
 * module and this file stays the page's own vocabulary.
 */

/**
 * A projected question, plus the real row it was projected from.
 *
 * The list and the board both show the projection — the same shape whichever
 * store a question came from — but every control on them writes a column the
 * projection leaves out: a form question's `position`, its `is_active`, the suite
 * a test question belongs to. So the row travels beside it rather than being
 * looked back up by id.
 */
export type BankEntry =
  | { store: "gate"; question: BankQuestion; row: GateQuestion }
  | { store: "suite"; question: BankQuestion; row: SuiteQuestionRow };

/**
 * Both stores as one bank, in the order the page read them: form first, then suites.
 *
 * A projection that was built from a row the read also returned is paired with it
 * here, so a list can never offer to edit a question no row exists to write.
 */
export function bankEntries(
  gate: readonly GateQuestion[],
  suite: readonly SuiteQuestionRow[],
  places: readonly BankPlaceRow[]
): BankEntry[] {
  const lookup = bankPlaceLookup(places);
  const gateByKey = new Map(gate.map((row) => [row.id, row]));
  const suiteByKey = new Map(suite.map((row) => [row.id, row]));
  const entries: BankEntry[] = [];

  for (const question of bankGateQuestions(gate, lookup.job)) {
    const row = gateByKey.get(question.id);
    if (row) entries.push({ store: "gate", question, row });
  }
  for (const question of bankSuiteQuestions(suite, lookup.suite)) {
    const row = suiteByKey.get(question.id);
    if (row) entries.push({ store: "suite", question, row });
  }
  return entries;
}

/** The questions a list or a board draws, in the order they were banked. */
export function bankEntryQuestions(entries: readonly BankEntry[]): BankQuestion[] {
  return entries.map((entry) => entry.question);
}

/**
 * A suite's own rows, grouped for the editor that is opened per suite.
 *
 * Keyed by template id, and holding the rows rather than the projections: the
 * editor is the suite's own and expects the columns it writes.
 */
export function bankSuiteRowsByTemplate(
  suite: readonly SuiteQuestionRow[]
): Map<string, SuiteQuestionRow[]> {
  const byTemplate = new Map<string, SuiteQuestionRow[]>();
  for (const row of suite) {
    const bucket = byTemplate.get(row.template_id);
    if (bucket) bucket.push(row);
    else byTemplate.set(row.template_id, [row]);
  }
  return byTemplate;
}

/**
 * What one write answered: the sentence to print, and whether the board may
 * treat it as done.
 *
 * A board needs the second half — it only flashes a card that genuinely arrived in
 * the column it was dropped onto — while a list row needs only the first.
 */
export interface BankOutcome {
  ok: boolean;
  message: string;
}

/**
 * Every write the bank offers, held by the container that owns the drawers.
 *
 * One object rather than nine callbacks in three prop lists: a row, a card and a
 * column heading all ask for the same six things, and the container is the only
 * place that knows whether a drawer is already open, whether a write is in
 * flight, and which message area a refusal belongs in.
 */
export interface BankWrites {
  /** Edit an apply-form question in the bank's own drawer. */
  editGate(row: GateQuestion): void;
  /** Open a suite's question editor at one of its questions. */
  editSuite(row: SuiteQuestionRow): void;
  /** Stop asking a question, or start again. */
  toggleActive(row: GateQuestion): void;
  /** Delete from whichever store the row came from, after the page's own warning. */
  remove(question: BankQuestion): void;
  /** Swap with the neighbour the form or the paper actually asks next. */
  move(row: GateQuestion, direction: "up" | "down"): void;
  /**
   * A board drop.
   *
   * A move between apply-form places, or a copy into another suite — whichever
   * the destination store can honestly answer — and the caller is told which.
   */
  relocate(question: BankQuestion, columnKey: string): Promise<BankOutcome>;
  /** "Use it here" — a copy onto another role's form or into another suite. */
  copy(question: BankQuestion, target: BankTarget): Promise<BankOutcome>;
  /** Whether a write is in flight, so nothing offers a second one. */
  pending: boolean;
  /** The open places a copy can land on, per store, for a row's target picker. */
  places: { jobs: { id: string; label: string }[]; suites: { id: string; label: string }[] };
  /** Whether the account may write in each store, so nothing offers a dead button. */
  can: { form: boolean; suites: boolean };
}

export type BankViewMode = "list" | "board";

export interface BankViewState {
  /** The words in the search box, which stay local until a rail is clicked. */
  query: string;
  store: BankStoreRail;
  kind: BankKindRail;
  live: BankLiveRail;
  /**
   * What the answer set does to an application — the apply-form tab's own filter.
   *
   * Kept only while that tab is lit, because a test question has no effect to name: a link
   * carrying `effect=HARD` on another tab would filter out every suite question while the
   * page showed no chip that could have asked for it.
   */
  effect: BankEffectRail;
  /** `""`, or a bank scope key — `gate:<job id>`, `gate:shared`, `suite:<template id>`. */
  scope: string;
  group: BankGroupKey;
  /**
   * Which of the two views the bank is drawn in.
   *
   * The board is one store's places at a time, so `readBankViewState` only keeps
   * it while a tab is picked — on "Everywhere" there is no single set of columns to
   * draw, and a link that said `view=board` there would show a list.
   */
  mode: BankViewMode;
}

export const DEFAULT_BANK_VIEW: BankViewState = {
  query: "",
  store: "",
  kind: "",
  live: "",
  effect: "",
  scope: "",
  group: "place",
  mode: "list",
};

const STORE_TOKENS: readonly string[] = ["", "gate", "suite"];
const KIND_TOKENS: readonly string[] = ["", "choice", "judgment", "written", "spreadsheet", "video"];
const LIVE_TOKENS: readonly string[] = ["", "LIVE", "IDLE"];
const EFFECT_TOKENS: readonly string[] = BANK_EFFECT_RAILS.map((rail) => rail.key);
const MODE_TOKENS: readonly string[] = ["list", "board"];

/** The groupings the tab on screen can actually label. */
function groupTokenAllowed(token: string, tab: BankStoreRail): boolean {
  const option = BANK_GROUPS.find((candidate) => candidate.key === token);
  return Boolean(option) && (!option?.gateOnly || tab === "gate");
}

/**
 * Read the board's view out of the address bar.
 *
 * A token this page has no control for is dropped rather than kept: a parameter
 * the board cannot show would leave the copied link looking filtered while every
 * question stayed on screen. A scope is only kept while a question on the board
 * actually carries that key, because the picker offers no chip for a suite that
 * was deleted or a role whose questions have all been answered away.
 */
export function readBankViewState(
  params: { get(name: string): string | null },
  knownScopes: ReadonlySet<string>
): BankViewState {
  const store = params.get("store")?.toLowerCase() ?? "";
  const kind = params.get("kind")?.toLowerCase() ?? "";
  const live = params.get("live")?.toUpperCase() ?? "";
  const effect = params.get("effect")?.toUpperCase() ?? "";
  const group = params.get("group")?.toLowerCase() ?? "";
  const scope = params.get("scope")?.trim() ?? "";
  const mode = params.get("view")?.toLowerCase() ?? "";
  const tab = STORE_TOKENS.includes(store) ? (store as BankStoreRail) : "";
  const wanted: BankViewMode = MODE_TOKENS.includes(mode) ? (mode as BankViewMode) : "list";

  return {
    query: params.get("q") ?? "",
    store: tab,
    kind: KIND_TOKENS.includes(kind) ? (kind as BankKindRail) : "",
    live: LIVE_TOKENS.includes(live) ? (live as BankLiveRail) : "",
    effect: tab === "gate" && EFFECT_TOKENS.includes(effect) ? (effect as BankEffectRail) : "",
    scope: knownScopes.has(scope) ? scope : "",
    group: groupTokenAllowed(group, tab) ? (group as BankGroupKey) : "place",
    mode: tab ? wanted : "list",
  };
}

/** The board's view as a query string, defaults left out so the URL stays short. */
export function bankViewSearch(view: BankViewState): string {
  const next = new URLSearchParams();
  const words = view.query.trim();
  if (words) next.set("q", words);
  if (view.store) next.set("store", view.store);
  if (view.kind) next.set("kind", view.kind);
  if (view.live) next.set("live", view.live);
  if (view.effect) next.set("effect", view.effect);
  if (view.scope) next.set("scope", view.scope);
  if (view.group !== "place") next.set("group", view.group);
  if (view.store && view.mode === "board") next.set("view", "board");
  return next.toString();
}

/** True when the address bar asks for anything but the whole bank. */
export function isBankViewFiltered(view: BankViewState): boolean {
  return Boolean(
    view.query.trim() ||
      view.store ||
      view.kind ||
      view.live ||
      view.effect ||
      view.scope ||
      view.group !== "place"
  );
}

/** A question's bank scope key — the same string the picker and the URL use. */
export function bankScopeKey(question: BankQuestion): string {
  return `${question.store}:${question.scopeKey}`;
}

/**
 * Rails, then scope, then the words — and nothing else.
 *
 * The rails run first because they are the recruiter's question about the set
 * ("show me the quiz questions"), and the search then narrows whatever they left.
 */
export function filterBankQuestions(
  rows: readonly BankQuestion[],
  view: BankViewState
): BankQuestion[] {
  let kept = rows;

  if (view.store) kept = kept.filter((question) => question.store === (view.store as BankStore));
  if (view.kind) kept = kept.filter((question) => question.kind === (view.kind as BankKind));
  if (view.live) {
    const wantLive = view.live === "LIVE";
    kept = kept.filter((question) => question.isLive === wantLive);
  }
  if (view.effect) kept = kept.filter((question) => question.effect === view.effect);
  if (view.scope) kept = kept.filter((question) => bankScopeKey(question) === view.scope);

  return searchBankQuestions(kept, view.query);
}
