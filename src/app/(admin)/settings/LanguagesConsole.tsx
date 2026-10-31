"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Save, Search, Sparkles } from "lucide-react";
import { Badge, Button, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import { draftInterfaceWording, saveTranslations } from "@/modules/i18n/application/translationWrites";
import {
  TRANSLATION_LOCALES,
  groupRows,
  placeholderProblem,
  rowMatches,
  searchWords,
  untranslatedPairs,
  type TranslationEdit,
  type TranslationLocale,
  type TranslationRow,
} from "@/modules/i18n/domain/translations";

const LOCALE_LABEL: Record<TranslationLocale, string> = { en: "English", ar: "العربية" };

function editId(locale: TranslationLocale, key: string) {
  return `${locale}:${key}`;
}

/** The English a row is translated from: the override if there is one, else the shipped word. */
function sourceFor(row: TranslationRow): string {
  return row.stored.en || row.shipped.en;
}

/**
 * One dictionary key with a field per language.
 *
 * Fully controlled by the parent's edit map: the field shows the pending edit if
 * there is one and the stored override otherwise. That is what lets a draft —
 * which the parent drops into the same map — appear in the field it belongs to,
 * and what makes typing into a field and reverting it behave as one mechanism.
 */
function RowEditor({
  row,
  editable,
  values,
  dirty,
  onEdit,
}: {
  row: TranslationRow;
  editable: boolean;
  values: Record<TranslationLocale, string>;
  dirty: boolean;
  onEdit: (edit: TranslationEdit) => void;
}) {
  // The Arabic is checked against the English the admin can see, before any save:
  // a dropped `{name}` is a sentence a candidate reads with a hole in it, and the
  // writer refuses the whole batch for it, so it is kinder to say so here.
  const arProblem = values.ar.trim() ? placeholderProblem(sourceFor(row), values.ar) : null;

  return (
    <li className="rounded-xl border border-brand-line bg-brand-cream p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold break-all">{row.key}</p>
          <p className="mt-0.5 text-[11px] text-brand-ink/45">
            {row.orphan
              ? "No dictionary in this build defines this key any more — clearing it drops the leftover."
              : `Shipped Arabic: ${row.shipped.ar || "none"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.orphan && <Badge tone="danger">Orphan</Badge>}
          {row.stored.ar && !row.orphan && <Badge tone="success">Overridden</Badge>}
          {dirty && <Badge tone="gold">Unsaved</Badge>}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {TRANSLATION_LOCALES.map((locale) => (
          <label key={locale} className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
              {LOCALE_LABEL[locale]}
            </span>
            <textarea
              value={values[locale]}
              rows={2}
              dir={locale === "ar" ? "rtl" : "ltr"}
              disabled={!editable}
              placeholder={row.shipped[locale]}
              onChange={(event) => onEdit({ locale, key: row.key, text: event.target.value })}
              className={cn(
                "w-full rounded-xl border bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none disabled:opacity-60",
                locale === "ar" && arProblem
                  ? "border-rose-300 focus:border-rose-500"
                  : "border-brand-line focus:border-brand-gold"
              )}
            />
            {locale === "en" && row.shipped.en && (
              <span className="mt-1 block text-[10px] text-brand-ink/40">
                Shipped: {row.shipped.en}
              </span>
            )}
            {locale === "ar" && arProblem && (
              <span className="mt-1 block text-[10px] text-rose-700">The Arabic {arProblem}.</span>
            )}
          </label>
        ))}
      </div>
    </li>
  );
}

/**
 * The Settings → Languages console.
 *
 * Every row here is wording a person reads: `translate` prefers a stored override
 * over the words the build ships, so saving a key changes what the next candidate
 * sees on the public pages. The rows are computed once on the server (the
 * dictionaries live there) and handed down as plain data, so this panel ships no
 * copy of them — it only edits what it was given.
 *
 * Groups stay collapsed until opened or searched: the dictionary runs to hundreds
 * of keys, and one controlled field per language per key would be a slow page and
 * an unreadable one if all of it rendered at once.
 */
export function LanguagesConsole({
  rows,
  editable,
}: {
  rows: TranslationRow[];
  editable: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();

  const [edits, setEdits] = useState<Record<string, TranslationEdit>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, setDrafting] = useState<string | null>(null);

  // The console's search box writes `?find=` rather than a router push, so an
  // answer about a word links to the console already filtered to it — the same
  // way the change trail's `?find=` works.
  const find = params.get("find") ?? "";
  const words = useMemo(() => searchWords(find), [find]);
  const visible = useMemo(() => rows.filter((row) => rowMatches(row, words)), [rows, words]);
  const groups = useMemo(() => groupRows(visible), [visible]);

  // The stored value each field started from, so a revert back to it forgets the
  // edit instead of leaving a pending edit that repeats what is already stored.
  const stored = useMemo(() => new Map(rows.map((row) => [row.key, row.stored] as const)), [rows]);

  function reportEdit(edit: TranslationEdit) {
    setEdits((current) => {
      const next = { ...current };
      const id = editId(edit.locale, edit.key);
      if (edit.text === (stored.get(edit.key)?.[edit.locale] ?? "")) delete next[id];
      else next[id] = edit;
      return next;
    });
  }

  /** The value a field shows: its pending edit, else what is stored. */
  function valueFor(row: TranslationRow, locale: TranslationLocale): string {
    return edits[editId(locale, row.key)]?.text ?? row.stored[locale];
  }

  function runDraft(pairs: { key: string; text: string }[], scope: string) {
    setError(null);
    setNotice(null);
    if (pairs.length === 0) {
      setNotice("Every row here already has Arabic, so there was nothing to draft.");
      return;
    }
    setDrafting(scope);
    startTransition(async () => {
      try {
        const result = await draftInterfaceWording("ar", pairs);
        if (!result.ok) {
          setError(result.error ?? "The translation model did not answer.");
          return;
        }
        for (const draft of result.drafts) {
          setEdits((current) => ({
            ...current,
            [editId("ar", draft.key)]: { locale: "ar", key: draft.key, text: draft.text },
          }));
        }
        setNotice(
          `Drafted ${result.drafts.length} of ${pairs.length} with ${result.model ?? "the model"}. ` +
            "These are drafts in the fields — nothing is stored until you Save."
        );
      } finally {
        setDrafting(null);
      }
    });
  }

  function save() {
    setError(null);
    setNotice(null);
    const batch = Object.values(edits);
    if (batch.length === 0) return;
    startTransition(async () => {
      const result = await saveTranslations(batch);
      if (result.ok) {
        // Clear the pending map so every field falls back to the value just
        // stored, which the revalidated `rows` now carries — the screen and the
        // database then agree without the panel trusting its own copy.
        setEdits({});
        setNotice(
          result.saved === 0
            ? "Nothing changed, so nothing was written."
            : `Saved ${result.saved} wording${result.saved === 1 ? "" : "s"}.`
        );
      } else if (result.problems.length > 0) {
        setError(
          `Saved nothing. ${result.problems.length} edit${
            result.problems.length === 1 ? "" : "s"
          } refused: ${result.problems
            .slice(0, 3)
            .map((p) => `${p.key} (${p.locale}) ${p.problem}`)
            .join("; ")}${result.problems.length > 3 ? ", …" : ""}`
        );
      } else {
        setError(result.error ?? "Could not save the wording.");
      }
    });
  }

  const dirtyCount = Object.keys(edits).length;
  // While a search is running every group is open — a filtered list the reader
  // has to click each heading to see would hide the matches it just found.
  const searchActive = words.length > 0;

  return (
    <Card className="p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg font-bold">Languages</h2>
        <p className="mt-1 text-sm text-brand-ink/60">
          The words this build ships, and the overrides that replace them. A stored wording wins
          over the shipped one on every public page, so saving a key changes what the next candidate
          reads. English is what everything falls back to; the Arabic column is where a language is
          filled in.
        </p>
      </header>

      {!editable && (
        <p className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
          You can read every key; saving requires the
          <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">settings.manage_platform</code>
          permission.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40" aria-hidden />
          <input
            value={find}
            onChange={(event) => {
              const search = new URLSearchParams(window.location.search);
              if (event.target.value) search.set("find", event.target.value);
              else search.delete("find");
              window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
            }}
            placeholder="Search a key, its English, or its Arabic"
            className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-gold focus:outline-none"
          />
        </div>
        {editable && (
          <Button size="sm" onClick={save} disabled={dirtyCount === 0 || pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : dirtyCount > 0 ? null : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {dirtyCount > 0 ? `Save ${dirtyCount}` : "Save"}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-xs text-brand-ink/65">
          {notice}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
          No key matches that search.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const isExpanded = searchActive || open[group.id];
            const blanks = untranslatedPairs(group.rows, "ar", "en");
            const groupDirty = group.rows.some((row) =>
              TRANSLATION_LOCALES.some((locale) => edits[editId(locale, row.key)] !== undefined)
            );
            return (
              <div key={group.id} className="rounded-xl border border-brand-line">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpen((current) => ({ ...current, [group.id]: !current[group.id] }))}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-brand-ink/45" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-brand-ink/45" aria-hidden />
                    )}
                    <span className="text-sm font-bold text-brand-ink/75">{group.label}</span>
                    <span className="text-[11px] text-brand-ink/45">
                      ({group.translated}/{group.rows.length} read as Arabic)
                    </span>
                    {groupDirty && <Badge tone="gold">Unsaved</Badge>}
                  </button>
                  {editable && blanks.length > 0 && !searchActive && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen((current) => ({ ...current, [group.id]: true }));
                        runDraft(blanks, group.id);
                      }}
                      disabled={drafting !== null}
                    >
                      {drafting === group.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Draft {blanks.length} blank{blanks.length === 1 ? "" : "s"}
                    </Button>
                  )}
                </div>
                {isExpanded && (
                  <ul className="space-y-3 border-t border-brand-line p-4">
                    {group.rows.map((row) => (
                      <RowEditor
                        key={row.key}
                        row={row}
                        editable={editable}
                        values={{ en: valueFor(row, "en"), ar: valueFor(row, "ar") }}
                        dirty={TRANSLATION_LOCALES.some((locale) => edits[editId(locale, row.key)] !== undefined)}
                        onEdit={reportEdit}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
