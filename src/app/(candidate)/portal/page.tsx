import type { Metadata } from "next";
import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { PortalTracker } from "./PortalTracker";

export const metadata: Metadata = {
  title: "Track your application",
  description: "Check your application status, assessment and next steps",
};

/** Shown when Settings has no support address, so the help box is never empty. */
const DEFAULT_SUPPORT_EMAIL = "careers@sharmdreamsgroup.com";

export default async function CandidatePortalPage() {
  // The support address is a runtime setting, so this page renders per request.
  // The `?code=…` pre-fill is still read on the client rather than from
  // `searchParams`, which keeps the lookup logic next to the form that owns it.
  const supportEmail = await getStringSetting("organisation.support_email", DEFAULT_SUPPORT_EMAIL);

  return <PortalTracker supportEmail={supportEmail} />;
}
