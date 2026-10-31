"use client";

/**
 * The person's six desks, under the record's own facts.
 *
 * `profile.ts` reads the bundle through `readPersonBundle`, so a Tier-3 group
 * this caller may not read is named in `hidden` and never arrives as an empty
 * list — this file's whole job is to keep that distinction visible. "Not shown
 * to you" is a statement about the reader; "nothing recorded" is a statement
 * about the person, and the two are never printed as the same screen.
 *
 * Every write goes through `candidate-actions.ts`: `savePersonFields` at the
 * `profile_edit` rung, `savePersonConsent` as an append-only answer, and the CV
 * structuring pair which previews before it commits. Nothing here decides
 * sensitivity, precedence or consent — the registry and the writer own those.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CalendarRange,
  FileSearch,
  HeartPulse,
  History,
  Loader2,
  Lock,
  Quote,
  ScrollText,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { Badge, Card, CardHeader } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, Select, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import { noticeFor } from "@/modules/candidates/domain/person-notice";
import { personField, type PersonFieldGroup } from "@/modules/candidates/domain/person-fields";
import type { CareerIndicators } from "@/modules/candidates/domain/careerIndicators";
import { formatInZone } from "@/lib/timezone";
import {
  commitExtractionPreview,
  savePersonConsent,
  savePersonFields,
  structurePersonFromCv,
  type CommitPreviewResult,
  type ExtractPreviewResult,
} from "../candidate-actions";
import type {
  EditablePersonField,
  PersonBundleView,
  PersonConsentView,
  PersonEducationView,
  PersonEmploymentView,
  PersonSkillView,
  PersonCertificationView,
} from "./profile";

type TabKey = "history" | "skills" | "background" | "health" | "family" | "changes";

const TABS: { key: TabKey; label: string; icon: typeof History }[] = [
  { key: "history", label: "History", icon: History },
  { key: "skills", label: "Skills", icon: BadgeCheck },
  { key: "background", label: "Background", icon: UserRound },
  { key: "health", label: "Health", icon: HeartPulse },
  { key: "family", label: "Family", icon: Users },
  { key: "changes", label: "Changes", icon: ScrollText },
];

export function PersonTabs({
  applicationId,
  bundle,
  indicators,
  fields,
  canWrite,
  hasCv,
  zone,
}: {
  applicationId: string;
  bundle: PersonBundleView;
  indicators: CareerIndicators | null;
  fields: EditablePersonField[];
  canWrite: boolean;
  hasCv: boolean;
  zone: string;
}) {
  const [tab, setTab] = useState<TabKey>("history");

  return (
    <Card className="mt-6">
      <CardHeader
        title="The person"
        meta="everything the profile holds, behind the tier it sits on"
      />

      <div
        className="flex flex-wrap items-center gap-2 border-b border-brand-line/60 px-5 pb-4 sm:px-6"
        role="tablist"
        aria-label="Person profile sections"
      >
        {TABS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              id={`person-tab-${option.key}`}
              aria-selected={tab === option.key}
              aria-controls={`person-panel-${option.key}`}
              onClick={() => setTab(option.key)}
              className={
                tab === option.key
                  ? "inline-flex items-center gap-1.5 rounded-xl bg-brand-ink px-3 py-1.5 text-xs font-semibold text-brand-cream shadow-soft transition"
                  : "inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/65 transition hover:bg-brand-sand"
              }
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {option.label}
              {option.key === "health" && bundle.hidden.includes("health") && (
                <Lock className="h-3 w-3 opacity-60" aria-label="withheld from this account" />
              )}
              {option.key === "family" &&
                ["family_details", "dependants", "emergency_contacts"].some((group) =>
                  bundle.hidden.includes(group)
                ) && <Lock className="h-3 w-3 opacity-60" aria-label="partly withheld from this account" />}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`person-panel-${tab}`}
        aria-labelledby={`person-tab-${tab}`}
        className="px-5 py-5 sm:px-6"
      >
        {!bundle.available ? (
          <p className="rounded-xl border border-brand-line bg-brand-cream/60 px-4 py-3 text-sm leading-relaxed text-brand-ink/65">
            {bundle.note ?? "The person store is not on this database yet."} The application record
            above is unchanged and complete; this half appears once the migration is applied.
          </p>
        ) : tab === "history" ? (
          <HistoryPanel bundle={bundle} indicators={indicators} />
        ) : tab === "skills" ? (
          <SkillsPanel bundle={bundle} />
        ) : tab === "background" ? (
          <BackgroundPanel
            applicationId={applicationId}
            bundle={bundle}
            fields={fields}
            canWrite={canWrite}
            hasCv={hasCv}
            zone={zone}
          />
        ) : tab === "health" ? (
          <HealthPanel
            applicationId={applicationId}
            bundle={bundle}
            fields={fields}
            canWrite={canWrite}
            zone={zone}
          />
        ) : tab === "family" ? (
          <FamilyPanel
            applicationId={applicationId}
            bundle={bundle}
            fields={fields}
            canWrite={canWrite}
            zone={zone}
          />
        ) : (
          <ChangesPanel bundle={bundle} zone={zone} />
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

function HistoryPanel({
  bundle,
  indicators,
}: {
  bundle: PersonBundleView;
  indicators: CareerIndicators | null;
}) {
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Career indicators</SectionTitle>
        {indicators ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Total experience"
                value={`${(indicators.totalMonths / 12).toFixed(1)} years`}
                note={`${indicators.roles} dated role${indicators.roles === 1 ? "" : "s"}`}
              />
              <Figure
                label="Longest role"
                value={months(indicators.longestRoleMonths)}
                note={
                  indicators.shortestRoleMonths !== null
                    ? `shortest ${months(indicators.shortestRoleMonths)}`
                    : "—"
                }
              />
              <Figure
                label="Gaps between roles"
                value={months(indicators.gapMonthsTotal)}
                note={
                  indicators.longestGapMonths !== null
                    ? `longest ${months(indicators.longestGapMonths)}`
                    : "one role, so no gap to measure"
                }
              />
              <Figure
                label="Roles per five years"
                value={
                  indicators.changesPerFiveYears === null
                    ? "—"
                    : indicators.changesPerFiveYears.toFixed(2)
                }
                note="a count over the dated span, not a verdict"
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/55">
              {indicators.coverage.withMonths} of {indicators.coverage.rows} role
              {indicators.coverage.rows === 1 ? "" : "s"} state a start month, so the rest are
              counted as whole years. {indicators.coverage.withEnd} state an end — an ongoing
              role&apos;s end is &ldquo;now&rdquo;. No figure here is a score, and none is attached
              to the AI screening above.
            </p>
            {indicators.caveats.length > 0 && (
              <ul className="mt-2 space-y-1">
                {indicators.caveats.map((caveat) => (
                  <li
                    key={caveat}
                    className="flex items-start gap-2 text-[11px] leading-relaxed text-brand-ink/60"
                  >
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold-dark" aria-hidden />
                    {caveat}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-brand-ink/55">
            No dated roles are on file, so there is nothing to count. A hand edit or the CV
            structuring fills this — zero experience is not a figure this page will print.
          </p>
        )}
      </section>

      <section>
        <SectionTitle>Work history</SectionTitle>
        {bundle.employment.length === 0 ? (
          <Empty>No employment rows yet.</Empty>
        ) : (
          <ul className="divide-y divide-brand-line/60">
            {bundle.employment.map((role) => (
              <EmploymentRow key={role.id} role={role} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Education</SectionTitle>
        {bundle.education.length === 0 ? (
          <Empty>No education rows yet.</Empty>
        ) : (
          <ul className="divide-y divide-brand-line/60">
            {bundle.education.map((school) => (
              <EducationRow key={school.id} school={school} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Languages</SectionTitle>
        {bundle.languages.length === 0 ? (
          <Empty>No languages on file yet.</Empty>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {bundle.languages.map((language) => (
              <span
                key={`${language.language}:${language.proficiency}`}
                className="rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-semibold text-brand-ink/70"
              >
                {language.language}
                <span className="ml-1 font-normal text-brand-ink/50">
                  {humanize(language.proficiency)}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmploymentRow({ role }: { role: PersonEmploymentView }) {
  return (
    <li className="py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <CalendarRange className="h-4 w-4 text-brand-ink/40" aria-hidden />
        {role.employer}
        {role.title && <span className="font-normal text-brand-ink/65">· {role.title}</span>}
        <Badge tone="neutral">{span(role)}</Badge>
        {role.ongoing && <Badge tone="success">ongoing</Badge>}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
        {[role.location, sourceLabel(role.source)].filter(Boolean).join(" · ")}
      </p>
      {role.duties && (
        <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/65">{role.duties}</p>
      )}
      {role.as_written && <Written line={role.as_written} />}
    </li>
  );
}

function EducationRow({ school }: { school: PersonEducationView }) {
  const years = [school.start_year, school.end_year ?? school.graduation_year]
    .filter((year): year is number => year !== null)
    .join("–");
  return (
    <li className="py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {school.institution}
        <Badge tone="neutral">{humanize(school.level)}</Badge>
        {years && <span className="text-[11px] font-normal text-brand-ink/55">{years}</span>}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
        {[school.degree, school.field, school.honors, sourceLabel(school.source)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {school.as_written && <Written line={school.as_written} />}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

function SkillsPanel({ bundle }: { bundle: PersonBundleView }) {
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Skills claimed</SectionTitle>
        {bundle.skills.length === 0 ? (
          <Empty>
            No skill rows yet. A skill is kept in the person&apos;s own words; a level is kept only
            when they stated one.
          </Empty>
        ) : (
          <ul className="divide-y divide-brand-line/60">
            {bundle.skills.map((skill) => (
              <SkillRow key={skill.id} skill={skill} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Certifications</SectionTitle>
        {bundle.certifications.length === 0 ? (
          <Empty>No certifications on file yet.</Empty>
        ) : (
          <ul className="divide-y divide-brand-line/60">
            {bundle.certifications.map((certification) => (
              <CertificationRow key={certification.id} certification={certification} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SkillRow({ skill }: { skill: PersonSkillView }) {
  return (
    <li className="py-2.5">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {skill.skill}
        <Badge tone={skill.proficiency === null ? "neutral" : "gold"}>
          {skill.proficiency === null ? "no level stated" : `${skill.proficiency}/5`}
        </Badge>
      </p>
      <p className="mt-0.5 text-[11px] text-brand-ink/55">{sourceLabel(skill.source)}</p>
      {skill.as_written && <Written line={skill.as_written} />}
    </li>
  );
}

function CertificationRow({ certification }: { certification: PersonCertificationView }) {
  return (
    <li className="py-2.5">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {certification.title}
        {certification.year !== null && (
          <span className="text-[11px] font-normal text-brand-ink/55">{certification.year}</span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-brand-ink/55">
        {[certification.issuer, sourceLabel(certification.source)].filter(Boolean).join(" · ")}
      </p>
      {certification.as_written && <Written line={certification.as_written} />}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Background — consent, CV structuring, and the hand-edit forms                */
/* -------------------------------------------------------------------------- */

const BACKGROUND_GROUPS: { group: PersonFieldGroup; title: string; blurb: string }[] = [
  {
    group: "identity",
    title: "Identity",
    blurb:
      "The name the record is held under and the facts on it. Age is worked out from the date of birth when it is printed — it is never stored.",
  },
  {
    group: "contact",
    title: "Contact and location",
    blurb: "How the group reaches this person, and the city they are currently in.",
  },
  {
    group: "marital_status",
    title: "Marital status and children",
    blurb:
      "A status and a count, kept as the person stated them. Never entered into an automatic score.",
  },
  {
    group: "housing",
    title: "Housing and commute",
    blurb: "Practical facts about getting to work, and whether moving is on the table.",
  },
];

function BackgroundPanel({
  applicationId,
  bundle,
  fields,
  canWrite,
  hasCv,
  zone,
}: {
  applicationId: string;
  bundle: PersonBundleView;
  fields: EditablePersonField[];
  canWrite: boolean;
  hasCv: boolean;
  zone: string;
}) {
  const values = personValues(bundle);

  return (
    <div className="space-y-6">
      <ConsentPanel
        applicationId={applicationId}
        consents={bundle.consents}
        canWrite={canWrite}
        zone={zone}
      />

      {canWrite && hasCv && (
        <ExtractionPanel applicationId={applicationId} consents={bundle.consents} />
      )}

      {BACKGROUND_GROUPS.map((group) => {
        const groupFields = fields.filter((field) => field.group === group.group);
        if (groupFields.length === 0) return null;
        return (
          <PersonGroupCard
            key={`${group.group}:${JSON.stringify(values)}`}
            applicationId={applicationId}
            title={group.title}
            blurb={group.blurb}
            fields={groupFields}
            values={values}
            canWrite={canWrite}
          />
        );
      })}

      {!canWrite && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">
          This account can read the profile but not edit it. Editing needs the Edit candidates
          permission.
        </p>
      )}
    </div>
  );
}

/** One registry group's fields: live controls when the caller may write, else values. */
function PersonGroupCard({
  applicationId,
  title,
  blurb,
  fields,
  values,
  canWrite,
}: {
  applicationId: string;
  title: string;
  blurb: string;
  fields: EditablePersonField[];
  values: Record<string, string>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...values }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ key: string; reason: string }[]>([]);
  const [conflicts, setConflicts] = useState<
    { key: string; held: string; incoming: string; winner: string }[]
  >([]);

  const changed = fields.filter((field) => (drafts[field.key] ?? "") !== (values[field.key] ?? ""));

  async function submit() {
    if (changed.length === 0) {
      setError("Nothing has changed in this section.");
      setSuccess(null);
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    setRefused([]);
    setConflicts([]);
    try {
      const result = await savePersonFields({
        applicationId,
        fields: changed.map((field) => ({ key: field.key, value: drafts[field.key] ?? "" })),
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save these fields.");
        setRefused(result.refused ?? []);
        return;
      }
      setSuccess(
        result.applied && result.applied.length > 0
          ? `Saved ${result.applied.length} field${result.applied.length === 1 ? "" : "s"}.`
          : "Nothing was written."
      );
      setRefused(result.refused ?? []);
      setConflicts(result.conflicts ?? []);
      router.refresh();
    } catch {
      setError("Something went wrong saving the profile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-white/70 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold">{title}</h4>
        <p className="max-w-xl text-[11px] leading-relaxed text-brand-ink/55">{blurb}</p>
      </div>

      {canWrite ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <PersonFieldControl
              key={field.key}
              field={field}
              value={drafts[field.key] ?? ""}
              onChange={(value) => {
                setDrafts((previous) => ({ ...previous, [field.key]: value }));
                setError(null);
                setSuccess(null);
              }}
            />
          ))}
        </div>
      ) : (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-[11px] text-brand-ink/50">{field.label}</dt>
              <dd className="text-right text-[11px] font-semibold">
                {values[field.key] ? readable(field, values[field.key]) : "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || changed.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-3.5 py-2 text-xs font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Save {changed.length > 0 ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : "changes"}
          </button>
          <span className="text-[11px] text-brand-ink/45">
            Only the fields you changed are written, each with its own history row.
          </span>
        </div>
      )}

      <FormMessage error={error} success={success} />
      {refused.length > 0 && (
        <ul className="mt-2 space-y-1">
          {refused.map((entry) => (
            <li
              key={`${entry.key}:${entry.reason}`}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
            >
              <span className="font-semibold">
                {personField(entry.key)?.label ?? entry.key}:
              </span>{" "}
              {entry.reason}
            </li>
          ))}
        </ul>
      )}
      {conflicts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {conflicts.map((conflict) => (
            <li
              key={conflict.key}
              className="rounded-xl border border-brand-line bg-brand-cream/60 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/65"
            >
              <span className="font-semibold">
                {personField(conflict.key)?.label ?? conflict.key}:
              </span>{" "}
              kept the value a higher door wrote. The incoming {conflict.incoming.replace(/_/g, " ")}{" "}
              does not outrank it.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonFieldControl({
  field,
  value,
  onChange,
}: {
  field: EditablePersonField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `person-field-${field.key}`;
  const hint =
    field.maxChars !== undefined
      ? `Up to ${field.maxChars} characters.`
      : field.tier === 3
        ? "Tier 3 — read only by the holder of this group's grant."
        : undefined;

  if (field.input === "select") {
    return (
      <Field label={field.label} htmlFor={id} hint={hint}>
        <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not stated</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {humanize(option)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (field.input === "textarea") {
    return (
      <Field label={field.label} htmlFor={id} hint={hint} className="sm:col-span-2">
        <TextArea
          id={id}
          rows={3}
          value={value}
          maxLength={field.maxChars}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} htmlFor={id} hint={hint}>
      <TextInput
        id={id}
        type={field.input === "date" ? "date" : field.input === "number" ? "number" : "text"}
        value={value}
        maxLength={field.maxChars}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                     */
/* -------------------------------------------------------------------------- */

function ConsentPanel({
  applicationId,
  consents,
  canWrite,
  zone,
}: {
  applicationId: string;
  consents: PersonConsentView[];
  canWrite: boolean;
  zone: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(purpose: PersonFieldGroup, granted: boolean) {
    setPending(`${purpose}:${granted}`);
    setError(null);
    try {
      const result = await savePersonConsent({ applicationId, purpose, granted });
      if (!result.ok) {
        setError(result.error ?? "Could not record the answer.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong recording the answer.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-cream/50 p-4">
      <h4 className="text-sm font-bold">What the candidate agreed to</h4>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-brand-ink/55">
        One row per answer, newest wins. Nothing is edited: a change of mind is a later row, and a
        field whose group has no live agreement is refused rather than saved. Record here what the
        candidate said — this desk does not decide it for them.
      </p>

      <FormMessage error={error} />

      <ul className="mt-3 divide-y divide-brand-line/60">
        {consents.map((consent) => {
          const notice = noticeFor(consent.purpose);
          const busy = pending?.startsWith(`${consent.purpose}:`) === true;
          return (
            <li key={consent.purpose} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {notice.title}
                  <ConsentBadge consent={consent} />
                  {consent.recorded_at && (
                    <span className="text-[10px] font-normal uppercase tracking-wide text-brand-ink/45">
                      {stamp(consent.recorded_at, zone)}
                    </span>
                  )}
                </p>
                {canWrite && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy || consent.live}
                      onClick={() => record(consent.purpose, true)}
                      className="rounded-lg border border-brand-line bg-white px-2.5 py-1 text-[11px] font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Record agreement
                    </button>
                    <button
                      type="button"
                      disabled={busy || (consent.answered && !consent.granted)}
                      onClick={() => record(consent.purpose, false)}
                      className="rounded-lg border border-brand-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-ink/65 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Record refusal
                    </button>
                  </div>
                )}
              </div>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] font-semibold text-brand-ink/50 hover:text-brand-ink">
                  The wording they were asked
                </summary>
                <p className="mt-1.5 rounded-xl border border-brand-line bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-brand-ink/70">
                  {notice.body}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/55">
                  {notice.withdraw}
                </p>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ConsentBadge({ consent }: { consent: PersonConsentView }) {
  if (!consent.answered) return <Badge tone="neutral">not asked yet</Badge>;
  if (consent.live) return <Badge tone="success">agreed</Badge>;
  if (consent.granted) return <Badge tone="gold">agreed to an older notice — record it again</Badge>;
  return <Badge tone="danger">declined</Badge>;
}

/* -------------------------------------------------------------------------- */
/* CV structuring                                                              */
/* -------------------------------------------------------------------------- */

function ExtractionPanel({
  applicationId,
  consents,
}: {
  applicationId: string;
  consents: PersonConsentView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ExtractPreviewResult["preview"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<CommitPreviewResult | null>(null);

  const extractionLive = consents.some(
    (consent) => consent.purpose === "extraction" && consent.live
  );

  async function structure() {
    setPending(true);
    setError(null);
    setCommitted(null);
    try {
      const result = await structurePersonFromCv(applicationId);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "The CV could not be structured.");
        setPreview(null);
        return;
      }
      setPreview(result.preview);
    } catch {
      setError("Something went wrong reading the CV.");
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await commitExtractionPreview({
        applicationId,
        profile: preview.profile,
      });
      setCommitted(result);
      if (result.ok) {
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("Something went wrong writing the preview.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-white/70 p-4">
      <h4 className="flex items-center gap-2 text-sm font-bold">
        <Sparkles className="h-4 w-4 text-brand-gold-dark" aria-hidden />
        Structure the CV into the profile
      </h4>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-brand-ink/55">
        Reads the stored CV and reports dated roles, schooling, languages, skills and certificates.
        Nothing is written until you read the preview and confirm it, and a value it finds fills an
        empty field only — it never overwrites a hand.
      </p>

      {!extractionLive && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          The candidate has no live agreement to the CV-structuring notice, so this door is shut.
          Record their answer in the consent list above first.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={structure}
          disabled={pending || !extractionLive}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-3.5 py-2 text-xs font-bold text-brand-on-accent shadow-soft transition hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FileSearch className="h-3.5 w-3.5" aria-hidden />
          )}
          {pending ? "Reading the CV…" : "Preview what the CV says"}
        </button>
      </div>

      <FormMessage error={error} />

      {preview && (
        <div className="mt-4 rounded-xl border border-brand-line bg-brand-cream/50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/50">
            Preview · nothing saved yet
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/65">
            {preview.counts.roles} role{preview.counts.roles === 1 ? "" : "s"} ·{" "}
            {preview.counts.schools} school{preview.counts.schools === 1 ? "" : "s"} ·{" "}
            {preview.counts.languages} language{preview.counts.languages === 1 ? "" : "s"} ·{" "}
            {preview.counts.skills} skill{preview.counts.skills === 1 ? "" : "s"} ·{" "}
            {preview.counts.certifications} certificate
            {preview.counts.certifications === 1 ? "" : "s"}
          </p>

          <PreviewList title="Roles">
            {preview.profile.experience.map((role, index) => (
              <li key={`role-${index}`}>
                {role.employer}
                {role.title ? ` — ${role.title}` : ""} ({role.startYear}
                {role.ongoing ? "–ongoing" : role.endYear ? `–${role.endYear}` : ", no end stated"})
                {role.asWritten && <span className="text-brand-ink/45"> · “{role.asWritten}”</span>}
              </li>
            ))}
          </PreviewList>

          <PreviewList title="Education">
            {preview.profile.education.map((school, index) => (
              <li key={`school-${index}`}>
                {school.institution} — {humanize(school.level)}
                {school.graduationYear ? ` (${school.graduationYear})` : ""}
                {school.asWritten && (
                  <span className="text-brand-ink/45"> · “{school.asWritten}”</span>
                )}
              </li>
            ))}
          </PreviewList>

          <PreviewList title="Languages">
            {preview.profile.languages.map((language) => (
              <li key={`language-${language.language}`}>
                {language.language} — {humanize(language.proficiency)}
              </li>
            ))}
          </PreviewList>

          <PreviewList title="Skills">
            {preview.profile.skills.map((skill, index) => (
              <li key={`skill-${index}`}>
                {skill.skill}
                {skill.proficiency ? ` — ${skill.proficiency}/5` : " — no level stated"}
                {skill.asWritten && <span className="text-brand-ink/45"> · “{skill.asWritten}”</span>}
              </li>
            ))}
          </PreviewList>

          <PreviewList title="Certifications">
            {preview.profile.certifications.map((certification, index) => (
              <li key={`certification-${index}`}>
                {certification.title}
                {certification.issuer ? ` — ${certification.issuer}` : ""}
                {certification.year ? ` (${certification.year})` : ""}
              </li>
            ))}
          </PreviewList>

          {preview.profile.location && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/65">
              Current city: <span className="font-semibold">{preview.profile.location}</span>
            </p>
          )}

          {preview.dropped.length > 0 && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900">
              The model returned {preview.dropped.join(", ")} — outside the operational list this
              extraction may write, so {preview.dropped.length === 1 ? "it was" : "they were"}{" "}
              dropped and named here rather than saved.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={commit}
              disabled={committing}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-3.5 py-2 text-xs font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {committing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Write it into the profile
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={committing}
              className="rounded-xl border border-brand-line bg-white px-3.5 py-2 text-xs font-semibold transition hover:bg-brand-sand disabled:opacity-60"
            >
              Discard the preview
            </button>
          </div>
        </div>
      )}

      {committed && (
        <div className="mt-3 space-y-1">
          {committed.ok ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-900">
              Wrote {(committed.applied ?? []).length} section
              {(committed.applied ?? []).length === 1 ? "" : "s"} into the profile
              {(committed.conflicts ?? []).length > 0
                ? `; ${(committed.conflicts ?? []).length} kept a human's rows instead`
                : ""}
              {(committed.refused ?? []).length > 0
                ? `; ${(committed.refused ?? []).length} refused`
                : ""}
              .
            </p>
          ) : (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
              {committed.error ?? "The preview could not be written."}
            </p>
          )}
          {(committed.refused ?? []).map((entry) => (
            <p
              key={`${entry.key}:${entry.reason}`}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
            >
              <span className="font-semibold">{entry.key}:</span> {entry.reason}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function PreviewList({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-brand-ink/70">
        {children}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

function HealthPanel({
  applicationId,
  bundle,
  fields,
  canWrite,
  zone,
}: {
  applicationId: string;
  bundle: PersonBundleView;
  fields: EditablePersonField[];
  canWrite: boolean;
  zone: string;
}) {
  const values = personValues(bundle);

  if (bundle.hidden.includes("health")) {
    return (
      <NotShown
        title="Health data is not shown to you"
        permission="candidates.view_health_data"
        note="This is a special-category group behind its own grant. The absence of rows here is a statement about your account, not about this person."
      />
    );
  }

  const healthFields = fields.filter((field) => field.group === "health");
  const consent = bundle.consents.find((entry) => entry.purpose === "health");

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-brand-ink/55">
        You hold the health-data grant, so this open is recorded in the activity trail. Health
        answers are never handed to a model, never used to screen and never scored.{" "}
        {consent?.live
          ? ""
          : "The person's agreement to this group is not live, so a hand edit here will be refused until the answer is recorded in Background."}
      </p>

      {healthFields.length > 0 ? (
        <PersonGroupCard
          key={`health:${JSON.stringify(values)}`}
          applicationId={applicationId}
          title="Health and disability"
          blurb="Every question is optional; the group may be declined as a whole."
          fields={healthFields}
          values={values}
          canWrite={canWrite}
        />
      ) : (
        <Empty>No health columns are on file yet.</Empty>
      )}

      {bundle.health === null && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">
          No health row has been written. That is one of three different facts — never asked, asked
          and declined, or asked and left blank — and the consent list in Background tells them
          apart.
        </p>
      )}
      <p className="text-[10px] uppercase tracking-wide text-brand-ink/40">Read in {zone}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Family                                                                      */
/* -------------------------------------------------------------------------- */

const FAMILY_WITHHELD = [
  { group: "family_details", permission: "candidates.view_family_data", label: "Family details" },
  { group: "dependants", permission: "candidates.view_family_data", label: "Dependants" },
  {
    group: "emergency_contacts",
    permission: "candidates.view_emergency_contacts",
    label: "Emergency contacts",
  },
];

function FamilyPanel({
  applicationId,
  bundle,
  fields,
  canWrite,
  zone,
}: {
  applicationId: string;
  bundle: PersonBundleView;
  fields: EditablePersonField[];
  canWrite: boolean;
  zone: string;
}) {
  const values = personValues(bundle);
  const familyFields = fields.filter((field) => field.group === "family_details");
  const withheld = FAMILY_WITHHELD.filter((entry) => bundle.hidden.includes(entry.group));

  return (
    <div className="space-y-4">
      {withheld.map((entry) => (
        <NotShown
          key={entry.group}
          title={`${entry.label} ${withheld.length === 1 ? "is" : "are"} not shown to you`}
          permission={entry.permission}
          note="This is other people's data behind a named grant. An empty list here does not mean there is nothing to see."
        />
      ))}

      {familyFields.length > 0 && (
        <PersonGroupCard
          key={`family:${JSON.stringify(values)}`}
          applicationId={applicationId}
          title="Family details"
          blurb="Partner details, the wedding date and who lives in the house. Held for the person who shared them, not for screening."
          fields={familyFields}
          values={values}
          canWrite={canWrite}
        />
      )}

      {!bundle.hidden.includes("dependants") && (
        <section>
          <SectionTitle>Dependants</SectionTitle>
          {bundle.dependants.length === 0 ? (
            <Empty>No dependants have been recorded.</Empty>
          ) : (
            <ul className="divide-y divide-brand-line/60">
              {bundle.dependants.map((dependant) => (
                <li key={dependant.id} className="py-2.5">
                  <p className="text-sm font-semibold">
                    {dependant.name}
                    <span className="ml-2 text-[11px] font-normal text-brand-ink/55">
                      {humanize(dependant.relationship)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-ink/55">
                    {[dependant.date_of_birth ? `born ${day(dependant.date_of_birth, zone)}` : null, dependant.note]
                      .filter(Boolean)
                      .join(" · ") || "no further detail"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!bundle.hidden.includes("emergency_contacts") && (
        <section>
          <SectionTitle>Emergency contacts</SectionTitle>
          {bundle.emergency_contacts.length === 0 ? (
            <Empty>No emergency contacts have been recorded.</Empty>
          ) : (
            <ul className="divide-y divide-brand-line/60">
              {bundle.emergency_contacts.map((contact) => (
                <li key={contact.id} className="py-2.5">
                  <p className="text-sm font-semibold">
                    {contact.name}
                    <span className="ml-2 text-[11px] font-normal text-brand-ink/55">
                      {humanize(contact.relationship ?? "contact")} · {contact.phone}
                    </span>
                    <Badge tone="neutral">{contact.sequence === 1 ? "primary" : "secondary"}</Badge>
                  </p>
                  {contact.note && (
                    <p className="mt-0.5 text-[11px] text-brand-ink/55">{contact.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {withheld.length === 0 && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50">
          Opens of emergency contacts and family details are not written to the activity trail —
          only the health open is logged.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Changes                                                                     */
/* -------------------------------------------------------------------------- */

const DOOR_LABELS: Record<string, string> = {
  hand_record: "a recruiter recording the person",
  profile_edit: "the profile desk",
  cv_extraction: "a model reading the CV",
  candidate_form: "the candidate's own form",
  privacy_page: "the candidate's privacy page",
  system: "a system backfill",
  merge: "a person merge",
};

function ChangesPanel({ bundle, zone }: { bundle: PersonBundleView; zone: string }) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-brand-ink/55">
        Every write to this person, with the door it came through. A row about a Tier-3 group is
        only here when your account holds that group&apos;s grant.
      </p>

      {bundle.events.length === 0 ? (
        <Empty>No change has been recorded on the profile spine yet.</Empty>
      ) : (
        <ul className="divide-y divide-brand-line/60">
          {bundle.events.map((event) => (
            <li key={event.id} className="py-2.5">
              <p className="text-[11px] leading-relaxed">
                <span className="font-semibold">
                  {personField(event.field_key)?.label ?? humanize(event.field_key)}
                </span>{" "}
                <span className="text-brand-ink/50">—</span>{" "}
                <span className="text-brand-ink/50">{event.old_value ?? "empty"}</span>{" "}
                <span className="text-brand-ink/40">→</span>{" "}
                <span className="font-semibold">{event.new_value ?? "empty"}</span>
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-brand-ink/45">
                {stamp(event.recorded_at, zone)} · {DOOR_LABELS[event.door] ?? humanize(event.door)}{" "}
                · written by {event.actor_kind}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                                */
/* -------------------------------------------------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45">
      {children}
    </h4>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-cream/50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-ink/45">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-tight">{value}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-brand-ink/50">{note}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-brand-ink/55">{children}</p>;
}

function Written({ line }: { line: string }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] italic leading-relaxed text-brand-ink/50">
      <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {line}
    </p>
  );
}

function NotShown({
  title,
  permission,
  note,
}: {
  title: string;
  permission: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-brand-line bg-brand-cream/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="h-4 w-4 text-brand-ink/45" aria-hidden />
        {title}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-brand-ink/60">
        {note} It needs the{" "}
        <code className="rounded bg-white px-1 py-0.5 text-[10px]">{permission}</code> grant.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `Mar 2018 – ongoing`, or the year alone when that is all the row states. */
function span(role: PersonEmploymentView): string {
  const start =
    role.startMonth === null
      ? String(role.startYear)
      : `${MONTHS[role.startMonth - 1]} ${role.startYear}`;

  if (role.ongoing) return `${start} – ongoing`;
  if (role.endYear === null) return `${start} – no end stated`;
  const end =
    role.endMonth === null ? String(role.endYear) : `${MONTHS[role.endMonth - 1]} ${role.endYear}`;
  return `${start} – ${end}`;
}

function months(value: number | null): string {
  if (value === null) return "—";
  if (value < 12) return `${value.toFixed(1)} months`;
  return `${(value / 12).toFixed(1)} years`;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function sourceLabel(source: string | null): string {
  if (!source) return "";
  if (source === "cv_extraction") return "from the CV, confirmed at a door";
  if (source === "candidate_form") return "the candidate's own answer";
  return "recorded by hand";
}

function day(iso: string, zone: string): string {
  return formatInZone(`${iso}T00:00:00Z`, zone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function stamp(iso: string, zone: string): string {
  return formatInZone(iso, zone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Display value for a select field: the stored value, humanized. */
function readable(field: EditablePersonField, value: string): string {
  return field.input === "select" ? humanize(value) : value;
}

/**
 * Every scalar the background/health/family forms can hold, as the strings a
 * controlled input needs. A key the bundle does not carry is absent, and the
 * form's initial value for it is "unchanged" — which is the same fact as empty.
 */
function personValues(bundle: PersonBundleView): Record<string, string> {
  const profile = bundle.profile;
  const health = bundle.health;
  const family = bundle.family;
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? "" : String(value);

  return {
    legal_name: profile?.legal_name ?? "",
    preferred_name: profile?.preferred_name ?? "",
    pronouns: profile?.pronouns ?? "",
    gender: profile?.gender ?? "",
    date_of_birth: profile?.date_of_birth ?? "",
    birthplace: profile?.birthplace ?? "",
    national_id: profile?.national_id ?? "",
    nationality: profile?.nationality ?? "",
    phone: profile?.phone ?? "",
    mailing_address: profile?.mailing_address ?? "",
    current_city: profile?.current_city ?? "",
    marital_status: profile?.marital_status ?? "",
    children_count: number(profile?.children_count),
    household_size: number(profile?.household_size),
    housing_tenure: profile?.housing_tenure ?? "",
    commute_mode: profile?.commute_mode ?? "",
    commute_minutes: number(profile?.commute_minutes),
    relocation_willingness: profile?.relocation_willingness ?? "",
    travel_restrictions: profile?.travel_restrictions ?? "",
    disability_status: health?.disability_status ?? "",
    accommodations: health?.accommodations ?? "",
    chronic_conditions: health?.chronic_conditions ?? "",
    allergies: health?.allergies ?? "",
    dietary_restrictions: health?.dietary_restrictions ?? "",
    blood_type: health?.blood_type ?? "",
    health_insurance: health?.health_insurance ?? "",
    partner_name: family?.partner_name ?? "",
    partner_occupation: family?.partner_occupation ?? "",
    partner_contact: family?.partner_contact ?? "",
    anniversary_date: family?.anniversary_date ?? "",
    household_composition: family?.household_composition ?? "",
    family_planning: family?.family_planning ?? "",
  };
}
