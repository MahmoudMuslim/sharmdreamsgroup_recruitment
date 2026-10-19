import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicJob } from "../../actions";
import { getCandidateLocales } from "@/modules/settings/application/candidateLocales";
import { translate } from "@/lib/i18n";
import { ApplyWizard } from "./ApplyWizard";

/**
 * The application itself, on its own page.
 *
 * A candidate reads the role first and applies second, and the two are now two
 * screens: the role page carries one Apply button, and this one carries the
 * steps. Keeping the form off the ad also keeps the ad's own payload off the
 * form's — the wizard is the only thing that ships here.
 *
 * A draft or closed role 404s rather than showing an empty form, exactly as the
 * role page does, so nothing reveals that an unpublished opening exists.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [job, { defaultLocale }] = await Promise.all([getPublicJob(id), getCandidateLocales()]);
  if (!job) return { title: "Role not found" };
  return {
    title: translate(defaultLocale, "apply.title", { role: job.title }),
    description: translate(defaultLocale, "apply.ctaNote"),
  };
}

/**
 * Which role is being applied to comes from the URL, and a role published after
 * the build is only known on request — so this page renders per request, like
 * the role page it is reached from.
 */
export const instant = false;

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getPublicJob(id);

  if (!job) notFound();

  return <ApplyWizard job={{ id: job.id, title: job.title }} />;
}
