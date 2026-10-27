"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VoiceAutonomyState } from "@/modules/assistant/domain/voice";
import { AssistantChat } from "../AssistantChat";
import { AutonomyPanel } from "./AutonomyPanel";

/**
 * `/assistant/voice`: the same conversation, at full size, with a microphone.
 *
 * There is no separate transcript here. The chat below is the one the Assistant
 * page renders, so a spoken turn is saved exactly like a typed one and a
 * conversation started by voice opens in both places.
 */
export function VoiceConsole({
  initialSessionId,
  state,
}: {
  initialSessionId: string | null;
  state: VoiceAutonomyState;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(initialSessionId);
  // The server reports the conversation on every answer, and the same id must
  // not rewrite the address each time: a replace per turn would push the router
  // on every question. Tracked in a ref so the check is the id that is live.
  const reportedSession = useRef(initialSessionId);

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-brand-line bg-brand-cream/70 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          What happens to your voice
        </p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-brand-ink/65">
          Push-to-talk records a clip and sends it to Google&apos;s speech model for transcription;
          the audio is discarded the moment the words come back and is never stored, logged or
          attached to a conversation. Only the text you send is saved, exactly as if you typed it.
          Hands-free uses this browser&apos;s own speech recognition, which sends what it hears to
          the browser vendor&apos;s service — it runs only on this page, only while the toggle is
          on, and only while this tab is visible.
        </p>
      </section>

      <section className="flex h-[calc(100vh-16rem)] min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-brand-line bg-white">
        <AssistantChat
          variant="page"
          voiceMode="console"
          sessionId={sessionId}
          onSessionChange={(id) => {
            if (reportedSession.current === id) return;
            reportedSession.current = id;
            setSessionId(id);
            router.replace(`/assistant/voice?session=${encodeURIComponent(id)}`, { scroll: false });
          }}
          onNewConversation={() => {
            if (reportedSession.current === null) return;
            reportedSession.current = null;
            setSessionId(null);
            router.replace("/assistant/voice", { scroll: false });
          }}
        />
      </section>

      <AutonomyPanel initial={state} />
    </div>
  );
}
