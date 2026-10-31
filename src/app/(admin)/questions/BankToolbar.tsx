"use client";

import { ChevronDown, Plus, Search } from "lucide-react";
import { Select, TextInput } from "@/modules/analytics/presentation/Form";
import { Button, FilterRail } from "@/modules/analytics/presentation/ui";
import {
  BANK_EFFECT_RAILS,
  BANK_GROUPS,
  BANK_KIND_RAILS,
  BANK_LIVE_RAILS,
  bankSearchWords,
  type BankScopeChoice,
} from "@/modules/questions/bank";
import type { BankViewState } from "./bankView";

/**
 * The controls that decide which questions the bank shows, and how.
 *
 * Presentational only — it holds no state and filters nothing. Every number in it
 * comes from the same module that filters the rows below, so a chip cannot
 * advertise a set the board then fails to render.
 *
 * The store tabs live above this, not inside it: the tabs decide *which* questions
 * are being looked at, and the board is one tab's places, so they belong to the
 * same decision as List and Board.
 */
export function BankToolbar({
  view,
  counts,
  scopeChoices,
  total,
  shown,
  filtered,
  canReorder,
  can,
  suiteChoices,
  onQuery,
  onPatch,
  onClear,
  onAddGate,
  onAddSuite,
}: {
  view: BankViewState;
  counts: Map<string, number>;
  scopeChoices: BankScopeChoice[];
  total: number;
  shown: number;
  filtered: boolean;
  /** Whether the list will let a row be moved — see the note under the rails. */
  canReorder: boolean;
  can: { form: boolean; suites: boolean };
  /** The suites a new question can be written into. */
  suiteChoices: { id: string; label: string }[];
  onQuery: (value: string) => void;
  onPatch: (patch: Partial<BankViewState>) => void;
  onClear: () => void;
  onAddGate: () => void;
  onAddSuite: (templateId: string) => void;
}) {
  const onForm = counts.get("gate") ?? 0;
  const inSuites = counts.get("suite") ?? 0;
  const idle = counts.get("IDLE") ?? 0;
  const blocked = counts.get("BLOCKED") ?? 0;
  const board = view.mode === "board";
  /** The apply-form tab is the only one whose answers do something to an application. */
  const onGateTab = view.store === "gate";

  return (
    <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/35"
            aria-hidden
          />
          <TextInput
            type="search"
            value={view.query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={`Search by ${bankSearchWords()}…`}
            aria-label="Search the question bank"
            className="pl-9"
          />
        </div>

        {board ? (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            The board groups by place on its own — every open {view.store === "gate" ? "role" : "suite"} is a
            column, so a card can be dropped from one to another.
          </p>
        ) : (
          <>
            <label className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
              Where
              <Select
                aria-label="Filter by the role or suite a question belongs to"
                value={view.scope}
                onChange={(event) => onPatch({ scope: event.target.value })}
                className="w-auto max-w-full py-1.5 text-xs font-semibold normal-case tracking-normal"
              >
                <option value="">Every place ({total})</option>
                {scopeChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label} ({choice.count})
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
              Group
              <Select
                aria-label="Group the bank by"
                value={view.group}
                onChange={(event) =>
                  onPatch({ group: event.target.value as BankViewState["group"] })
                }
                className="w-auto max-w-full py-1.5 text-xs font-semibold normal-case tracking-normal"
              >
                {BANK_GROUPS.filter((option) => !option.gateOnly || onGateTab).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {BANK_LIVE_RAILS.map((rail) => (
          <FilterRail
            key={rail.key || "any-live"}
            label={rail.label}
            count={counts.get(rail.key) ?? 0}
            active={view.live === rail.key}
            onClick={() => onPatch({ live: rail.key })}
            tone="muted"
          />
        ))}

        <span className="mx-1 hidden h-5 w-px bg-brand-line sm:block" aria-hidden />

        {BANK_KIND_RAILS.map((rail) => (
          <FilterRail
            key={rail.key || "any-kind"}
            label={rail.label}
            count={counts.get(rail.key) ?? 0}
            active={view.kind === rail.key}
            onClick={() => onPatch({ kind: rail.key })}
            tone="muted"
          />
        ))}

        {onGateTab && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-brand-line sm:block" aria-hidden />
            {BANK_EFFECT_RAILS.map((rail) => (
              <FilterRail
                key={rail.key || "any-effect"}
                label={rail.label}
                // The three effect chips partition the apply-form tab, not the bank, so
                // "Any effect" has to carry that tab's count — the whole-bank figure the
                // other rails use for their first chip would out-number its own children.
                count={rail.key === "" ? onForm : (counts.get(rail.key) ?? 0)}
                active={view.effect === rail.key}
                onClick={() => onPatch({ effect: rail.key })}
                tone="muted"
              />
            ))}
          </>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {can.form && (
            <Button variant="outline" size="sm" onClick={onAddGate}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Ask a question on a form
            </Button>
          )}
          {can.suites && (
            <label className="flex min-w-0 items-center gap-1.5">
              <span className="sr-only">Add a question into a test suite</span>
              <Select
                aria-label="Add a question into a test suite"
                value=""
                disabled={suiteChoices.length === 0}
                onChange={(event) => {
                  if (event.target.value) onAddSuite(event.target.value);
                }}
                className="w-auto max-w-full py-1.5 text-xs font-semibold"
              >
                <option value="">
                  {suiteChoices.length === 0 ? "No suite is switched on" : "Add into a suite…"}
                </option>
                {suiteChoices.map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="inline-flex items-center gap-1.5 text-xs text-brand-ink/55">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            {filtered
              ? `Showing ${shown} of ${total} question${total === 1 ? "" : "s"}.`
              : `${total} question${total === 1 ? "" : "s"} in the bank — ${onForm} asked on the apply form, ${inSuites} inside a test suite.`}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-bold text-brand-ink/60 underline transition hover:text-brand-ink"
            >
              Clear the filters
            </button>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-brand-ink/45">
          {can.form || can.suites
            ? board
              ? view.store === "gate"
                ? "A drop between these columns moves the question: it is asked where it lands and stops being asked where it came from. Editing, ordering and deleting happen on the card and in the drawer."
                : "A drop between these columns copies the question into the suite it lands in. A test question is never moved out of its suite, because a candidate's saved paper is answered against the suite it was sat in."
              : "Wording, answers, marks and order are edited here — a form question in this page's own drawer, a test question in the suite editor. A copy writes one new row into whichever console owns the destination."
            : "You can read every question here. Writing one follows the permission that owns its store: Manage jobs for the apply form, Create assessments for a test suite."}
        </p>

        {onGateTab && onForm > 0 && (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            {canReorder
              ? "The number beside a form question is the order the apply form asks it, counted among the questions asked of the same roles. A test question is ordered by its suite's own editor."
              : "Up and down are parked while the bank is filtered, grouped another way or drawn as a board: a move swaps a form question with the one the apply form asks next in its own scope, and this view may be hiding it. Switch to List, group by where it is asked and clear the filters to reorder."}
          </p>
        )}

        {blocked > 0 && (
          <p className="text-[11px] font-semibold leading-relaxed text-rose-700">
            {blocked} form question{blocked === 1 ? "" : "s"} offer no answer that lets an
            applicant through, so everyone asked one is rejected on arrival. This page refuses to
            save such a set — it arrived from outside it.
            {onGateTab ? "" : " Light the apply-form tab to find them."}
          </p>
        )}

        {idle > 0 && !filtered && (
          <p className="text-[11px] leading-relaxed text-brand-ink/45">
            {idle} of {total} are stored but asked by nobody right now — a switched-off form
            question, a role that is no longer published, or a suite that is paused. They stay in
            the bank because their wording is the part worth keeping.
          </p>
        )}
      </div>
    </div>
  );
}
