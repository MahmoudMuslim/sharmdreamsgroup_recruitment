"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  jarvisUiOnServer,
  readJarvisUi,
  setJarvisApproval,
  setJarvisAwaiting,
  setJarvisSpeaking,
  setJarvisThinking,
  subscribeJarvisUi,
  takePendingUtterance,
} from "@/lib/jarvis-ui";

/**
 * The one conversation the presence orb is having, seen from the chat's side.
 *
 * Two facts travel across this boundary, in opposite directions.
 *
 * **In:** while ambient listening is armed the orb's recogniser owns the microphone and
 * hands what it hears to the store; this takes it exactly once and gives it to the
 * chat's own utterance handler, where the wake phrase, the approval verdicts and the
 * refusals are already decided and proved. Nothing new is interpreted here.
 *
 * **Out:** the orb cannot see a conversation — it is mounted several components above,
 * and the dock may not even be open. So the three things a person can only judge by
 * looking at the reactor (a turn in flight, an answer being read aloud, a card waiting
 * for a click) are mirrored into the store from the state that owns them, and nowhere
 * else. The fourth, waiting for a follow-up, is written by `useJarvisAwaitingWriter`
 * at the moment the chat decides it.
 *
 * ## Why the mirror is cleared on unmount
 *
 * Closing the dock unmounts the conversation with a turn possibly still in it. A store
 * left reading `thinking: true` would keep the reactor spinning amber over a question
 * nobody is asking any more — which is the one failure this file exists to prevent.
 */
export function useJarvisHandoff({
  onUtterance,
  thinking,
  speaking,
  approvalSummary,
}: {
  /** The chat's own utterance handler, called with words spoken to the orb. */
  onUtterance: (text: string) => void;
  thinking: boolean;
  speaking: boolean;
  approvalSummary: string | null;
}): {
  /** True while the orb's recogniser holds the microphone, so the chat's must not. */
  ambientArmed: boolean;
} {
  const ui = useSyncExternalStore(subscribeJarvisUi, readJarvisUi, jarvisUiOnServer);

  // Kept current after commit rather than during render: the handler is read from a
  // store notification, which can land before the render that owns the newest
  // transcript, messages and draft.
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  });

  // Keyed on the token, not the utterance: taking a turn clears the slot, and an
  // effect watching the object would re-run on the render that cleared it.
  const token = ui.pendingUtterance?.token ?? 0;
  useEffect(() => {
    const handed = takePendingUtterance();
    if (handed) onUtteranceRef.current(handed.text);
  }, [token]);

  useEffect(() => {
    setJarvisThinking(thinking);
  }, [thinking]);

  useEffect(() => {
    setJarvisSpeaking(speaking);
  }, [speaking]);

  useEffect(() => {
    setJarvisApproval(approvalSummary);
  }, [approvalSummary]);

  useEffect(
    () => () => {
      setJarvisThinking(false);
      setJarvisSpeaking(false);
      setJarvisAwaiting(false);
      setJarvisApproval(null);
    },
    []
  );

  return { ambientArmed: ui.ambientArmed };
}

/**
 * Write the chat's waiting-for-a-follow-up decision to both places it is read.
 *
 * The ref stays authoritative because the recogniser's handler runs in a synchronous
 * pass: a batch carrying "Hey Jarvis" and then the question would arm a state the
 * second final could not see. This is the only writer of the mirrored copy, and the
 * only reason the chat should ever touch `awaitingRef`.
 */
export function useJarvisAwaitingWriter(awaitingRef: { current: boolean }) {
  return useCallback(
    (awaiting: boolean) => {
      awaitingRef.current = awaiting;
      setJarvisAwaiting(awaiting);
    },
    [awaitingRef]
  );
}
