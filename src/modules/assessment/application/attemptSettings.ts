import {
  coerceNumber,
  readGlobalSettings,
} from "@/modules/settings/infrastructure/settingsReader";
import type { AttemptSettings } from "@/stores/useAssessmentStore";

/** The cadence the runner used before the setting existed. */
export const DEFAULT_AUTOSAVE_INTERVAL_SECONDS = 20;

/**
 * Bounds from Settings → Assessments → Autosave interval.
 *
 * The number drives a client timer, so a mistyped row must not be able to ask a
 * candidate's browser to POST a draft every millisecond.
 */
const AUTOSAVE_MIN_SECONDS = 5;
const AUTOSAVE_MAX_SECONDS = 120;

const AUTOSAVE_KEY = "assessment.autosave_interval_seconds";
const FOCUS_KEY = "assessment.track_focus_changes";

/**
 * The assessment rules handed to a test as it opens.
 *
 * Only an explicit `false` turns focus tracking off — a missing or unreadable
 * row leaves the candidate with the disclosure they were shown on screen.
 */
export async function getAttemptSettings(): Promise<AttemptSettings> {
  const settings = await readGlobalSettings([AUTOSAVE_KEY, FOCUS_KEY]);
  const seconds = coerceNumber(
    settings.get(AUTOSAVE_KEY),
    DEFAULT_AUTOSAVE_INTERVAL_SECONDS
  );
  const focus = settings.get(FOCUS_KEY);

  return {
    autosave_interval_seconds: Math.min(
      AUTOSAVE_MAX_SECONDS,
      Math.max(AUTOSAVE_MIN_SECONDS, Math.round(seconds))
    ),
    track_focus_changes: !(focus === false || focus === "false"),
  };
}
