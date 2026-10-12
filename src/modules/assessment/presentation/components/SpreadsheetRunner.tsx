"use client";

import { HotTable } from "@handsontable/react";
import { HyperFormula } from "hyperformula";
import { useCallback, useEffect, useMemo, useRef } from "react";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import type { CellChange, ChangeSource } from "handsontable/common";
import type { HotTableClass } from "@handsontable/react";
import type { SpreadsheetCellData } from "@/types";
import type { AttemptQuestionClient } from "@/stores/useAssessmentStore";
import { useAssessmentStore } from "@/stores/useAssessmentStore";

/** `HotTable` is a forwardRef component; the ref points at the wrapper class instance. */
type HotTableRef = HotTableClass;

function colName(index: number): string {
  let name = "";
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

function cellsToGrid(cells: Record<string, SpreadsheetCellData>): (string | number | null)[][] {
  const maxRow = 30;
  const maxCol = 8;
  const grid: (string | number | null)[][] = Array.from({ length: maxRow }, () =>
    Array.from({ length: maxCol }, () => null)
  );
  for (const [ref, cell] of Object.entries(cells)) {
    const match = ref.match(/^([A-Z]+)([0-9]+)$/);
    if (!match || cell === null || cell === undefined) continue;
    const col = match[1].split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const row = parseInt(match[2], 10) - 1;
    if (row >= 0 && row < maxRow && col >= 0 && col < maxCol) {
      grid[row][col] = cell.value as string | number | null;
    }
  }
  return grid;
}

function gridToCells(grid: (string | number | null)[][]): Record<string, SpreadsheetCellData> {
  const cells: Record<string, SpreadsheetCellData> = {};
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const value = grid[row][col];
      if (value === null || value === undefined || value === "") continue;
      cells[`${colName(col)}${row + 1}`] = { value };
    }
  }
  return cells;
}

interface SpreadsheetRunnerProps {
  question: AttemptQuestionClient;
}

export function SpreadsheetRunner({ question }: SpreadsheetRunnerProps) {
  const hotRef = useRef<HotTableRef>(null);
  const savedCells = useAssessmentStore((state) => state.spreadsheetDataMap[question.id]);
  const updateSpreadsheetData = useAssessmentStore((state) => state.updateSpreadsheetData);
  const syncDraft = useAssessmentStore((state) => state.syncDraftToSupabase);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latches once the draft has been pushed into the grid, per mounted table. */
  const restoredRef = useRef(false);
  /** True only while `loadData()` is running, so its echo is ignored. */
  const isRestoringRef = useRef(false);
  /** Serialised snapshot of the last grid written to the store (loop guard). */
  const lastPersistedRef = useRef<string | null>(null);

  const initialData = useMemo(() => {
    const base = question.config.initial_sheet?.data ?? [];
    const grid: (string | number | null)[][] = base.map((row) => row.slice());
    while (grid.length < 30) grid.push(Array.from({ length: 8 }, () => null));
    return grid.map((row) => {
      const padded = row.slice();
      while (padded.length < 8) padded.push(null);
      return padded;
    });
  }, [question.config.initial_sheet]);

  const hyperformulaInstance = useMemo(
    () =>
      HyperFormula.buildEmpty({
        licenseKey: "gpl-v3",
      }),
    []
  );

  useEffect(() => {
    return () => {
      hyperformulaInstance.destroy();
    };
  }, [hyperformulaInstance]);

  /**
   * Restores a saved draft exactly once, after Handsontable has mounted.
   *
   * `loadData()` itself emits `afterChange`, which would otherwise write the
   * freshly-loaded grid straight back into the store and re-trigger this
   * effect — an infinite render loop. The `restoredRef` latch plus the
   * `isRestoringRef` guard below break that feedback cycle.
   */
  useEffect(() => {
    if (restoredRef.current) return;
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    restoredRef.current = true;
    if (!savedCells) return;

    isRestoringRef.current = true;
    hot.loadData(cellsToGrid(savedCells));
    isRestoringRef.current = false;
  }, [savedCells]);

  /**
   * Persists the grid only when its contents actually changed.
   *
   * `afterChange` can fire from several sources (edits, autofit, formula
   * recalculation). Writing a fresh object to the store on every emission
   * re-renders the subscriber, which can emit again — an unbounded loop that
   * React reports as "Maximum update depth exceeded". Comparing against the
   * last persisted snapshot guarantees at most one store write per distinct
   * grid, which makes the cycle terminate.
   */
  const handleAfterChange = useCallback(
    (_changes: CellChange[] | null, source: ChangeSource) => {
      if (isRestoringRef.current) return;
      if (source === "loadData" || source === "populateFromArray") return;

      const hot = hotRef.current?.hotInstance;
      if (!hot) return;

      const grid = hot.getData() as unknown as (string | number | null)[][];
      const cells = gridToCells(grid);
      const fingerprint = JSON.stringify(cells);
      if (fingerprint === lastPersistedRef.current) return;
      lastPersistedRef.current = fingerprint;

      updateSpreadsheetData(question.id, cells);

      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => void syncDraft(), 1500);
    },
    [question.id, updateSpreadsheetData, syncDraft]
  );

  const expectedOutputs = question.config.expected_outputs ?? [];

  return (
    <div className="space-y-4">
      {/* Handsontable needs a real height on small screens; the wrapper
          scrolls horizontally so the grid never squashes the columns. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[520px] overflow-hidden rounded-xl border border-brand-line bg-white">
          <HotTable
            ref={hotRef}
            data={initialData}
            colHeaders={(index) => colName(index)}
            rowHeaders
            formulas={{ engine: hyperformulaInstance }}
            width="100%"
            height={360}
            stretchH="all"
            colWidths={
              question.config.initial_sheet?.col_widths ?? [200, 150, 120, 120, 120, 120, 120, 120]
            }
            contextMenu={["row_above", "row_below", "remove_row", "undo", "redo"]}
            licenseKey="non-commercial-and-evaluation"
            afterChange={handleAfterChange}
          />
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-brand-ink/45">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Autosaved
        </span>
        · formulas such as NPV, IRR and SUM are supported
      </p>

      {expectedOutputs.length > 0 && (
        <div className="rounded-xl border border-brand-line bg-brand-cream p-4">
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
            Required model outputs
          </h4>
          <ul className="space-y-2">
            {expectedOutputs.map((output) => (
              <li
                key={output.cell}
                className="flex items-start gap-2.5 text-sm text-brand-ink/70"
              >
                <span className="mt-0.5 shrink-0 rounded bg-brand-gold/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-brand-gold-dark">
                  {output.cell}
                </span>
                <span>{output.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
