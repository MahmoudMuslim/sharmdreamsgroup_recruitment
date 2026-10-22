/**
 * What a new opening takes from the position it starts from.
 *
 * A position is the definition of a post — title, department, description,
 * requirements and salary band — and an opening is one intake of it. A create may
 * name a position and leave the copy out, so the definition is typed once in
 * Settings and inherited by every intake instead of retyped and drifted.
 *
 * Supplied wins, blank inherits. A recruiter or the chat may reword the title for
 * this intake without editing the position; everything left blank is the
 * position's copy. The company is the one field the write door checks rather than
 * inherits blindly: a position filed under one company cannot seed another
 * company's opening, so `createJobOpening` refuses that pair before calling here.
 *
 * Pure by design — no database, no `server-only`, no clock — so the fixture proof
 * can pin the precedence without a live stack. Both the form's action and the
 * assistant's `create_job` reach this rule, which is what keeps a chat-created
 * opening identical to one created on screen.
 */

/** The fields a position contributes to an opening. */
export interface PositionCopy {
  /** Null means the post is group-wide rather than filed under one company. */
  tenant_id: string | null;
  title: string;
  department: string;
  /** The position's description; the opening stores it as its own description. */
  responsibilities: string | null;
  requirements: string[] | null;
  min_salary_usd: number | null;
  max_salary_usd: number | null;
  salary_currency: string;
}

/** A position row as the create path reads it. */
export interface PositionTemplate extends PositionCopy {
  id: string;
  is_active: boolean;
}

/**
 * The row columns a create reads, kept beside the type they fill.
 *
 * `POSITION_TEMPLATE_COLUMNS` is a REST select string, so a column renamed in the
 * type and not here would hand back `undefined` for every inherited field — the
 * proof checks the two name the same set.
 */
export const POSITION_TEMPLATE_COLUMNS =
  "id, tenant_id, title, department, responsibilities, requirements, min_salary_usd, max_salary_usd, salary_currency, is_active";

/** The draft fields a position can fill. A job draft carries more; this is the part read. */
export interface InheritableDraft {
  title: string;
  tenant_id: string;
  department: string;
  description: string;
  requirements: string[];
  min_salary_usd: string;
  max_salary_usd: string;
  salary_currency: string;
}

/** Whether a draft supplies its own value for a field the position would fill. */
export function supplied(value: string | null | undefined): boolean {
  return String(value ?? "").trim().length > 0;
}

/**
 * The draft as the position fills it.
 *
 * Every inheritable field a caller left blank comes from the position; a supplied
 * value is kept as sent. Salary figures become the same text the form edits, so
 * the two doors validate one shape. The rest of the draft — location, employment
 * type, status, the position link itself — is untouched, because a position does
 * not define how this particular intake is run.
 */
export function inheritedFrom<T extends InheritableDraft>(draft: T, position: PositionCopy): T {
  const figure = (value: number | null) => (value === null ? "" : String(value));
  return {
    ...draft,
    title: supplied(draft.title) ? draft.title : position.title,
    tenant_id: supplied(draft.tenant_id) ? draft.tenant_id : position.tenant_id ?? "",
    department: supplied(draft.department) ? draft.department : position.department,
    description: supplied(draft.description)
      ? draft.description
      : position.responsibilities ?? "",
    requirements: draft.requirements?.length ? draft.requirements : position.requirements ?? [],
    min_salary_usd: supplied(draft.min_salary_usd)
      ? draft.min_salary_usd
      : figure(position.min_salary_usd),
    max_salary_usd: supplied(draft.max_salary_usd)
      ? draft.max_salary_usd
      : figure(position.max_salary_usd),
    salary_currency: supplied(draft.salary_currency)
      ? draft.salary_currency
      : position.salary_currency,
  };
}
