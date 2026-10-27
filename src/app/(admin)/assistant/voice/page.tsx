import { Mic } from "lucide-react";
import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { readVoiceAutonomy } from "@/modules/assistant/application/voiceSettings";
import { VoiceConsole } from "./VoiceConsole";

export const metadata = {
  title: "Voice · Assistant",
  description: "Dictate a question, listen to the answer, and decide what a spoken word may release",
};

/** Auth-gated route: the autonomy level and the saved conversation are per person. */
export const instant = false;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function AssistantVoicePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const staff = await requireStaff("/assistant/voice");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;
  const state = await readVoiceAutonomy(staff.profileId);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Operations assistant"
        title="Voice"
        description="Speak a question, hear the answer, and keep your hands free — the same conversation, saved to your account."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Mic className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Listening only while armed
          </span>
        }
      />
      <VoiceConsole initialSessionId={session} state={state} />
    </PageTransition>
  );
}
