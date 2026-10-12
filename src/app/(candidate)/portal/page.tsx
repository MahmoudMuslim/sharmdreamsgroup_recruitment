import type { Metadata } from "next";
import { PortalTracker } from "./PortalTracker";

export const metadata: Metadata = {
  title: "Track your application",
  description: "Check your application status, assessment and next steps",
};

export default function CandidatePortalPage() {
  // The `?code=…` pre-fill is read on the client, not from `searchParams`.
  // Reading it here would mark the whole portal request-time, costing every
  // visitor a server render to save one field's typing.
  return <PortalTracker />;
}