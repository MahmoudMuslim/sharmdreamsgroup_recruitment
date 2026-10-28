"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Bell, Clock, Ear, Loader2, Mic, Moon, Play, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JARVIS_QUEUES,
  readClock,
  summarizeJarvisChange,
  type JarvisPrefs,
} from "@/modules/assistant/domain/jarvis";
import {
  DEFAULT_SPEECH_RATE,
  SPEECH_RATE_MAX,
  SPEECH_RATE_MIN,
  pickDeviceVoice,
} from "@/modules/assistant/domain/voice";
import { useDeviceVoices } from "@/modules/assistant/presentation/voice/useDeviceVoices";
import { refreshJarvisPresence } from "@/lib/jarvis-ui";
import { useRecognizerSupported } from "@/modules/assistant/presentation/voice/useWakeWord";
import {
  readStoredSpeechRate,
  readStoredVoiceId,
  subscribeVoicePrefs,
  writeStoredSpeechRate,
  writeStoredVoiceId,
} from "@/app/(admin)/assistant/AssistantPrefs";
import { setJarvisPresence } from "./jarvis-actions";

/**
 * The Presence half of Settings → Assistant
 * (`/settings?area=assistant&section=presence`): every switch the presence obeys,
 * in one place.
 *
 * The orb, the wake word and the briefing run in the browser, but none of them
 * decides its own reach — each reads this person's row on the server. This panel
 * is the only writer, and it writes one change at a time through the same server
 * action the rest of the console uses, so every flip lands in the activity trail
 * with an actor and a before-and-after.
 *
 * Three states the panel must never blur:
 *
 * - **047 absent** — the table does not exist, so nothing can be stored. Every
 *   control is disabled and the panel names the migration, rather than offering
 *   a switch whose click would vanish.
 * - **Unreadable** — the table exists but the read failed. Same disabled state,
 *   different sentence: this is an outage, not a missing file, and nothing is
 *   assumed about what the person chose.
 * - **No row yet** — the table works and this person has never chosen. Every
 *   switch is off, every control is usable, and the panel says so.
 *
 * One pair of controls sits outside all three states: which voice reads a sentence
 * and how fast it reads it. Those are facts about the machine in front of the
 * person, not about their account, so they live in this browser and keep working
 * when the row cannot be written — a panel that disabled them would be offering no
 * choice at all, on a setting that never touched the database.
 */
export interface PresenceConsoleProps {
  initial: {
    prefs: JarvisPrefs;
    stored: boolean;
    problem: "absent" | "unreadable" | null;
  };
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const spokenLabel = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/**
 * What the preview says.
 *
 * Two rules the words have to obey: no wake phrase — the recogniser is running on
 * this very page whenever the wake word is armed, and a preview that contained it
 * would hand the microphone a turn the person never asked for — and no barge-in
 * word, or previewing the voice would stop the voice.
 */
const PREVIEW_SENTENCE = "Two offers are waiting for an answer today.";

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
        checked ? "border-brand-gold bg-brand-gold/80" : "border-brand-line bg-brand-sand",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

function SwitchRow({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-bold text-brand-ink">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-brand-line bg-white p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">{hint}</p>
      <div className="mt-3 divide-y divide-brand-line">{children}</div>
    </section>
  );
}

export function PresenceConsole({ initial }: PresenceConsoleProps) {
  // `prefs` is the last state the server confirmed; `form` is what the controls
  // show while a draft is being edited. A refused or thrown save resets `form`
  // to `prefs`, so a field can never display a value nobody stored.
  const [prefs, setPrefs] = useState(initial.prefs);
  const [form, setForm] = useState(initial.prefs);
  const [stored, setStored] = useState(initial.stored);
  // The read state cannot change while this panel is open: a save is closed
  // whenever it is not null, so only the server's next render can move it.
  const problem = initial.problem;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const supported = useRecognizerSupported();

  // Which voice reads, and how fast: the same browser-level pair the orb speaks its
  // briefing with and the Assistant page reads its answers with, so the two surfaces
  // cannot sound like two different people on one machine. Read through the store so
  // a change made here reaches both of them while they are open.
  const devices = useDeviceVoices();
  const voiceId = useSyncExternalStore(subscribeVoicePrefs, readStoredVoiceId, () => "");
  const speechRate = useSyncExternalStore(
    subscribeVoicePrefs,
    readStoredSpeechRate,
    () => DEFAULT_SPEECH_RATE
  );
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);

  /** A saved name this machine does not have is a fallback, and the panel says so. */
  const voiceMissing = voiceId !== "" && !devices.some((voice) => voice.voiceURI === voiceId);

  /**
   * Read the sample in the voice and at the pace just chosen.
   *
   * The panel owns no queue and issues no `cancel()`. `speechSynthesis` is one
   * global voice per tab: a preview that silenced it to get its turn would cut a
   * briefing mid-sentence, which is the defect this whole surface was built to stop.
   * So the sample rides behind whatever is already being read, as any second sentence
   * does.
   */
  function hearThisVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const voice = pickDeviceVoice(devices, voiceId, "en");
    if (!voice) {
      setPreviewProblem(
        devices.length === 0
          ? "This browser has not given up a voice list, so there is nothing to hear."
          : "This machine has no English voice, so there is nothing to hear."
      );
      return;
    }
    setPreviewProblem(null);
    const utterance = new SpeechSynthesisUtterance(PREVIEW_SENTENCE);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = speechRate;
    window.speechSynthesis.speak(utterance);
  }

  /** A switch that cannot be stored cannot be obeyed, so the panel closes all of them. */
  const writable = problem === null;
  const locked = busy || !writable;

  async function save(patch: Record<string, unknown>, consentGiven = false): Promise<boolean> {
    if (busy || !writable) return false;
    setBusy(true);
    setError(null);
    setSaved(null);
    setNotice(null);
    try {
      const result = await setJarvisPresence(patch, consentGiven);
      if (!result.ok) {
        setError(result.error ?? "That setting could not be saved.");
        setForm(prefs);
        return false;
      }
      setSaved(summarizeJarvisChange(prefs, result.prefs));
      setPrefs(result.prefs);
      setForm(result.prefs);
      setStored(true);
      // The orb read this row when the shell mounted and the shell survives every
      // in-app navigation; without this, a saved switch would need a full reload.
      refreshJarvisPresence();
      return true;
    } catch {
      setError("That setting could not be saved. Nothing has changed.");
      setForm(prefs);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggleAmbient(next: boolean) {
    if (!next) {
      void save({ ambient: false });
      return;
    }
    // The explanation is shown once, and the server stamps the moment. A later
    // arming reuses that stamp rather than pretending to forget it.
    if (form.ambientConsentAt) {
      void save({ ambient: true });
      return;
    }
    setSaved(null);
    setError(null);
    setNotice(null);
    setAcknowledged(false);
    setConsentOpen(true);
  }

  async function armWithConsent() {
    if (!acknowledged) {
      setNotice("Tick the box once you have read what the microphone does.");
      return;
    }
    if (await save({ ambient: true }, true)) {
      setConsentOpen(false);
      setAcknowledged(false);
    }
  }

  function toggleQueue(id: string, next: boolean) {
    const chosen = new Set(form.watchQueues);
    if (next) chosen.add(id);
    else chosen.delete(id);
    // Kept in the feed's rank order, which is the order a briefing speaks them.
    const watchQueues = JARVIS_QUEUES.filter((rule) => chosen.has(rule.id)).map((rule) => rule.id);
    setForm((current) => ({ ...current, watchQueues }));
    void save({ watchQueues });
  }

  function commitClock(field: "quietFrom" | "quietTo", value: string) {
    if (readClock(value) === null) {
      // A cleared or malformed field is not a request to reset the window; it is
      // a field that cannot express the choice, so the stored value comes back.
      setForm(prefs);
      setNotice("Quiet hours are written as HH:MM, for example 18:00.");
      return;
    }
    if (value === prefs[field]) return;
    void save({ [field]: value });
  }

  const ambientBlocked = !supported
    ? "This browser has no speech recogniser. Chrome and Edge do; Firefox does not. The Ctrl+Space hotkey and the typed conversation still work."
    : "Arms this browser's wake word on every admin screen. Off by default, and only ever for your own account.";

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-brand-line bg-brand-cream/70 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
          What the presence is
        </p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-brand-ink/65">
          A floating orb on every admin screen, a Ctrl+Space hotkey that opens the same saved
          conversation the Assistant page holds, and — once you arm it — a wake phrase that hands what
          it hears to that conversation. It opens no new door: every action still runs through the
          assistant&apos;s approval card and lands in the activity trail.
        </p>
      </section>

      {problem === "absent" && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-relaxed text-amber-800">
          db/migrations/047_assistant_jarvis_prefs.sql is authored but not applied, so no setting on
          your account can be stored or armed yet. Every switch is off until that table exists on
          this database, and no account control below will write. The voice and the pace are this
          browser&apos;s own choice and still save.
        </p>
      )}
      {problem === "unreadable" && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-relaxed text-amber-800">
          Your presence settings could not be read just now, so this panel shows nothing switched on
          and cannot save until the read succeeds. Nothing has been assumed about the choices you
          made.
        </p>
      )}
      {problem === null && !stored && (
        <p className="rounded-2xl border border-brand-line bg-brand-cream/70 px-4 py-3 text-[11px] leading-relaxed text-brand-ink/65">
          Nothing is saved yet. Every switch is off until you choose; turning the wake word on opens
          the explanation first.
        </p>
      )}

      <Section
        icon={<Mic className="h-3.5 w-3.5" aria-hidden />}
        title="The microphone"
        hint="One recogniser, one owner: while the wake word is armed, the Voice page's hands-free mode stands down and this one takes what it hears."
      >
        <SwitchRow
          checked={form.ambient}
          disabled={locked || !supported}
          label="Wake word on every admin screen"
          hint={ambientBlocked}
          onChange={toggleAmbient}
        />
        {consentOpen && (
          <div className="py-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                Before the microphone is armed
              </p>
              <ul className="mt-2 grid gap-1.5 text-[11px] leading-relaxed text-amber-900">
                <li>
                  This browser&apos;s speech recogniser runs continuously while the tab is visible,
                  and streams what it hears to the browser vendor&apos;s speech service — Chrome
                  sends it to Google — independently of this portal.
                </li>
                <li>
                  Hiding the tab releases the microphone; closing the tab disarms it. The app bar
                  shows a persistent indicator while it is listening.
                </li>
                <li>
                  Audio is never stored by this portal. Only the transcript of a turn you choose to
                  send is saved, exactly as if you typed it.
                </li>
                <li>
                  Nothing is armed by default, and an administrator cannot arm it for you: this
                  switch writes only your own row.
                </li>
              </ul>
              <label className="mt-3 flex items-start gap-2 text-[11px] font-semibold text-amber-900">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-amber-700"
                />
                I have read what the microphone sends, and I want the wake word on this account.
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !acknowledged}
                  onClick={() => void armWithConsent()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-ink px-3 py-1.5 text-[11px] font-bold text-brand-cream transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Arm the microphone
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConsentOpen(false);
                    setAcknowledged(false);
                    setNotice(null);
                  }}
                  className="rounded-full border border-brand-line bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand disabled:opacity-50"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}
        {form.ambient && !consentOpen && (
          <p className="py-2.5 text-[11px] leading-relaxed text-brand-ink/55">
            Listening is reported by the recogniser itself, not by this switch: if this browser
            refuses the microphone, the orb says so and nothing is heard.
          </p>
        )}
      </Section>

      <Section
        icon={<Bell className="h-3.5 w-3.5" aria-hidden />}
        title="Speaking first"
        hint="The presence may speak once on its own — a three-sentence briefing — and it may interrupt when a queue you chose crosses its threshold. Both are off until you turn them on."
      >
        <p className="py-2.5 text-[11px] leading-relaxed text-brand-ink/55">
          Sentences are read by the voice installed on the machine you are looking at; nothing is
          sent to a speech service. A machine with no voice for the sentence&apos;s language says so
          and leaves the words on screen. Which voice that is, and how fast it reads, is chosen in
          The voice and the pace below.
        </p>
        <SwitchRow
          checked={form.briefing}
          disabled={locked}
          label="A morning briefing"
          hint="Read aloud once a day: the queues standing above their threshold at the hour below, most urgent first, at most three lines. A quiet window defers it to the moment the window closes."
          onChange={(next) => void save({ briefing: next })}
        />
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-bold text-brand-ink">Briefing hour</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
              The group&apos;s wall clock. The briefing is due after this hour, once per person per
              day; it is never repeated because a queue grew.
            </p>
          </div>
          <select
            value={form.briefingHour}
            disabled={locked}
            aria-label="Briefing hour"
            onChange={(event) => {
              const briefingHour = Number(event.target.value);
              setForm((current) => ({ ...current, briefingHour }));
              void save({ briefingHour });
            }}
            className="shrink-0 rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </div>

        <SwitchRow
          checked={form.watching}
          disabled={locked}
          label="Threshold alerts"
          hint="While the tab is visible, the feed is read every two minutes. A queue crossing its threshold is spoken once; staying above it is the same news, and only a drain below re-arms it."
          onChange={(next) => void save({ watching: next })}
        />
        <div className="py-3">
          <p className="text-xs font-bold text-brand-ink">Queues allowed to speak</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
            The thresholds are the attention feed&apos;s own counts — this chooses which of them may
            be spoken, not when they count. A queue left unticked still counts and still badges; it
            just never speaks.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {JARVIS_QUEUES.map((rule) => {
              const checked = form.watchQueues.includes(rule.id);
              return (
                <label
                  key={rule.id}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border px-2.5 py-2 transition",
                    checked ? "border-brand-gold/60 bg-brand-gold/5" : "border-brand-line bg-white",
                    locked && "opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(event) => toggleQueue(rule.id, event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-gold-dark"
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold text-brand-ink">
                      {spokenLabel(rule.spoken)}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-brand-ink/55">
                      News when the feed counts more than {rule.threshold}.
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {form.watchQueues.length === 0 && (
            <p className="mt-2 text-[11px] font-semibold text-amber-700">
              No queue is ticked, so threshold alerts will stay silent even while the switch is on.
            </p>
          )}
        </div>
      </Section>

      <Section
        icon={<Volume2 className="h-3.5 w-3.5" aria-hidden />}
        title="The voice and the pace"
        hint="Which of this machine's own voices reads a sentence, and how fast it reads it. Remembered in this browser rather than on your account: the orb's briefing and the answers you have read aloud on the Assistant page both obey them, and neither one goes to a speech service."
      >
        <div className="py-3">
          <p className="text-xs font-bold text-brand-ink">Voice</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
            The names below are the voices installed on the machine you are looking at. A chosen
            voice reads every sentence in whichever language it arrives; with no choice made the
            device answers in its own voice for that language, and a name this machine no longer
            has falls back the same way.
          </p>
          <select
            value={voiceMissing ? "" : voiceId}
            aria-label="Voice"
            onChange={(event) => {
              setPreviewProblem(null);
              writeStoredVoiceId(event.target.value);
            }}
            className="mt-2 w-full rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink"
          >
            <option value="">The device&apos;s own voice for each language</option>
            {devices.map((voice, index) => (
              <option key={`${voice.voiceURI}-${index}`} value={voice.voiceURI}>
                {voice.name} — {voice.lang}
              </option>
            ))}
          </select>
          {devices.length === 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/55">
              No voice list has arrived from this browser yet. Chrome and Edge give one a moment
              after the page opens, and this panel updates when it does.
            </p>
          )}
          {voiceMissing && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-700">
              “{voiceId}” is not on this machine, so the device&apos;s own voice is answering for
              now. Choosing it again puts it back.
            </p>
          )}
        </div>

        <div className="py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold text-brand-ink">Speaking pace</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
                A factor of normal, from {SPEECH_RATE_MIN.toFixed(1)}× to {SPEECH_RATE_MAX}×. A
                change reaches the next sentence, not the one already in the air.
              </p>
            </div>
            <p className="shrink-0 rounded-full border border-brand-line bg-brand-cream px-2.5 py-1 text-xs font-bold tabular-nums text-brand-ink">
              {speechRate.toFixed(1)}×
            </p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-brand-ink/50">slower</span>
            <input
              type="range"
              min={SPEECH_RATE_MIN}
              max={SPEECH_RATE_MAX}
              step={0.1}
              value={speechRate}
              aria-label="Speaking pace"
              onChange={(event) => {
                setPreviewProblem(null);
                writeStoredSpeechRate(Number(event.target.value));
              }}
              className="h-1.5 w-full accent-brand-gold-dark"
            />
            <span className="text-[10px] font-semibold text-brand-ink/50">faster</span>
          </div>
          {speechRate !== DEFAULT_SPEECH_RATE && (
            <button
              type="button"
              onClick={() => writeStoredSpeechRate(DEFAULT_SPEECH_RATE)}
              className="mt-2 rounded-full border border-brand-line bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              Back to a normal pace
            </button>
          )}
        </div>

        <div className="py-3">
          <p className="text-xs font-bold text-brand-ink">Hear it now</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-brand-ink/55">
            The sample is read once, by this machine, in the voice and at the pace chosen above. If
            the presence is mid-sentence it waits its turn rather than cutting the other one short.
          </p>
          <p className="mt-1.5 rounded-xl border border-brand-line bg-brand-cream/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-brand-ink/70">
            “{PREVIEW_SENTENCE}”
          </p>
          <button
            type="button"
            onClick={hearThisVoice}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-ink px-3 py-1.5 text-[11px] font-bold text-brand-cream transition hover:bg-brand-ink/90"
          >
            <Play className="h-3 w-3" aria-hidden />
            Hear this voice
          </button>
          {previewProblem && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-700">
              {previewProblem}
            </p>
          )}
        </div>
      </Section>

      <Section
        icon={<Moon className="h-3.5 w-3.5" aria-hidden />}
        title="The quiet window"
        hint="Speech is suppressed inside this window, including the briefing and threshold alerts. The orb still updates its badge, and the briefing is deferred to the window's end rather than cancelled."
      >
        <div className="flex flex-wrap items-end gap-3 py-2.5">
          <label className="grid gap-1 text-[11px] font-bold text-brand-ink">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-brand-gold-dark" aria-hidden />
              From
            </span>
            <input
              type="time"
              value={form.quietFrom}
              disabled={locked}
              aria-label="Quiet hours start"
              onChange={(event) => {
                const quietFrom = event.target.value;
                setForm((current) => ({ ...current, quietFrom }));
              }}
              onBlur={(event) => commitClock("quietFrom", event.target.value)}
              className="rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-bold text-brand-ink">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-brand-gold-dark" aria-hidden />
              To
            </span>
            <input
              type="time"
              value={form.quietTo}
              disabled={locked}
              aria-label="Quiet hours end"
              onChange={(event) => {
                const quietTo = event.target.value;
                setForm((current) => ({ ...current, quietTo }));
              }}
              onBlur={(event) => commitClock("quietTo", event.target.value)}
              className="rounded-xl border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50"
            />
          </label>
        </div>
        <p className="py-2.5 text-[11px] leading-relaxed text-brand-ink/55">
          {form.quietFrom === form.quietTo
            ? "The start and the end are the same time, so there is no quiet window: the assistant may speak at any hour."
            : "A window that wraps midnight — 18:00 to 08:00 — is the ordinary case: the start minute is silent and the end minute is when speech returns."}
        </p>
      </Section>

      {notice && !error && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-semibold leading-relaxed text-amber-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[11px] font-semibold leading-relaxed text-rose-700">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/60">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          Saved to your account — {saved}.
        </p>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-brand-ink/55">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
          The orb appears on every admin screen.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Ear className="h-3.5 w-3.5 text-brand-gold" aria-hidden />
          <Link href="/assistant" className="font-semibold text-brand-ink underline-offset-2 hover:underline">
            Open the conversation
          </Link>{" "}
          — or press Ctrl+Space anywhere.
        </span>
      </p>
    </div>
  );
}
