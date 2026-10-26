import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicJob } from "../../actions";
import { readReferralCode } from "@/modules/referrals/domain/referral";
import { getCandidateLocales } from "@/modules/settings/application/candidateLocales";
import { readPrivacySettings } from "@/modules/privacy/infrastructure/privacyReader";
import { translate } from "@/lib/i18n";
import { project, resolveFormForJob } from "@/modules/form-builder/application/publicForm";
import { ApplyWizard } from "./ApplyWizard";
import { DynamicApplyWizard } from "./DynamicApplyWizard";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const job = await getPublicJob(id);

  if (!job) notFound();

  // The code is carried, not judged, here: a malformed or unknown code simply
  // leaves the applicant with the normal source picker, and the submit action
  // resolves the code again before it labels anything REFERRAL.
  const referralCode = readReferralCode(query.ref);

  // The pool consent names its own window, so the review step prints the figure
  // the sweep will act on rather than a number typed into the copy. Reading it
  // here also means a Settings change reaches the next applicant without a build.
  const { talentPoolMonths } = await readPrivacySettings();

  // Spec §9's one rule: a published layout renders itself, and every failure
  // state degrades to the wizard below rather than to a broken form. The
  // submit door re-reads the same layout and refuses where this page degraded.
  const resolved = await resolveFormForJob(job.id);
  if ("fallback" in resolved) {
    return (
      <ApplyWizard
        job={{ id: job.id, title: job.title }}
        referralCode={referralCode}
        talentPoolMonths={talentPoolMonths}
      />
    );
  }

  return (
    <DynamicApplyWizard
      form={project(resolved)}
      job={{ id: job.id, title: job.title }}
      referralCode={referralCode}
      talentPoolMonths={talentPoolMonths}
    />
  );
}
