import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { formEditorData } from "@/modules/form-builder/application/formActions";
import { previewFormLayout } from "@/modules/form-builder/application/formPreview";
import { FormEditor } from "../FormEditor";

export const metadata = {
  title: "Application form",
  description: "One form's questions, its details and the openings that ask it",
};

/** Auth-gated, and the layout belongs to the id in the address. */
export const instant = false;

/**
 * One form's own page (`/forms/[id]`, spec §6).
 *
 * The address is the form, so a pasted link opens the same layout and the live
 * channel's reload cannot quietly hand back another one. The page answers the two
 * questions the editor component must not have to guess: the tables that are not
 * on this database, and the id that names no form. The applicant's own walk is
 * read here too, so the preview is on first paint instead of one client waterfall
 * behind it. Everything else — the canvas, the inspector, the assignments — is the
 * client's, because a drag must not cost a round trip.
 */
export default async function ApplicationFormPage({ params }: PageProps<"/forms/[id]">) {
  await connection();
  const { id } = await params;
  await requireStaff(`/forms/${id}`);

  const [data, preview] = await Promise.all([
    formEditorData(id),
    previewFormLayout(id),
  ]);

  if (!data.available) {
    return (
      <PageTransition>
        <PageHeader eyebrow="Application form" title="The form tables are not here" />
        <div className="rounded-2xl border border-brand-line bg-brand-cream/60 p-5">
          <p className="text-sm font-semibold">
            {data.note ?? "This form could not be read."}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-brand-ink/60">
            Nothing was written. The board at{" "}
            <Link href="/forms" className="font-semibold text-brand-gold-dark underline">
              Application forms
            </Link>{" "}
            carries the same note.
          </p>
        </div>
      </PageTransition>
    );
  }

  // A uuid that names no form is a 404, not an empty editor: the alternative is a
  // screen that offers to save a layout into a row that does not exist.
  if (!data.form) notFound();

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Application form"
        title={data.form.name}
        description={
          data.form.isGlobal
            ? "A global form joins every application before the forms assigned to the opening. Its questions are written here; it is created, published and retired on the board."
            : "Write what this form asks, check it against the openings that would ask it, and publish. It is created, retired and read as a list on the board."
        }
      />

      <FormEditor
        data={{
          canWrite: data.canWrite,
          form: data.form,
          fields: data.fields,
          jobs: data.jobs,
          usage: data.usage,
          usageNote: data.usageNote,
        }}
        preview={preview}
      />
    </PageTransition>
  );
}
