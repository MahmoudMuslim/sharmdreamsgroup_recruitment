"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { DrawerActions, Field, FormMessage, Select, TextInput } from "@/modules/analytics/presentation/Form";
import { getOpeningsForAuthoring, type AuthoringOpeningOption } from "./suite-authoring-actions";
import { recommendTests, type TestRecommendationResult } from "./recommendation-actions";
import { TestRecommendationResults } from "./TestRecommendationResults";

export function TestRecommendationDrawer({
  onClose,
  defaultDurationMinutes,
}: {
  onClose: () => void;
  defaultDurationMinutes: number;
}) {
  const [openingId, setOpeningId] = useState("");
  const [openings, setOpenings] = useState<AuthoringOpeningOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingsNote, setOpeningsNote] = useState<string | null>(null);
  const [openingsError, setOpeningsError] = useState<string | null>(null);
  const [budget, setBudget] = useState(() => String(Number.isFinite(defaultDurationMinutes)
    ? Math.min(480, Math.max(5, Math.round(defaultDurationMinutes))) : 60));
  const [result, setResult] = useState<Extract<TestRecommendationResult, { ok: true }> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const generation = useRef(0);
  const minutes = Number(budget);
  const validBudget = budget.trim() !== "" && Number.isInteger(minutes) && minutes >= 5 && minutes <= 480;
  const disabled = loading || busy || !!openingsError || !validBudget || !openings.some((item) => item.id === openingId);

  // Each Strict Mode effect owns its read; an obsolete read must not finish a newer one.
  useEffect(() => {
    let active = true;
    void getOpeningsForAuthoring().then((read) => {
      if (!active) return;
      setOpenings(read.openings);
      setOpeningsNote(read.note);
      setOpeningsError(read.error);
    }).catch(() => {
      if (active) setOpeningsError("Job openings could not be loaded. Close and reopen to try again.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; generation.current += 1; };
  }, []);

  function invalidate(clearResults = false) {
    generation.current++;
    setBusy(false);
    setError(null);
    if (clearResults) {
      setResult(null);
      setSelectedIds([]);
      setRequested(false);
    }
  }

  function close() {
    generation.current++;
    onClose();
  }

  async function generate() {
    if (disabled) return;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    setResult(null);
    setSelectedIds([]);
    setRequested(true);
    try {
      const read = await recommendTests({ openingId, budgetMinutes: minutes });
      if (request !== generation.current) return;
      if (!read.ok) { setError(read.error); return; }
      setResult(read);
      setSelectedIds(read.selectedIds);
    } catch {
      if (request === generation.current) setError("Recommendations could not be loaded. Please try again.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={close}
      eyebrow="Assessment engine"
      title="Recommend existing tests"
      subtitle="Choose a job and a time budget, then review a suggested shortlist of existing tests."
      width="max-w-3xl"
      onSubmit={() => void generate()}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <DrawerActions
            onCancel={close}
            submitLabel={requested ? "Regenerate" : "Recommend tests"}
            pending={busy}
            disabled={disabled}
            note="This shortlist is not saved. Closing discards your selection."
          />
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-brand-gold/50 bg-brand-sand/60 px-4 py-3 text-sm leading-relaxed text-brand-ink/80">
          AI-suggested matches. Quotes are checked against question text; suitability still needs your review.
        </p>
        <FormMessage error={openingsError || error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Job opening" htmlFor="tr-opening" required>
            <Select
              id="tr-opening"
              required
              value={openingId}
              disabled={loading || !!openingsError || openings.length === 0}
              onChange={(event) => { invalidate(true); setOpeningId(event.target.value); }}
            >
              <option value="">{loading ? "Loading openings…" : "Choose a job opening"}</option>
              {openings.map((opening) => <option key={opening.id} value={opening.id}>{opening.label}</option>)}
            </Select>
          </Field>
          <Field label="Budget (minutes)" htmlFor="tr-budget" required>
            <TextInput
              id="tr-budget"
              type="number"
              min={5}
              max={480}
              step={1}
              required
              value={budget}
              aria-invalid={!validBudget}
              aria-describedby="tr-budget-hint"
              onChange={(event) => { invalidate(); setBudget(event.target.value); }}
            />
            <p id="tr-budget-hint" className="mt-1 text-xs text-brand-ink/60">
              {validBudget ? "5–480 whole minutes. Edits update the summary without another AI request."
                : "Enter a whole number from 5 to 480 minutes."}
            </p>
          </Field>
        </div>
        {openingsNote && <p className="rounded-lg bg-brand-cream px-3 py-2 text-xs text-brand-ink/60">{openingsNote}</p>}
        {!loading && !openingsError && openings.length === 0 && (
          <p className="text-sm text-brand-ink/60">No eligible job openings are available. Choose an opening after one is added in Jobs.</p>
        )}
        {busy && <p role="status" className="rounded-xl bg-brand-cream px-4 py-3 text-sm text-brand-ink/70">Finding grounded suggestions in existing tests…</p>}
        {result && (
          <TestRecommendationResults
            result={result}
            selectedIds={selectedIds}
            budgetMinutes={validBudget ? minutes : null}
            onToggle={(id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
          />
        )}
      </div>
    </Drawer>
  );
}
