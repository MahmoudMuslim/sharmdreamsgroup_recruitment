"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { whenLabel } from "@/modules/assistant/presentation/whenLabel";
import {
  getAssistantSessions,
  type AssistantSessionSummary
} from "./actions";
import { FailureNote } from "./AssistantSteps";

/**
 * The saved conversations, inside the docked panel.
 *
 * The Assistant page has a rail beside the chat; the panel floats over whatever
 * screen the recruiter is on and had no way back into a past conversation
 * except by walking to that page. This is that way: every one of yours, newest
 * first, with the counts and the engine that answered it.
 *
 * Renaming and deleting stay on the page, which has room for those buttons —
 * the list says so rather than looking like a panel that forgot to offer them.
 */
export function SessionList({
  current,
  onSelect,
  onClose,
}: {
  current: string | null;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<AssistantSessionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await getAssistantSessions();
        if (active) setSessions(rows);
      } catch {
        if (active) {
          setSessions([]);
          setListError("Your saved conversations could not be loaded.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">Your conversations</h3>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            Pick one to carry it on here, in the panel floating over the screen you are on. Only
            you see these.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {listError && (
        <div className="mt-3">
          <FailureNote
            message={listError}
            hint="Nothing was lost — the list simply did not arrive. Close this and open it again."
          />
        </div>
      )}
      {!listError && sessions === null && (
        <p className="mt-4 flex items-center gap-2 text-xs text-brand-ink/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      )}
      {sessions && sessions.length === 0 && !listError && (
        <p className="mt-4 text-xs leading-relaxed text-brand-ink/55">
          Nothing saved yet. Ask the assistant something and the conversation appears in this list
          as soon as it has an answer.
        </p>
      )}

      <ul className="mt-4 space-y-1.5">
        {(sessions ?? []).map((session) => {
          const isActive = session.id === current;
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-left transition",
                  isActive
                    ? "border-brand-gold bg-brand-gold/10"
                    : "border-brand-line bg-white hover:bg-brand-cream"
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-bold text-brand-ink">
                  <span className="min-w-0 truncate">{session.title}</span>
                  {isActive && (
                    <Check
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-gold-dark"
                      aria-hidden
                    />
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-brand-ink/50">
                  {session.messageCount} message{session.messageCount === 1 ? "" : "s"} ·{" "}
                  {whenLabel(session.updatedAt)}
                  {session.engine ? ` · ${session.engine}` : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {sessions && sessions.length > 0 && (
        <p className="mt-3 text-[10px] leading-relaxed text-brand-ink/45">
          Renaming or deleting a conversation happens on the{" "}
          <button
            type="button"
            onClick={() =>
              router.push(
                current ? `/assistant?session=${encodeURIComponent(current)}` : "/assistant"
              )
            }
            className="font-bold text-brand-gold-dark underline underline-offset-2"
          >
            Assistant page
          </button>
          , which has room for those two buttons.
        </p>
      )}
    </div>
  );
}
