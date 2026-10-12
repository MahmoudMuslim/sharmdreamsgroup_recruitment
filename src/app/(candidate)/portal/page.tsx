import type { Metadata } from "next";
import { PortalTracker } from "./PortalTracker";

export const metadata: Metadata = {
  title: "Track your application",
  description: "Check your application status, assessment and next steps",
};

export default function CandidatePortalPage() {
  return <PortalTracker />;
}