"use server";

/**
 * The staff preview of one form (spec §6): the walk an applicant would take.
 *
 * Two reads, and each one goes through an authority that already exists.
 * `previewFormLayout` composes this form beside the published global set with
 * `resolveLayout`'s one exception — `includeFormId` — so a draft that no opening
 * asks yet can still be seen, and every other rule (globals first, a colliding
 * key, a ceiling, retirement) is decided by the same lines that decide them for
 * an applicant. `previewFormOnOpening` calls `resolveFormForJob`, the applicant's
 * own read, so a tab named for an opening shows precisely what that opening asks
 * today — including the answer "nothing, it fell back to the built-in wizard".
 *
 * Both return `project()`'s output, the applicant's shape and nothing else: no
 * field id, no `system_key`, no `config`, no registry key. A staff copy of the
 * projection would be a second boundary to keep shut, and the panel would drift
 * from the page it claims to preview.
 *
 * The two refusals stay apart, because they mean different things to the person
 * writing. `broken` says this walk cannot compose at all — an applicant handed
 * the wizard, a publisher handed a refusal. `wouldNotPublish` says the walk does
 * compose and would still be refused at the publish gate: identity issues that
 * only bite once a version is published. A preview that merged the two would
 * flatter a draft the recruiter cannot actually ship.
 *
 * Reads only. Nothing here writes, publishes, assigns or retires, and the panel
 * renders no submit control.
 */

import { requireStaff } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { identityIssues } from "@/modules/form-builder/domain/identityIssues";
import { LIMITS } from "@/modules/form-builder/domain/limits";
import {
  resolveLayout,
  type FieldRow,
  type FormRow,
  type ResolvedLayout,
} from "@/modules/form-builder/domain/resolveLayout";
import { isMissingSchemaError } from "@/modules/interviews/domain/interviewScorecard";
import {
  COMPOSITION_FIELD_COLUMNS,
  COMPOSITION_FORM_COLUMNS,
  project,
  resolveFormForJob,
  toFieldRow,
  toFormRow,
  violationSentence,
  type CompositionFieldRow,
  type CompositionFormRow,
  type PublicForm,
} from "@/modules/form-builder/application/publicForm";

/** The default tab asks no opening, so no assignment joins its walk. */
const COMPOSITION_TAB = "composition";

/** Tabs the panel can list before the list itself stops being scannable. */
const PREVIEW_TAB_LIMIT = 12;

const NOT_THERE = "That form no longer exists.";
const NOT_A_FORM = "That is not a form reference, so there is nothing to preview.";
const MISSING_TABLES =
  "The form tables are not on this database yet (migration 044_application_forms.sql), so no walk can be composed.";
const UNREADABLE = "The form could not be read, so no walk was composed.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The walk one tab shows, with the two refusals kept apart. */
export interface FormPreviewWalk {
  /** The applicant's own projection, or `null` when the walk cannot compose. */
  form: PublicForm | null;
  /** Why nothing composes — the sentence the apply page falls back with. */
  broken: string[];
  /** What a published version of this exact walk would refuse at the publish gate. */
  wouldNotPublish: string[];
  /** False when the form being written is not in the walk on show. */
  showsDraft: boolean;
  /** A bound was hit, so the walk may be missing a form or a question. */
  truncated: boolean;
}

/** One preview tab: the composition, or one opening that asks the form. */
export interface FormPreviewTab {
  /** `null` is the composition tab; everything else is a real opening. */
  openingId: string | null;
  label: string;
}

export interface FormPreviewPayload {
  /** The composition tab, read with the page so the panel paints with it. */
  walk: FormPreviewWalk;
  /** Openings that ask this form, in the order the console reads them. */
  tabs: FormPreviewTab[];
  /** More openings ask it than the panel lists. */
  tabsTruncated: boolean;
  /** A global form is asked everywhere, so no opening has a tab of its own. */
  isGlobal: boolean;
}

function refused(reason: string): FormPreviewWalk {
  return {
    form: null,
    broken: [reason],
    wouldNotPublish: [],
    showsDraft: false,
    truncated: false,
  };
}

/**
 * The walk, the two refusals and the honest flags — from a layout, in one place,
 * so the composition tab and an opening's tab cannot report the same shape
 * differently.
 */
function walkOf(
  layout: ResolvedLayout,
  formId: string,
  truncated: boolean,
): FormPreviewWalk {
  const broken = layout.violations.map(violationSentence);
  if (broken.length > 0) {
    return {
      form: null,
      broken,
      wouldNotPublish: [],
      showsDraft: false,
      truncated,
    };
  }
  return {
    form: project(layout),
    broken: [],
    wouldNotPublish: identityIssues(layout.fields).map((issue) => issue.message),
    showsDraft: layout.fields.some((entry) => entry.field.formId === formId),
    truncated,
  };
}

/**
 * The form beside the published global set, as one application would ask it.
 *
 * The read is deliberately narrow — the globals, this form, and the fields of
 * exactly those forms — because the composition tab answers "what would this
 * application ask", not "what does the library hold". The openings that ask the
 * form are read separately, for the tabs.
 */
export async function previewFormLayout(formId: string): Promise<FormPreviewPayload> {
  await requireStaff("/forms");

  const noTabs = {
    tabs: [] as FormPreviewTab[],
    tabsTruncated: false,
    isGlobal: false,
  };

  if (!UUID_PATTERN.test(formId)) {
    return { walk: refused(NOT_A_FORM), ...noTabs };
  }

  const client = await createServerRestClient();

  const [ownResult, globalsResult] = await Promise.all([
    client
      .from("application_forms")
      .select(COMPOSITION_FORM_COLUMNS)
      .eq("id", formId)
      .maybeSingle(),
    client
      .from("application_forms")
      .select(COMPOSITION_FORM_COLUMNS, { count: "exact" })
      .eq("is_global", true)
      .eq("status", "PUBLISHED")
      .is("archived_at", null)
      .limit(LIMITS.global_forms + 1),
  ]);

  const formsError = ownResult.error ?? globalsResult.error;
  if (formsError) {
    return {
      walk: refused(isMissingSchemaError(formsError) ? MISSING_TABLES : UNREADABLE),
      ...noTabs,
    };
  }

  const own = (ownResult.data ?? null) as CompositionFormRow | null;
  if (!own) return { walk: refused(NOT_THERE), ...noTabs };

  const globalRows = (globalsResult.data ?? []) as unknown as CompositionFormRow[];
  const globalsTruncated = (globalsResult.count ?? 0) > globalRows.length;

  // A published global form is already in the globals read; asking for it twice
  // would ask its questions twice.
  const forms: FormRow[] = [
    ...globalRows.map(toFormRow),
    ...(globalRows.some((row) => row.id === own.id) ? [] : [toFormRow(own)]),
  ];

  const fieldsResult = await client
    .from("application_form_fields")
    .select(COMPOSITION_FIELD_COLUMNS, { count: "exact" })
    .in(
      "form_id",
      forms.map((form) => form.id),
    )
    .limit(forms.length * LIMITS.fields_per_form);

  if (fieldsResult.error) {
    return {
      walk: refused(
        isMissingSchemaError(fieldsResult.error) ? MISSING_TABLES : UNREADABLE,
      ),
      ...noTabs,
    };
  }

  const fieldRows = (fieldsResult.data ?? []) as unknown as CompositionFieldRow[];
  const fieldsByForm: Record<string, FieldRow[]> = {};
  for (const row of fieldRows) {
    const list = fieldsByForm[row.form_id] ?? [];
    list.push(toFieldRow(row));
    fieldsByForm[row.form_id] = list;
  }

  const layout = resolveLayout({
    forms,
    fieldsByForm,
    assignments: [],
    jobId: COMPOSITION_TAB,
    includeFormId: own.id,
  });

  const truncated =
    globalsTruncated ||
    (fieldsResult.count ?? 0) > fieldRows.length ||
    layout.violations.some(
      (violation) => violation.kind === "ceiling" && violation.ceiling === "global_forms",
    );

  // A global form joins every application by definition, so an opening has no
  // walk of its own to tab: the tab that opens on every role is the one shown.
  if (own.is_global) {
    return {
      walk: walkOf(layout, own.id, truncated),
      tabs: [],
      tabsTruncated: false,
      isGlobal: true,
    };
  }

  const assignmentsResult = await client
    .from("job_application_forms")
    .select("job_id", { count: "exact" })
    .eq("form_id", own.id)
    .limit(PREVIEW_TAB_LIMIT + 1);

  const assignmentRows = (assignmentsResult.data ?? []) as unknown as { job_id: string }[];
  const openingIds = [...new Set(assignmentRows.map((row) => row.job_id))].slice(
    0,
    PREVIEW_TAB_LIMIT,
  );

  const tabs: FormPreviewTab[] = [];
  if (openingIds.length > 0) {
    const openingsResult = await client
      .from("job_openings")
      .select("id, title")
      .in("id", openingIds)
      .order("title");
    const openingRows = (openingsResult.data ?? []) as unknown as {
      id: string;
      title: string;
    }[];
    for (const opening of openingRows) {
      tabs.push({ openingId: opening.id, label: opening.title });
    }
  }

  return {
    walk: walkOf(layout, own.id, truncated),
    tabs,
    tabsTruncated: (assignmentsResult.count ?? 0) > assignmentRows.length,
    isGlobal: false,
  };
}

/**
 * What one opening asks right now, through the applicant's own read.
 *
 * Nothing is added to this walk: the draft being written is not in it until the
 * form is published and assigned here, and the panel says so rather than
 * pretending the tab is a preview of the save.
 */
export async function previewFormOnOpening(
  formId: string,
  openingId: string,
): Promise<FormPreviewWalk> {
  await requireStaff("/forms");

  const resolution = await resolveFormForJob(openingId);
  if ("fallback" in resolution) {
    return refused(`${resolution.reason} This opening falls back to the built-in wizard.`);
  }
  return walkOf(resolution, formId, false);
}
