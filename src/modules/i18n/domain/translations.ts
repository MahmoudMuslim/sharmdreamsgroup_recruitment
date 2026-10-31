import { placeholdersIn, shippedText, translationKeys } from "@/lib/i18n";
import type { Locale } from "@/core/entities";

/**
 * The translation console's own model: which words exist, how they are grouped,
 * and what a stored override is allowed to look like.
 *
 * The dictionary itself stays in `src/lib/i18n.ts` beside `translate`, because
 * that is the function every surface calls. What lives here is the console's view
 * of it — the row list, the groups, and the checks a save runs — so the panel can
 * be reasoned about without reading a thousand lines of wording.
 */

/**
 * The languages the console edits.
 *
 * The build also ships partial Russian and German dictionaries, and an override
 * written for either would be honoured by `translate` all the same. They are not
 * columns here because nobody asked to maintain them: a field an admin cannot see
 * is a field that silently keeps a value they cannot correct.
 */
export const TRANSLATION_LOCALES = ["en", "ar"] as const;
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

export function isTranslationLocale(value: unknown): value is TranslationLocale {
  return typeof value === "string" && (TRANSLATION_LOCALES as readonly string[]).includes(value);
}

/** The `app_settings` key one language's whole map is stored under. */
export const OVERRIDES_KEY_PREFIX = "i18n.";

export function overridesKey(locale: Locale): string {
  return `${OVERRIDES_KEY_PREFIX}${locale}`;
}

/** Longest wording one key may carry. A paragraph is a template, not a label. */
export const MAX_TEXT_CHARS = 2_000;

/**
 * Narrow a JSONB settings row into a flat key→wording map.
 *
 * The row is hand-editable through the database, so anything that is not
 * a string is dropped rather than coerced: a number or a nested object would
 * reach `translate` and print `[object Object]` to a candidate. An empty string
 * is dropped too, because "no override" and "print nothing" have to stay
 * different — the first falls back to the shipped wording, the second blanks a
 * button.
 */
export function parseOverrideMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text !== "string" || !key) continue;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_CHARS) continue;
    out[key] = trimmed;
  }
  return out;
}

/**
 * The group a key files itself under.
 *
 * Two segments where there are three, so `apply.steps.about` sits beside
 * `apply.steps.review` instead of in one 80-row pile with `apply.ctaTitle`. A key
 * with a single dot groups under its first segment, and a key with none at all
 * groups under itself.
 */
export function keyGroup(key: string): string {
  const parts = key.split(".");
  if (parts.length < 2) return key;
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
}

const GROUP_LABELS: Record<string, string> = {
  nav: "Admin navigation",
  common: "Shared words",
  login: "Staff sign-in",
  home: "Landing page",
  chrome: "Public header and footer",
  board: "Careers board",
  facet: "Careers board filters",
  careers: "Role page",
  chat: "Careers chatbot",
  apply: "Application — the page itself",
  "apply.steps": "Application — step names",
  "apply.about": "Application — about you",
  "apply.cv": "Application — your CV",
  "apply.err": "Application — refusals",
  "apply.fill": "Application — CV prefill notes",
  "apply.word": "Application — field names",
  "apply.review": "Application — the review step",
  "apply.done": "Application — the receipt",
  portal: "Candidate tracking portal",
  glance: "Company at a glance",
  stage: "Pipeline stage names",
  assessment: "Assessment runner",
  time: "Relative dates",
  jobs: "Job cards",
  enum: "Vocabulary labels",
};

/**
 * The heading a group is shown under.
 *
 * A group nobody named still gets a readable heading rather than its own id, so
 * a key added in a future release appears in the console as words instead of as
 * `some.new.prefix`.
 */
export function groupLabel(group: string): string {
  const named = GROUP_LABELS[group];
  if (named) return named;
  return group
    .split(/[._]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** One row of the console: a key, and what each edited language currently says. */
export interface TranslationRow {
  key: string;
  group: string;
  /** Per locale: the wording this build ships, or `""` when it ships none. */
  shipped: Record<TranslationLocale, string>;
  /** Per locale: the stored override, or `""` when there is none. */
  stored: Record<TranslationLocale, string>;
  /**
   * A stored override for a key no dictionary defines any more.
   *
   * Listed rather than hidden: it is dead weight that a rename left behind, and
   * the only way to see that is to show it. Clearing the field drops it on save.
   */
  orphan: boolean;
}

const EMPTY_TEXT: Record<TranslationLocale, string> = { en: "", ar: "" };

export function translationRows(
  overrides: Partial<Record<Locale, Record<string, string>>>
): TranslationRow[] {
  const known = new Set(translationKeys());
  const keys = [...known];

  // Orphans last, so a live key is never pushed below wording nothing reads.
  for (const locale of TRANSLATION_LOCALES) {
    for (const key of Object.keys(overrides[locale] ?? {})) {
      if (known.has(key)) continue;
      if (!keys.includes(key)) keys.push(key);
    }
  }

  return keys.map((key) => {
    const shipped = { ...EMPTY_TEXT };
    const stored = { ...EMPTY_TEXT };
    for (const locale of TRANSLATION_LOCALES) {
      shipped[locale] = shippedText(locale, key) ?? "";
      stored[locale] = overrides[locale]?.[key] ?? "";
    }
    return { key, group: keyGroup(key), shipped, stored, orphan: !known.has(key) };
  });
}

export interface TranslationGroup {
  id: string;
  label: string;
  rows: TranslationRow[];
  /** How many of the group's rows already read as Arabic, stored or shipped. */
  translated: number;
}

/**
 * The rows grouped for display, in the order the dictionary defines them.
 *
 * Grouping is done here rather than in the panel so the count beside a heading
 * and the rows under it cannot drift apart.
 */
export function groupRows(rows: TranslationRow[]): TranslationGroup[] {
  const byId = new Map<string, TranslationRow[]>();
  for (const row of rows) {
    const list = byId.get(row.group);
    if (list) list.push(row);
    else byId.set(row.group, [row]);
  }

  return [...byId.entries()].map(([id, members]) => ({
    id,
    label: groupLabel(id),
    rows: members,
    translated: members.filter((row) => (row.stored.ar || row.shipped.ar).trim().length > 0).length,
  }));
}

/** Case- and accent-insensitive enough for a search box over two alphabets. */
function fold(text: string): string {
  return text.trim().toLowerCase();
}

/** Does any of a row's four texts, or its key, carry all of `words`? */
export function rowMatches(row: TranslationRow, words: string[]): boolean {
  if (words.length === 0) return true;
  const haystack = fold(
    [row.key, row.shipped.en, row.shipped.ar, row.stored.en, row.stored.ar].join(" ")
  );
  return words.every((word) => haystack.includes(word));
}

/** The search box's words, split the way the change trail's search splits them. */
export function searchWords(find: string | null | undefined): string[] {
  if (typeof find !== "string") return [];
  return find
    .split(/\s+/)
    .map((word) => fold(word))
    .filter((word) => word.length > 0)
    .slice(0, 8);
}

/**
 * The `{name}` placeholders a translation dropped or invented.
 *
 * Checked on the way in rather than left to the candidate: substitution replaces
 * the placeholders it finds and passes the rest through untouched, so a missing
 * one prints `{role}` inside a sentence and an extra one is simply never filled.
 * Both are a broken screen, and neither throws.
 */
export function placeholderProblem(source: string, target: string): string | null {
  const wanted = placeholdersIn(source);
  const got = placeholdersIn(target);
  const missing = wanted.filter((name) => !got.includes(name));
  const invented = got.filter((name) => !wanted.includes(name));
  if (missing.length === 0 && invented.length === 0) return null;
  const named = (list: string[]) => list.map((name) => `{${name}}`).join(", ");
  if (missing.length > 0) return `must keep ${named(missing)}`;
  return `must not add ${named(invented)}`;
}

/** One edit the console is asking to store. */
export interface TranslationEdit {
  locale: TranslationLocale;
  key: string;
  /** Empty means "drop the override and read the shipped wording again". */
  text: string;
}

export interface TranslationEditProblem {
  key: string;
  locale: TranslationLocale;
  problem: string;
}

/**
 * The edits worth writing, and the ones refused.
 *
 * An edit is dropped when it repeats what is already stored — resubmitting a
 * screen of untouched fields should not write 400 rows or leave 400 trail
 * entries — and refused when its wording would break substitution or exceeds the
 * stored limit.
 */
export function planEdits(
  edits: TranslationEdit[],
  stored: Partial<Record<Locale, Record<string, string>>>
): { writes: TranslationEdit[]; problems: TranslationEditProblem[] } {
  const writes: TranslationEdit[] = [];
  const problems: TranslationEditProblem[] = [];
  const seen = new Set<string>();

  for (const edit of edits) {
    const id = `${edit.locale}:${edit.key}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const text = typeof edit.text === "string" ? edit.text.trim() : "";
    const current = stored[edit.locale]?.[edit.key] ?? "";

    if (text === current) continue;

    if (text.length > MAX_TEXT_CHARS) {
      problems.push({
        key: edit.key,
        locale: edit.locale,
        problem: `is longer than ${MAX_TEXT_CHARS} characters`,
      });
      continue;
    }

    if (text) {
      // English is the wording everything falls back to, so it is compared
      // against what the build ships. Another language is compared against the
      // English the row shows, which is the sentence being translated.
      const source =
        edit.locale === "en"
          ? shippedText("en", edit.key) ?? current
          : shippedText("en", edit.key) ?? stored.en?.[edit.key] ?? "";
      if (source) {
        const problem = placeholderProblem(source, text);
        if (problem) {
          problems.push({ key: edit.key, locale: edit.locale, problem });
          continue;
        }
      }
    }

    writes.push({ locale: edit.locale, key: edit.key, text });
  }

  return { writes, problems };
}

/**
 * The pairs a one-click translation asks the model for: every row with wording to
 * translate and nothing in the target language yet.
 *
 * Filling a blank is the only thing the bulk button does. Replacing wording a
 * person already wrote is a per-row decision, made with that row's own button, so
 * one click can never quietly overwrite 400 reviewed sentences.
 */
export function untranslatedPairs(
  rows: TranslationRow[],
  target: TranslationLocale,
  source: TranslationLocale
): { key: string; text: string }[] {
  const pairs: { key: string; text: string }[] = [];
  for (const row of rows) {
    const from = (row.stored[source] || row.shipped[source]).trim();
    const to = (row.stored[target] || row.shipped[target]).trim();
    if (!from || to) continue;
    pairs.push({ key: row.key, text: from });
  }
  return pairs;
}

/** What a save did, including the edits it refused and why. */
export interface SaveTranslationsResult {
  ok: boolean;
  /** How many (language, key) pairs were written, cleared ones included. */
  saved: number;
  /** Edits refused before anything was written. Empty when the save was clean. */
  problems: TranslationEditProblem[];
  error?: string;
}

/** What a one-click draft produced, and what it could not. */
export interface DraftTranslationsResult {
  ok: boolean;
  drafts: { key: string; text: string }[];
  /** Keys asked for that came back absent, unusable, or with broken placeholders. */
  unanswered: string[];
  /** The model that answered, named so the console can say whose wording this is. */
  model: string | null;
  error?: string;
}
