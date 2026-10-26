import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { listForms } from "@/modules/form-builder/application/formActions";
import { FormsConsole } from "./FormsConsole";

export const metadata = {
  title: "Application Forms · Sharm Dreams Talent Cloud",
  description: "Build what an application asks, and choose which openings ask it",
};

/** Auth-gated route, and the forms belong to whoever is signed in. */
export const instant = false;

export default async function ApplicationFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string | string[] }>;
}) {
  await connection();
  await requireStaff("/forms");

  // The open form rides in the URL, so a refresh — or the live channel reloading
  // the page — returns the form the editor is showing instead of the first row.
  const params = await searchParams;
  const wanted = typeof params.form === "string" ? params.form : null;
  const data = await listForms(wanted);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Hiring"
        title="Application form builder"
        description="Write what an application asks — headings, questions, the profile fields an answer writes to — then assign the form to a role or keep it global. Saving a draft and publishing it are two different promises: a draft may be incomplete, a published form has been checked against every opening that would ask it."
      />

      <FormsConsole data={data} />
    </PageTransition>
  );
}
