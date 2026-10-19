import { Sparkles } from "lucide-react";
import { AssistantConsole } from "./AssistantConsole";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { connection } from "next/server";

export const metadata = {
  title: "Assistant · Operations",
  description: "Ask anything about the portal, and return to conversations you have saved",
};

/** Auth-gated route: whose conversations are listed is entirely session-dependent. */
export const instant = false;

/** Conversations are opened by link, the same way the assistant links into records. */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  await requireStaff("/assistant");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Operations assistant"
        title="Assistant"
        description="Read and change anything your role allows across the portal, then come back to the conversation later — every one of yours is saved here."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
            <Sparkles className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
            Saved to your account
          </span>
        }
      />

      <AssistantConsole initialSessionId={session} />
    </PageTransition>
  );
}
