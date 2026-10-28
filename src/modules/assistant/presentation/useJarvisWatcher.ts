"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStaffAlerts } from "@/modules/shell/application/shell-actions";
import { toZoneInputValue } from "@/lib/timezone";
import {
  briefingDue,
  briefingSentences,
  crossedQueues,
  newsQueues,
  withinQuietHours,
  type JarvisPrefs,
  type QueueCrossing,
  type QueueReading,
} from "@/modules/assistant/domain/jarvis";

/**
 * Two minutes, not seconds.
 *
 * The feed is five live counts over the busiest tables the portal has, and every
 * signed-in browser would run them. A person who armed the watcher asked to hear
 * about a pile-up, not to race it; the badge is the same number either way.
 */
const WATCH_POLL_MS = 120_000;

/**
 * The clock the presence acts on, as the group's wall clock.
 *
 * `organisation.timezone` decides whose morning a briefing belongs to: a recruiter
 * in the Cairo office at 07:50 is not addressed at 05:50 UTC because the browser
 * happened to be set elsewhere. A zone the code cannot read yields null, and a
 * null clock means the presence says nothing rather than guessing.
 */
function wallClock(timeZone: string): { day: string; minutes: number } | null {
  const value = toZoneInputValue(new Date().toISOString(), timeZone);
  if (value.length !== 16) return null;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { day: value.slice(0, 10), minutes: hour * 60 + minute };
}

const readingsOf = (counts: Record<string, number>): QueueReading[] =>
  Object.entries(counts).map(([id, count]) => ({ id, count }));

/**
 * Whether this browser already heard the briefing on this wall-clock day.
 *
 * Keyed by the person, not the tab: one recruiter with two windows open should be
 * briefed once. The value is a date, never a transcript, and it is written only
 * when a briefing was actually given.
 */
function briefingKey(profileId: string): string {
  return `jarvis:briefing:${profileId}`;
}

function readLastBriefing(profileId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(briefingKey(profileId));
    return stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeLastBriefing(profileId: string, day: string): void {
  try {
    window.localStorage.setItem(briefingKey(profileId), day);
  } catch {
    // A blocked store means this browser is briefed again on the next poll. The
    // day's speech is otherwise unchanged, so this is not worth a message.
  }
}

export interface JarvisWatcher {
  /** Queues above their threshold right now — the badge, quiet hours or not. */
  news: QueueCrossing[];
  /** The crossings spoken about since the presence was armed, newest first. */
  recent: QueueCrossing[];
  /** The lines of the briefing last given, so the card can show what was said. */
  briefing: string[];
  error: string | null;
}

/**
 * The watcher: the attention feed, read on a clock, spoken about once.
 *
 * Three rules decide what reaches the voice, and all three are the domain's, not
 * this file's: a queue is only news when it *crossed* its threshold since the last
 * read (`crossedQueues`), only the queues this person named are spoken about at
 * all, and nothing is said inside quiet hours. What this file adds is the
 * discipline around them.
 *
 * The baseline advances whether or not anything was spoken. A watcher that kept the
 * old numbers through an eighteen-hour quiet window would spend its first sentence
 * after 08:00 on a pile-up from the previous evening — the window suppresses
 * speech, it does not accumulate a debt of it. What grew overnight is still heard,
 * as part of the morning briefing, which reads what is news *now*.
 *
 * One sentence per poll. Two queues crossing together is one interruption, the most
 * urgent of them; the rest are on the card, and all of them are in the badge.
 *
 * A failed read is not a reset. The counts from the last working poll stay the
 * baseline, so one refused query cannot make the next one report every queue as
 * newly crossed.
 *
 * The preferences are read through a ref, so the interval survives a settings
 * change instead of being torn down and re-armed around it — but each poll still
 * speaks about the queues named at that moment.
 */
export function useJarvisWatcher({
  enabled,
  prefs,
  timeZone,
  profileId,
  say,
  tone,
}: {
  /** Off until the presence has somewhere to speak and something to say. */
  enabled: boolean;
  prefs: JarvisPrefs;
  timeZone: string;
  profileId: string;
  say: (text: string) => Promise<void> | void;
  tone: (kind: "heard" | "alert") => void;
}): JarvisWatcher {
  const [news, setNews] = useState<QueueCrossing[]>([]);
  const [recent, setRecent] = useState<QueueCrossing[]>([]);
  const [briefing, setBriefing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The last counts the presence acted on. A ref, not state: a poll compares
  // against what the *previous* poll produced, and a state value written by that
  // poll has not committed by the time this one runs.
  const baseline = useRef<Record<string, number> | null>(null);
  const speaking = useRef(false);
  const given = useRef<{ prefs: JarvisPrefs; say: typeof say; tone: typeof tone }>({
    prefs,
    say,
    tone,
  });
  useEffect(() => {
    given.current = { prefs, say, tone };
  });

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const { prefs: live, say: speak, tone: chime } = given.current;
    const clock = wallClock(timeZone);
    if (!clock) {
      setError("The office clock could not be read, so nothing is announced.");
      return;
    }
    const quiet = withinQuietHours(clock.minutes, live.quietFrom, live.quietTo);

    const result = await getStaffAlerts();
    if (!result.ok) {
      // The baseline stays exactly as it was: the feed went away, the queues did
      // not change. The badge keeps the last true numbers rather than going blank.
      setError(result.error ?? "The attention feed is unavailable.");
      return;
    }
    setError(null);

    const counts: Record<string, number> = {};
    for (const alert of result.alerts) counts[alert.id] = alert.count;
    const readings = readingsOf(counts);
    const allowed = new Set(live.watchQueues);

    setNews(newsQueues(readings).filter((crossing) => allowed.has(crossing.id)));

    if (live.watching && !quiet) {
      const crossed = crossedQueues(baseline.current, readings).filter((crossing) =>
        allowed.has(crossing.id)
      );
      if (crossed.length) {
        setRecent((previous) => [...crossed, ...previous].slice(0, 5));
        const [line] = briefingSentences(crossed);
        if (line && !speaking.current) {
          speaking.current = true;
          chime("alert");
          await speak(line);
          speaking.current = false;
        }
      }
    }

    baseline.current = counts;

    if (live.briefing && !quiet) {
      if (
        briefingDue({
          lastGivenOn: readLastBriefing(profileId),
          today: clock.day,
          nowMinutes: clock.minutes,
          hour: live.briefingHour,
          quiet,
        })
      ) {
        const lines = briefingSentences(
          newsQueues(readings).filter((crossing) => allowed.has(crossing.id))
        );
        // The day is marked before anything is spoken: a briefing whose voice fails
        // is not retried every two minutes for the rest of the morning.
        writeLastBriefing(profileId, clock.day);
        setBriefing(lines);
        if (lines.length && !speaking.current) {
          speaking.current = true;
          chime("alert");
          await speak(`Good morning. ${lines.join(". ")}.`);
          speaking.current = false;
        }
      }
    }
  }, [timeZone, profileId]);

  useEffect(() => {
    if (!enabled) return;
    // Arming starts from what is standing now, not from counts read while the
    // presence was off: whoever turns it on is not interrupted by what had already
    // piled up.
    baseline.current = null;
    // The first read waits a tick: a poll answers by setting state, and an effect
    // body may not set state before its first paint.
    const opening = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), WATCH_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(opening);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, poll]);

  return { news, recent, briefing, error };
}
