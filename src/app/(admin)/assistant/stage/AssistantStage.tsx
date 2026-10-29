"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AssistantChat } from "../AssistantChat";
import { STAGE_ROUTE } from "@/modules/assistant/domain/stage";

/**
 * The stage: one conversation, full viewport, and a column that stays out of the
 * orb's way. The chrome is gone because a screen built for talking is not a screen
 * built for scanning — and because a second dock would be a second conversation
 * fighting this one for the utterance the orb hands over.
 */
export function AssistantStage({ initialSessionId }: { initialSessionId: string | null }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const reported = useRef<string | null>(initialSessionId);

  // Escape is ours here, not the browser's: the Fullscreen API is not in use, so there
  // is no native exit to fight. The visible button below exists because this is not.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      router.push("/assistant");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    // `pt-[144px]` is STAGE_ORB_GUTTER_PX and group 4 refuses to let it drift; below lg
    // the orb is top-centre so the transcript starts under that band. At lg and above
    // the orb is top-right, so the band collapses and the same figure moves to the
    // right — the answer column then ends where the orb's reserved space begins.
    <div className="fixed inset-0 z-30 flex min-h-0 flex-col bg-brand-ivory pt-[144px] lg:pt-6 lg:pr-[144px]">
      <Link
        href="/assistant"
        className="absolute left-4 top-2 z-10 inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Exit stage
      </Link>

      <AssistantChat
        sessionId={sessionId}
        onSessionChange={(id) => {
          if (reported.current === id) return;
          reported.current = id;
          setSessionId(id);
          router.replace(`${STAGE_ROUTE}?session=${encodeURIComponent(id)}`, { scroll: false });
        }}
        onNewConversation={() => {
          reported.current = null;
          setSessionId(null);
          router.replace(STAGE_ROUTE, { scroll: false });
        }}
        variant="stage"
        voiceMode="console"
      />
    </div>
  );
}
