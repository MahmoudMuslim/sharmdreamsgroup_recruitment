"use client";

import { useRef, useState } from "react";
import {
  DEFAULT_JARVIS_APPEARANCE,
  MOTION_CONTROLS,
  ORB_QUALITIES,
  PALETTE_COLORS,
  REACTOR_STATES,
  isJarvisColorHex,
  parseJarvisAppearance,
  type JarvisAppearance,
  type ReactorState,
} from "@/modules/assistant/domain/jarvisAppearance";
import { refreshJarvisPresence } from "@/lib/jarvis-ui";
import { JarvisReactor } from "@/modules/assistant/presentation/JarvisReactor";
import { setJarvisAppearance } from "./jarvis-actions";

/**
 * The Appearance half of Settings → Assistant
 * (`/settings?area=assistant&section=appearance`): the orb's colours, its eight bounded
 * motions, its quality and its breath — stored on this person's own row.
 *
 * Two rules hold the panel together. It invents no state: the six tabs are the six
 * states the presence is actually driven by, so a "custom state" is a saved look
 * for one of them and never a claim that something is happening. And it touches the
 * presence store exactly once, on a save the server confirmed — a preview that armed
 * the microphone or reported a working turn would be theatre.
 *
 * `hexEdits` carries the raw text of a colour field that is not yet a legal hex.
 * The draft keeps the last legal value, so a half-typed `#12` reaches neither the
 * preview, nor a preset, nor the account, while the field stays editable: someone
 * mid-keystroke has not asked to lose their choice.
 */
export interface AppearanceConsoleProps {
  initial: {
    appearance: JarvisAppearance;
    stored: boolean;
    problem: "absent" | "unreadable" | null;
  };
  /**
   * Which state the editor opens on. The address can name one
   * (`/settings?area=assistant&section=appearance&state=alert`), so an answer that says
   * "the red one is too bright" can hand over the half of the page it means.
   */
  initialState?: ReactorState | null;
}

type PaletteKey = (typeof PALETTE_COLORS)[number];
type Preset = JarvisAppearance["presets"][number];

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const fieldKey = (state: ReactorState, color: PaletteKey) => `${state}:${color}`;
const copy = (value: JarvisAppearance) => structuredClone(value);
const clamp = (min: number, max: number, value: number) => Math.min(max, Math.max(min, value));

const BUTTON =
  "rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const CARD = "rounded-2xl border border-brand-line bg-white p-4";
const LABEL = "text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark";
const HINT = "mt-1 text-xs leading-relaxed text-brand-ink/60";

export function AppearanceConsole({ initial, initialState = null }: AppearanceConsoleProps) {
  // `baseline` is what the server confirmed, `draft` what the controls show. A
  // refused or thrown save leaves both alone, so a field can never display a value
  // nobody stored, and Discard always has something real to fall back to.
  const [draft, setDraft] = useState(() => copy(initial.appearance));
  const [baseline, setBaseline] = useState(() => copy(initial.appearance));
  const [stored, setStored] = useState(initial.stored);
  const [selected, setSelected] = useState<ReactorState>(initialState ?? "idle");
  const [hexEdits, setHexEdits] = useState<Record<string, string>>({});
  const [presetName, setPresetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Every handler reads this instead of the `pending` its own render closed over:
  // the handlers created before a save began would otherwise all still believe
  // nothing is in flight, and a stale edit would land on a draft being written.
  const pendingRef = useRef(false);
  const problem = initial.problem;
  const writable = problem === null;

  const invalidFields = Object.keys(hexEdits);
  const dirty = invalidFields.length > 0 || JSON.stringify(draft) !== JSON.stringify(baseline);
  // Which of the six the draft has actually moved, so a tab says whether the
  // state behind its name is still the portal's own look without opening it.
  const differsFromPortal = (state: ReactorState) =>
    JSON.stringify(draft.states[state]) !== JSON.stringify(DEFAULT_JARVIS_APPEARANCE.states[state]);

  const headline = pending
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : stored
        ? "Saved to your account."
        : "Not saved yet — this is the portal's own default look.";
  const status = writable ? headline : `${headline} Draft only: nothing here reaches your account.`;

  function mutate(change: (next: JarvisAppearance) => void) {
    if (pendingRef.current) return;
    const next = copy(draft);
    change(next);
    setDraft(next);
  }

  function editColor(state: ReactorState, color: PaletteKey, raw: string) {
    if (pendingRef.current) return;
    const key = fieldKey(state, color);
    if (!isJarvisColorHex(raw)) {
      setHexEdits((current) => ({ ...current, [key]: raw }));
      return;
    }
    setHexEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (raw !== draft.states[state].palette[color]) {
      mutate((next) => {
        next.states[state].palette[color] = raw;
      });
    }
  }

  function editNumber(
    min: number,
    max: number,
    raw: string,
    change: (next: JarvisAppearance, value: number) => void
  ) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    mutate((next) => change(next, clamp(min, max, value)));
  }

  /** The schema stays the final guard, so a thirteenth or duplicate preset is refused here too. */
  function savePreset() {
    if (pendingRef.current) return;
    if (invalidFields.length > 0) {
      setError("A colour field is not a six-digit hex yet. Fix it, then save the preset.");
      return;
    }
    const name = presetName.trim();
    if (!name) {
      setError("Give the preset a name first.");
      return;
    }
    const candidate = copy(draft);
    candidate.presets = [...candidate.presets, { name, ...structuredClone(draft.states[selected]) }];
    const parsed = parseJarvisAppearance(candidate);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setDraft(parsed.appearance);
    setPresetName("");
  }

  function applyPreset(index: number) {
    const preset: Preset | undefined = draft.presets[index];
    if (!preset) return;
    const visual = structuredClone({ palette: preset.palette, motion: preset.motion });
    mutate((next) => {
      next.states[selected] = visual;
    });
  }

  function removePreset(index: number) {
    mutate((next) => {
      next.presets.splice(index, 1);
    });
  }

  function resetSelected() {
    mutate((next) => {
      next.states[selected] = structuredClone(DEFAULT_JARVIS_APPEARANCE.states[selected]);
    });
    setHexEdits((current) => {
      const next = { ...current };
      for (const color of PALETTE_COLORS) delete next[fieldKey(selected, color)];
      return next;
    });
  }

  function resetAll() {
    if (pendingRef.current) return;
    setDraft(copy(DEFAULT_JARVIS_APPEARANCE));
    setHexEdits({});
    setPresetName("");
  }

  function discard() {
    if (pendingRef.current) return;
    setDraft(copy(baseline));
    setHexEdits({});
    setPresetName("");
    setError(null);
  }

  async function saveAppearance() {
    if (pendingRef.current) return;
    if (!writable) {
      setError("Your appearance cannot be stored right now, so nothing below was written.");
      return;
    }
    if (invalidFields.length > 0) {
      setError("A colour field is not a six-digit hex, so nothing was saved. Fix it or discard the change.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setWarning(null);
    try {
      const result = await setJarvisAppearance(copy(draft));
      if (result.ok) {
        setDraft(copy(result.appearance));
        setBaseline(copy(result.appearance));
        setStored(true);
        setHexEdits({});
        setWarning(result.warning ?? null);
        // The orb read this row when the shell mounted and the shell survives every
        // in-app navigation, so a saved look needs this nudge to reach it.
        refreshJarvisPresence();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Your appearance could not be saved. The draft is still here — try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      {problem === "absent" && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-relaxed text-amber-800">
          db/migrations/049_jarvis_appearance.sql is authored but not applied on this database, so there is no
          column to store a look in. Edit freely — every control below works on a draft in this browser — but
          applying Migration 049 is the only way a saved appearance reaches the orb.
        </p>
      )}
      {problem === "unreadable" && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-relaxed text-amber-800">
          Your saved appearance could not be read, so this panel shows the portal defaults and stores nothing.
          Nothing has been assumed about what you chose. Reload the page to read it again.
        </p>
      )}

      <fieldset disabled={pending ? true : undefined} className="m-0 grid min-w-0 gap-4 border-0 p-0">
        <section className={CARD}>
          <p className={LABEL}>Preview</p>
          <p className={HINT}>
            The orb on every admin screen is drawn by the same component as this preview. Pick a state to see
            and edit that one — nothing here starts listening, thinking or speaking.
          </p>
          <div className="mt-4 flex justify-center rounded-2xl bg-brand-cream/70 py-6">
            <JarvisReactor appearance={draft} preview size={240} state={selected} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Which state is shown and edited">
            {REACTOR_STATES.map((state) => (
              <button
                key={state}
                type="button"
                aria-label={capital(state)}
                aria-pressed={selected === state}
                onClick={() => {
                  if (pendingRef.current) return;
                  setSelected(state);
                }}
                className={`${BUTTON} ${
                  selected === state
                    ? "border-brand-gold bg-brand-gold/15 text-brand-ink"
                    : "border-brand-line bg-white text-brand-ink/60"
                }`}
              >
                {capital(state)}
                {differsFromPortal(state) && (
                  <span
                    aria-hidden
                    title="This state is not the portal's own look"
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-gold align-middle"
                  />
                )}
              </button>
            ))}
          </div>
          <p className={HINT}>
            A dot beside a name means that state wears colours or motion of its own rather than the
            portal&apos;s. The reset below puts just the open one back.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/55">
            {draft.presets.length > 0
              ? `A preset applies to ${capital(selected)} only: applying one replaces this state's colours and motion and leaves the other five as they are.`
              : "A preset is a snapshot of the state you are editing. It stays in this browser until you save."}
          </p>
        </section>

        <section className={CARD}>
          <p className={LABEL}>Colours · {capital(selected)}</p>
          <p className={HINT}>
            Five colours draw the reactor: the core, the two shells, the filaments and the deep field behind
            them. The swatch and the box hold the same value; an incomplete hex stays in the box and is refused
            everywhere else.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PALETTE_COLORS.map((color) => {
              const committed = draft.states[selected].palette[color];
              const key = fieldKey(selected, color);
              const invalid = key in hexEdits;
              return (
                <div key={color} className="flex items-center gap-2 rounded-xl border border-brand-line px-2.5 py-2">
                  <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-wider text-brand-ink/60">
                    {capital(color)}
                  </span>
                  <input
                    type="color"
                    aria-label={`${capital(color)} color`}
                    value={committed}
                    onChange={(event) => editColor(selected, color, event.target.value)}
                    className="h-7 w-9 shrink-0 cursor-pointer rounded border border-brand-line bg-white"
                  />
                  <input
                    type="text"
                    aria-label={`${capital(color)} hex`}
                    value={hexEdits[key] ?? committed}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => editColor(selected, color, event.target.value)}
                    className={`min-w-0 flex-1 rounded-lg border px-2 py-1 font-mono text-xs ${
                      invalid ? "border-rose-400 bg-rose-50 text-rose-700" : "border-brand-line bg-white text-brand-ink"
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Reset selected state"
            onClick={resetSelected}
            className={`${BUTTON} mt-3 border-brand-line bg-brand-sand text-brand-ink/70`}
          >
            Reset selected state
          </button>
        </section>

        <section className={CARD}>
          <p className={LABEL}>Motion · {capital(selected)}</p>
          <p className={HINT}>
            Eight bounds, each clamped at the limits the reactor accepts. Every value is one person&apos;s
            taste, not a performance setting: nothing here speeds up or slows down the assistant itself.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {MOTION_CONTROLS.map(({ key, label, min, max }) => {
              const value = draft.states[selected].motion[key];
              return (
                <div key={key} className="rounded-xl border border-brand-line px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-bold text-brand-ink">{label}</span>
                    <span className="font-mono text-[11px] text-brand-ink/55">{value.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={0.01}
                    value={value}
                    onChange={(event) =>
                      editNumber(min, max, event.target.value, (next, number) => {
                        next.states[selected].motion[key] = number;
                      })
                    }
                    className="mt-1 w-full accent-brand-gold"
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className={CARD}>
          <p className={LABEL}>Whole orb</p>
          <p className={HINT}>
            Quality chooses how much the reactor draws and is the one change that rebuilds it, so the preview
            may blink once. Breathing is the idle swell the orb keeps while nothing is happening.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-brand-line px-3 py-2">
              <span className="text-xs font-bold text-brand-ink">Quality</span>
              <select
                aria-label="Quality"
                value={draft.quality}
                onChange={(event) => {
                  const chosen = ORB_QUALITIES.find((quality) => quality === event.target.value);
                  if (!chosen) return;
                  mutate((next) => {
                    next.quality = chosen;
                  });
                }}
                className="rounded-lg border border-brand-line bg-white px-2 py-1 text-xs font-semibold text-brand-ink"
              >
                {ORB_QUALITIES.map((quality) => (
                  <option key={quality} value={quality}>
                    {capital(quality)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-brand-line px-3 py-2">
              <span className="text-xs font-bold text-brand-ink">Breathing</span>
              <input
                type="checkbox"
                aria-label="Breathing"
                checked={draft.breathing}
                onChange={(event) => {
                  const next = event.target.checked;
                  mutate((orb) => {
                    orb.breathing = next;
                  });
                }}
                className="h-4 w-4 accent-brand-gold"
              />
            </label>
            <div className="rounded-xl border border-brand-line px-3 py-2 sm:col-span-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-brand-ink">Breath depth</span>
                <span className="font-mono text-[11px] text-brand-ink/55">{draft.breathingIntensity.toFixed(2)}</span>
              </div>
              <input
                type="range"
                aria-label="Breathing intensity"
                min={0.2}
                max={2.4}
                step={0.05}
                value={draft.breathingIntensity}
                onChange={(event) =>
                  editNumber(0.2, 2.4, event.target.value, (next, number) => {
                    next.breathingIntensity = number;
                  })
                }
                className="mt-1 w-full accent-brand-gold"
              />
            </div>
          </div>
        </section>

        <section className={CARD}>
          <p className={LABEL}>Presets</p>
          <p className={HINT}>
            Up to twelve, each a snapshot of {capital(selected)}&apos;s colours and motion. Names are matched
            without regard to case, so the same name twice is one preset, not two.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="Preset name"
              value={presetName}
              placeholder={`Name for ${capital(selected)}`}
              maxLength={40}
              onChange={(event) => {
                if (pendingRef.current) return;
                setPresetName(event.target.value);
              }}
              className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs text-brand-ink"
            />
            <button
              type="button"
              aria-label="Save as preset"
              disabled={draft.presets.length >= 12}
              onClick={savePreset}
              className={`${BUTTON} border-brand-gold bg-brand-gold/15 text-brand-ink`}
            >
              Save as preset
            </button>
          </div>
          {draft.presets.length > 0 && (
            <ul className="mt-3 grid gap-2">
              {draft.presets.map((preset, index) => (
                <li
                  key={`${preset.name}-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-line px-3 py-2"
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 shrink-0 rounded-full border border-brand-line"
                    style={{
                      background: `linear-gradient(135deg, ${preset.palette.core}, ${preset.palette.primary} 55%, ${preset.palette.deep})`,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-brand-ink">{preset.name}</span>
                  <button
                    type="button"
                    aria-label={`Apply ${preset.name}`}
                    onClick={() => applyPreset(index)}
                    className={`${BUTTON} border-brand-line bg-white text-brand-ink/70`}
                  >
                    Apply to {capital(selected)}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${preset.name}`}
                    onClick={() => removePreset(index)}
                    className={`${BUTTON} border-brand-line bg-white text-brand-ink/70`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={CARD}>
          <p className={LABEL}>Save</p>
          <p
            className="mt-2 text-xs font-semibold text-brand-ink"
            aria-label="Appearance status"
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-rose-700"
            >
              {error}
            </p>
          )}
          {warning && (
            <p
              aria-label="Save warning"
              className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800"
            >
              {warning}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Save appearance"
              disabled={!writable}
              onClick={() => void saveAppearance()}
              className={`${BUTTON} border-brand-gold bg-brand-gold text-white`}
            >
              Save appearance
            </button>
            <button
              type="button"
              aria-label="Discard changes"
              onClick={discard}
              className={`${BUTTON} border-brand-line bg-brand-sand text-brand-ink/70`}
            >
              Discard changes
            </button>
            <button
              type="button"
              aria-label="Reset all defaults"
              onClick={resetAll}
              className={`${BUTTON} border-brand-line bg-white text-brand-ink/70`}
            >
              Reset all defaults
            </button>
          </div>
          <p className={HINT}>
            Saving writes one row on your own account and records the before-and-after in the change trail. It
            moves no permission and no candidate, and it leaves the presence switches on the other tab alone.
          </p>
        </section>
      </fieldset>
    </div>
  );
}
