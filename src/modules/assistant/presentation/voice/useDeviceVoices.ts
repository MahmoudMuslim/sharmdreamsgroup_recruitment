"use client";

import { useEffect, useState } from "react";

/**
 * The voices this machine has installed, as the browser names them.
 *
 * The list is the platform's, not the portal's: `getVoices()` answers empty on the
 * first call while it loads, and a machine can gain or lose a voice while a tab is
 * open, so `voiceschanged` is what keeps the panel honest. A console that offered a
 * voice nobody has would be offering a click that does nothing.
 *
 * This hook reads. It never speaks and never calls `cancel()` — `speechSynthesis`
 * is one global voice per tab, so a listener that silenced it on unmount would cut
 * off whatever the orb or the chat was saying.
 */
export function useDeviceVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
    };
  }, []);

  return voices;
}
