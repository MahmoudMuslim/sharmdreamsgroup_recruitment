"use client";

import {
  PERSON_FIELDS,
  personField,
  type PersonField,
  type PersonFieldGroup,
  type PersonFieldTier,
} from "@/modules/candidates/domain/person-fields";
import { noticeFor } from "@/modules/candidates/domain/person-notice";
import type { FieldDraft } from "@/modules/form-builder/domain/draftIssues";
import type { FieldType } from "@/modules/form-builder/domain/field-types";
import {
  INPUT_TO_TYPE,
  PINNED_TYPE,
  UNBINDABLE_TYPES,
} from "@/modules/form-builder/domain/identityIssues";
import { cn } from "@/lib/utils";
import { FIELD_TYPE_LABELS } from "./FieldPalette";

/**
 * The seven application facts and the one type each may carry. Written here as
 * labels only — the type comes from `PINNED_TYPE`, because a second table is
 * how the picker starts offering a pairing publish refuses.
 */
const BARE_KEYS: readonly { key: keyof typeof PINNED_TYPE; label: string; note: string }[] = [
  { key: "name", label: "Candidate's name", note: "the one required name" },
  { key: "email", label: "Candidate's email", note: "the one required email" },
  { key: "phone", label: "Candidate's phone", note: "saved on the application" },
  { key: "about", label: "About-you text", note: "builds the CV text screening reads" },
  { key: "cv", label: "CV file", note: "the attachment screening reads" },
  { key: "linkedin", label: "LinkedIn link", note: "shown on the application" },
  { key: "photo", label: "Candidate's photo", note: "held apart from every AI prompt" },
];

const GROUP_LABELS: Record<PersonFieldGroup, string> = {
  identity: "Identity",
  contact: "Contact",
  work_history: "Work history",
  education: "Education",
  languages: "Languages",
  skills: "Skills & certifications",
  photo: "Photograph",
  marital_status: "Marital status",
  family_details: "Family details",
  dependants: "Dependants",
  emergency_contacts: "Emergency contacts",
  health: "Health and disability",
  housing: "Housing and commute",
  extraction: "CV extraction",
};

const TIER_WORDS: Record<PersonFieldTier, string> = {
  1: "Tier 1 · operational",
  2: "Tier 2 · personal",
  3: "Tier 3 · special category",
};

const TIER_STYLE: Record<PersonFieldTier, string> = {
  1: "bg-sky-500/12 text-sky-700",
  2: "bg-brand-gold/20 text-brand-gold-dark",
  3: "bg-rose-500/12 text-rose-700",
};

/** Registry order, grouped, so the picker reads like the profile it writes to. */
function personGroups(): { group: PersonFieldGroup; fields: PersonField[] }[] {
  const order: PersonFieldGroup[] = [];
  const byGroup = new Map<PersonFieldGroup, PersonField[]>();
  for (const field of PERSON_FIELDS) {
    if (!byGroup.has(field.group)) {
      byGroup.set(field.group, []);
      order.push(field.group);
    }
    byGroup.get(field.group)!.push(field);
  }
  return order.map((group) => ({ group, fields: byGroup.get(group)! }));
}

function reasonForPerson(field: PersonField, type: FieldType): string | null {
  if (UNBINDABLE_TYPES.has(type)) {
    return `a ${FIELD_TYPE_LABELS[type]} field stores nothing the profile holds`;
  }
  const expected = INPUT_TO_TYPE[field.input];
  if (type !== expected) return `needs a ${FIELD_TYPE_LABELS[expected]} field`;
  return null;
}

function reasonForBare(systemKey: string, type: FieldType): string | null {
  const expected = PINNED_TYPE[systemKey];
  if (!expected) return null;
  return type === expected ? null : `needs a ${FIELD_TYPE_LABELS[expected]} field`;
}

/**
 * Bind one field to an application fact or a person fact (spec §6).
 *
 * Every option is gated at the type the writer declares: a key whose pairing
 * `draftIssues` would refuse is shown disabled with the type it needs, so an
 * author never meets that refusal at save time. The one exception the spec
 * calls out is a `list` key, which is greyed on anything but a `multi_select`
 * because its answer appends rows rather than storing one value.
 *
 * A Tier-2 or Tier-3 key prints its group's consent notice under the picker,
 * in the same words a candidate is shown, so the author sees what the question
 * becomes before writing its label.
 */
export function BindingPicker({
  field,
  htmlId,
  disabled,
  onChange,
}: {
  field: FieldDraft;
  /** Stable id from the editor row, because `key` is editable mid-sentence. */
  htmlId: string;
  disabled: boolean;
  onChange: (systemKey: string | null) => void;
}) {
  const groups = personGroups();
  const selectedKey = field.systemKey ?? "";
  const selectedRegistry = selectedKey.startsWith("person:")
    ? personField(selectedKey.slice("person:".length))
    : null;
  const selectedBare = BARE_KEYS.find((entry) => entry.key === selectedKey) ?? null;

  return (
    <div>
      <label htmlFor={htmlId} className="mb-1.5 block text-xs font-bold">
        Saves to
      </label>
      <select
        id={htmlId}
        value={selectedKey}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-xs focus:border-brand-gold focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">A free answer — stored on the application only</option>

        <optgroup label="Application facts">
          {BARE_KEYS.map((entry) => {
            const reason = reasonForBare(entry.key, field.type);
            return (
              <option key={entry.key} value={entry.key} disabled={reason !== null}>
                {entry.label}
                {reason ? ` — ${reason}` : ` — ${entry.note}`}
              </option>
            );
          })}
        </optgroup>

        {groups.map(({ group, fields }) => (
          <optgroup key={group} label={GROUP_LABELS[group]}>
            {fields.map((personFieldEntry) => {
              const reason = reasonForPerson(personFieldEntry, field.type);
              const listNote =
                personFieldEntry.input === "list" ? " — saves each choice as its own row" : "";
              return (
                <option
                  key={personFieldEntry.key}
                  value={`person:${personFieldEntry.key}`}
                  disabled={reason !== null}
                >
                  {personFieldEntry.label} — Tier {personFieldEntry.tier}
                  {listNote}
                  {reason ? ` (${reason})` : ""}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>

      {!field.systemKey && (
        <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/45">
          An unbound answer is kept in the application&apos;s snapshot and shown to
          whoever reviews it. It does not update the candidate&apos;s profile.
        </p>
      )}

      {selectedBare && (
        <div className="mt-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-brand-ink/75">
            Application fact · {selectedBare.note}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/50">
            This field must be a {FIELD_TYPE_LABELS[PINNED_TYPE[selectedBare.key]]} field;
            publish refuses any other pairing.
          </p>
        </div>
      )}

      {selectedRegistry && (
        <div className="mt-2 space-y-2 rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                TIER_STYLE[selectedRegistry.tier],
              )}
            >
              {TIER_WORDS[selectedRegistry.tier]}
            </span>
            <span className="text-[10px] text-brand-ink/45">{GROUP_LABELS[selectedRegistry.group]}</span>
            {selectedRegistry.input === "list" && (
              <span className="rounded bg-brand-sand px-1.5 py-0.5 text-[9px] font-semibold text-brand-ink/60">
                appends a row per choice
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-brand-ink/55">
            Writes the profile&apos;s {selectedRegistry.label.toLowerCase()} field. This field
            must be a {FIELD_TYPE_LABELS[INPUT_TO_TYPE[selectedRegistry.input]]} field.
            {selectedRegistry.tier === 3 && " Publish refuses to mark a Tier-3 question required."}
          </p>

          {selectedRegistry.tier >= 2 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-brand-line/70 bg-white/70 px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-brand-ink/40">
                What the candidate is told
              </p>
              <p className="mt-1 text-[11px] font-semibold leading-relaxed text-brand-ink/70">
                {noticeFor(selectedRegistry.group).title}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
                {noticeFor(selectedRegistry.group).body}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
