import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { listForms } from "@/modules/form-builder/application/formActions";
import { FormsBoard } from "./FormsBoard";

export const metadata = {
  title: "Application Forms",
  description: "Every application form the estate holds, in the state it is in",
};

/** Auth-gated route, and the forms belong to whoever is signed in. */
export const instant = false;

/**
 * The board half of the form builder.
 *
 * One page per form lives under `/forms/[id]`; this page lists them all and owns
 * the writes that name a form rather than fill it: create, draft by AI, publish
 * and retire. It deliberately does not read a single field — the board's read
 * carries counts, so two hundred forms do not ship two hundred sets of labels.
 */
export default async function ApplicationFormsPage() {
  await connection();
  await requireStaff("/forms");

  const data = await listForms();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Hiring"
        title="Application forms"
        description="Every form an application can ask, in the state it is in. Create one here, then open its card to write the questions — a draft may be incomplete, and a published form has been checked against every opening that would ask it."
      />

      {!data.available ? (
        <div className="rounded-2xl border border-brand-line bg-brand-cream/60 p-5">
          <p className="text-sm font-semibold">
            {data.note ?? "The form tables could not be read."}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">
            Apply the migration the note names, then reload this page. No other part of the
            portal is affected: an opening without a published form asks what it asked before
            the builder existed.
          </p>
        </div>
      ) : (
        <FormsBoard data={data} />
      )}
    </PageTransition>
  );
}
