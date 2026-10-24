"use client";

import { useState } from "react";
import {
  DEFAULT_REQUIRED_LEVEL,
  MAX_REQUIRED_SKILLS,
  SKILL_CAP_ERROR,
  SKILL_LEVELS,
  applySkillSuggestions,
  suggestSkillsFromRequirements,
  toggleRequiredSkill,
  type CatalogueSkill,
  type RequiredSkill,
  type RequiredSkillsRead,
} from "@/modules/jobs/domain/openingSkills";

export interface JobSkillsFieldProps {
  /** The skills a recruiter may add — the catalogue's active rows, in its order. */
  skills: readonly CatalogueSkill[];
  /** Every catalogue row, retired included, so a required skill keeps its name. */
  labels: readonly CatalogueSkill[];
  /** The rows this opening carries, in the order they were added. */
  required: readonly RequiredSkill[];
  /** The opening's requirement lines, which is the whole vocabulary a suggestion may use. */
  requirements: readonly string[];
  /** What the surface says instead of a picker when `job_opening_skills` is not on this database. */
  note: string | null;
  onChange: (next: RequiredSkill[]) => void;
}

/**
 * The requisition's skill list, edited.
 *
 * Controlled, and deliberately holding no copy of the rows it is given: the form
 * owns the list because the form decides whether anything was touched, and a
 * picker that kept its own state is how an opening saves a skill list the
 * recruiter can see on screen but never sees on the wire.
 *
 * The three moves it makes are the domain module's own — `toggleRequiredSkill`,
 * `applySkillSuggestions` and the scale and default it prints — because a picker
 * that offers what the save would refuse is the bug this whole slice was built to
 * avoid. It never re-implements the ceiling, and it never adds a skill the
 * catalogue did not name.
 */
export function JobSkillsField({
  skills,
  labels,
  required,
  requirements,
  note,
  onChange,
}: JobSkillsFieldProps) {
  const [refusal, setRefusal] = useState<string | null>(null);

  // While the table is missing the picker is not a disabled picker: there is no
  // list to show and no write that could hold one, so the file name is the whole
  // screen and a click that could produce nothing is not offered at all.
  if (note) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-4">
        <p className="text-sm leading-relaxed text-amber-900">{note}</p>
      </div>
    );
  }

  const suggestions = suggestSkillsFromRequirements(requirements, skills);
  const atCap = required.length >= MAX_REQUIRED_SKILLS;
  const nameOf = (skill_id: string) =>
    labels.find((label) => label.id === skill_id)?.name ?? skill_id;
  // A required skill the catalogue no longer offers has no checkbox to uncheck,
  // so it needs its own row and its own way off — the recruiter has to be able to
  // see and remove what the database already holds.
  const retired = required.filter(
    (row) => !skills.some((skill) => skill.id === row.skill_id)
  );

  function commit(read: RequiredSkillsRead) {
    if (read.ok) {
      setRefusal(null);
      onChange(read.skills);
    } else {
      setRefusal(read.error);
    }
  }

  function remove(skill_id: string) {
    commit({ ok: true, skills: required.filter((row) => row.skill_id !== skill_id) });
  }

  function setLevel(skill_id: string, value: string) {
    const level = Number(value);
    commit({
      ok: true,
      skills: required.map((row) =>
        row.skill_id === skill_id ? { ...row, required_level: level } : row
      ),
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          Required skills
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">
          Tick what this opening asks for and set the level it has to be shown at. A
          skill is only offered here if it is in the catalogue — add one in Settings →
          Master data → Skills first.
        </p>
      </div>

      {(atCap || refusal) && (
        <p className="text-xs font-semibold text-rose-700">{refusal ?? SKILL_CAP_ERROR}</p>
      )}

      <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
        {skills.map((skill) => {
          const row = required.find((each) => each.skill_id === skill.id);
          return (
            <li key={skill.id} className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
              <input
                type="checkbox"
                id={`require-${skill.id}`}
                aria-label={`Require ${skill.name}`}
                checked={Boolean(row)}
                disabled={!row && atCap}
                onChange={() => commit(toggleRequiredSkill(required, skill.id))}
                className="h-4 w-4 shrink-0 accent-brand-gold-dark"
              />
              <label htmlFor={`require-${skill.id}`} className="min-w-0 flex-1 text-sm">
                {skill.name}
              </label>
              {row && <SkillLevel row={row} name={skill.name} onChange={setLevel} />}
              {row && <SourceTag row={row} />}
            </li>
          );
        })}

        {retired.map((row) => (
          <li
            key={row.skill_id}
            className="flex flex-wrap items-center gap-2.5 bg-brand-cream px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 text-sm">
              {nameOf(row.skill_id)}
              <span className="ml-1.5 text-xs text-brand-ink/50">
                — retired from the catalogue
              </span>
            </span>
            <SkillLevel row={row} name={nameOf(row.skill_id)} onChange={setLevel} />
            {row.source === "CATALOGUE_MATCH" && <SourceTag row={row} />}
            <button
              type="button"
              aria-label={`Remove ${nameOf(row.skill_id)}`}
              onClick={() => remove(row.skill_id)}
              className="rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {suggestions.length > 0 && (
        <div className="rounded-xl border border-brand-line bg-brand-cream p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-brand-ink/70">
              The requirement lines already name {suggestions.length} of them.
            </p>
            {/* Enabled even at the ceiling: the ceiling is the domain's answer to
                this click, and a click that refuses itself says so in the same
                words the save would use. */}
            <button
              type="button"
              onClick={() => commit(applySkillSuggestions(required, suggestions))}
              className="rounded-lg border border-brand-gold-dark bg-white px-2.5 py-1 text-xs font-semibold text-brand-gold-dark transition hover:bg-brand-sand"
            >
              Add the skills these lines name
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <span
                key={suggestion.skill_id}
                title={suggestion.line}
                className="max-w-full truncate rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-ink/65 ring-1 ring-brand-line"
              >
                {suggestion.name} — “{suggestion.line}”
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The scale, offered whole, and the level handed back as the number the column holds. */
function SkillLevel({
  row,
  name,
  onChange,
}: {
  row: RequiredSkill;
  name: string;
  onChange: (skill_id: string, value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-brand-ink/55">
      Level
      <select
        aria-label={`Required level for ${name}`}
        value={String(row.required_level)}
        onChange={(event) => onChange(row.skill_id, event.target.value)}
        className="rounded-lg border border-brand-line bg-white px-1.5 py-1 text-xs font-semibold text-brand-ink"
      >
        {SKILL_LEVELS.map((level) => (
          <option key={level} value={String(level)}>
            {level}
          </option>
        ))}
      </select>
      <span className="text-brand-ink/40">
        {row.required_level === DEFAULT_REQUIRED_LEVEL ? "expected" : "set"}
      </span>
    </label>
  );
}

/**
 * Where a row came from — said only for the matcher's rows.
 *
 * A recruiter's own tick needs no provenance; a skill that arrived because a
 * requirement line spelled it out does, because the line is what they can check
 * it against.
 */
function SourceTag({ row }: { row: RequiredSkill }) {
  if (row.source !== "CATALOGUE_MATCH") return null;
  return (
    <span className="rounded-full bg-brand-sand px-2 py-0.5 text-[11px] font-semibold text-brand-ink/60">
      from a requirement line
    </span>
  );
}
