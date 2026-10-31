import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { AssistantStage } from "./AssistantStage";

/** Auth-gated: whether this page renders at all is session-dependent. */
export const instant = false;

/** The saved conversation to open, the same way the assistant page names one. */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata = {
  title: "JARVIS · Stage",
  description: "Talk to the assistant with the whole screen, and read the answer beside it",
};

export default async function AssistantStagePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  // The call is the guard. The stage shows nothing per-person beyond the conversation,
  // which `AssistantChat` reads for itself, so there is no `staff` to pass down.
  await requireStaff("/assistant");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;

  return <AssistantStage initialSessionId={session} />;
}
