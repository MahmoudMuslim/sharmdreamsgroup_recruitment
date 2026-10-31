import Link from "next/link";
import { Ear, Mic, Sparkles } from "lucide-react";
import { AssistantConsole } from "./AssistantConsole";
import { requireStaff } from "@/lib/auth/session";
import { PageTransition } from "@/modules/shell/presentation/PageTransition";
import { PageHeader } from "@/modules/analytics/presentation/ui";
import { readVoiceAutonomy } from "@/modules/assistant/application/voiceSettings";
import { AutonomyPanel } from "@/modules/assistant/presentation/voice/AutonomyPanel";
import { settingsHref } from "@/modules/settings/domain/settingsNav";
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
  const staff = await requireStaff("/assistant");

  const params = await searchParams;
  const session = typeof params.session === "string" ? params.session : null;
  const query = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const state = await readVoiceAutonomy(staff.profileId);

  return (
    <PageTransition>
      <PageHeader
        eyebrow="Operations assistant"
        title="Assistant"
        description="Read and change anything your role allows across the portal, then come back to the conversation later — every one of yours is saved here."
        actions={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link
              href={settingsHref("assistant", "presence")}
              className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <Ear className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              JARVIS settings
            </Link>
            <Link
              href={settingsHref("assistant", "commands")}
              className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <Mic className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              Voice commands
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60">
              <Sparkles className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
              Saved to your account
            </span>
          </span>
        }
      />

      <AssistantConsole initialSessionId={session} initialQuery={query} />

      <details className="mt-4 rounded-2xl border border-brand-line bg-brand-cream/70 p-4">
        <summary className="cursor-pointer text-xs font-bold text-brand-gold-dark">
          Voice settings &amp; audio privacy
        </summary>
        <section className="mb-4 mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            What happens to your voice
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-brand-ink/65">
            Push-to-talk records a clip and sends it to this portal&apos;s own model for
            transcription; the audio is discarded the moment the words come back and is never stored,
            logged or attached to a conversation. Only the text you send is saved, exactly as if you
            typed it. Hands-free watches the microphone&apos;s loudness in this browser, sends only a
            spoken segment to this portal&apos;s own model when a sound begins, and runs only on this
            page, only while the toggle is on, and only while this tab is visible.
          </p>
        </section>
        <AutonomyPanel initial={state} />
      </details>
    </PageTransition>
  );
}
