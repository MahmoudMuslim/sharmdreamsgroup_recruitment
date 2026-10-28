import { Ear } from "lucide-react";
import { connection } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { readJarvisPrefs } from "@/modules/assistant/application/jarvisSettings";
import { PresenceConsole } from "./PresenceConsole";

export const metadata = {
  title: "JARVIS · Assistant",
  description: "Decide when the assistant may listen in the background, speak first, and stay quiet",
};

/** Auth-gated route: every switch is one person's own row. */
export const instant = false;

export default async function AssistantJarvisPage() {
  await connection();
  const staff = await requireStaff("/assistant/jarvis");
  const state = await readJarvisPrefs(staff.profileId);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Operations assistant"
        title="JARVIS"
        description="The presence on every admin screen: what it may hear, when it may speak first, and the hours it must stay quiet — stored on your account, never in this browser."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Ear className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Off until you arm it
          </span>
        }
      />
      <PresenceConsole initial={state} />
    </PageTransition>
  );
}
