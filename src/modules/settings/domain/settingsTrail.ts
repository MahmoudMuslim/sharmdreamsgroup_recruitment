/**
 * The settings change trail, in one implementation.
 *
 * `settings_audit_log` is what the portal records when a setting, a template, a
 * staff account or a stored file is written: the key, the value before, the value
 * after, and who the door managing it thought was acting. Until now the only
 * reader was the assistant, which answered with a window of its own choosing —
 * the recruiter was shown a number of changes no screen could reproduce, and the
 * link offered `/activity`, a page built on a different table that reports its
 * trail has not been created yet. So this module gives the read one scope
 * vocabulary, one cap and one disclosure, shared by the console section and the
 * chat tool exactly as the keys console's credential trail does.
 *
 * A row is filed under the console section that renders its key, because that is
 * where a reader goes to look at the thing that moved — `branding.logo_url` is
 * edited under General, so it belongs with General, not with a "branding" group
 * no dock entry has. Keys the console renders no control for are matched by their
 * own prefix instead: message templates, team accounts, stored files, and the
 * integration switches this portal deleted in favour of enforcing nothing.
 *
 * The actor column is reported as a count, never assumed. Most rows name nobody,
 * because the doors that wrote them recorded no actor, and a trail that quietly
 * left those rows blank reads as "nobody changed this" to whoever counts.
 *
 * Pure by design — no database, no `server-only`, no clock — so the client console
 * and the server-side read can import it alike.
 */

import { printableValue } from "@/modules/activity/domain/trail";
import { ALL_SETTINGS } from "./settingSearch";
import { SETTINGS_SCHEMA } from "./schema";

/** How many newest rows the console section and the chat answer both carry. */
export const SETTINGS_TRAIL_LIMIT = 15;

/**
 * A slice of the trail a reader can ask for.
 *
 * `keys` is exact: the settings a console section renders, so a section's rows are
 * the rows its own controls could have written. `prefix` is for the families the
 * Platform schema declares no control for — their key is the only thing that names
 * them, and it is stable because the writer composes it.
 */
export type SettingsTrailGroup =
  | { id: string; label: string; kind: "keys"; keys: readonly string[] }
  | { id: string; label: string; kind: "prefix"; prefix: string };

type KeyGroup = Extract<SettingsTrailGroup, { kind: "keys" }>;
type PrefixGroup = Extract<SettingsTrailGroup, { kind: "prefix" }>;

/**
 * The families a trail row can be filed under, for the writes that name no
 * settings control.
 *
 * `Removed integrations` is deliberately not friendlier than the fact: those rows
 * are real history, and the switches they record are gone from the console, so a
 * reader hunting one of them has to be told the door closed rather than left to
 * conclude the trail is broken.
 */
const UNCONTROLLED_GROUPS: readonly PrefixGroup[] = [
  { id: "templates", label: "Message templates", kind: "prefix", prefix: "notification_template:" },
  { id: "team", label: "Team accounts", kind: "prefix", prefix: "staff." },
  { id: "files", label: "Stored files", kind: "prefix", prefix: "storage." },
  { id: "integrations", label: "Removed integrations", kind: "prefix", prefix: "integrations." },
];

/** Every section of the Platform area, as the trail files it. */
const SECTION_GROUPS: readonly KeyGroup[] = SETTINGS_SCHEMA.map((section) => ({
  id: section.id,
  label: section.title,
  kind: "keys" as const,
  keys: section.controls.map((control) => control.key),
}));

/** The whole vocabulary, in the order a reader meets it: the dock's sections, then the rest. */
export const SETTINGS_TRAIL_GROUPS: readonly SettingsTrailGroup[] = [
  ...SECTION_GROUPS,
  ...UNCONTROLLED_GROUPS,
];

export function trailGroupById(id: string | null | undefined): SettingsTrailGroup | null {
  if (!id) return null;
  return SETTINGS_TRAIL_GROUPS.find((group) => group.id === id) ?? null;
}

/**
 * The scope a parameter or argument asks for, or `null` for the whole trail.
 *
 * Trimmed, and only an id this module declares narrows anything. A typo, a stale
 * bookmark naming a section the schema dropped, or an empty parameter all read as
 * "no filter", which is how every other console on this page treats its parameters
 * — a filtered list that comes back empty is indistinguishable from a trail with
 * nothing in it.
 */
export function trailGroup(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && trailGroupById(id) ? id : null;
}

/**
 * Where a stored key belongs.
 *
 * A control lookup first, because the section a key is edited in is the answer a
 * reader can act on; the prefix families only catch what no control declares.
 * Anything else has no group, and the console shows it as unfiled rather than
 * inventing a home for it.
 */
export function trailGroupFor(key: string): SettingsTrailGroup | null {
  const control = ALL_SETTINGS.find((entry) => entry.key === key);
  if (control) {
    return (
      SECTION_GROUPS.find((group) => group.id === control.sectionId) ??
      null
    );
  }
  return UNCONTROLLED_GROUPS.find((group) => key.startsWith(group.prefix)) ?? null;
}

/**
 * The words the console uses for a stored key.
 *
 * A trail row names a key (`security.session_timeout_minutes`), but the reader
 * knows it as the label beside its switch ("Idle session timeout"), so both are
 * shown and neither is retyped here. Keys no control declares — a team account, a
 * deleted integration switch — have no label, and the key stands on its own.
 */
export function trailKeyLabel(key: string): string | null {
  return ALL_SETTINGS.find((entry) => entry.key === key)?.label ?? null;
}

/** A stored value in the words a trail row prints — short, and never an empty cell. */
export function trailValueText(value: unknown): string {
  return printableValue(value);
}

/**
 * What a trail answer is standing on.
 *
 * Four facts in the order a reader needs them: whose history this is, how many
 * rows exist, whether the listing holds all of them, and how many of those rows
 * can name a person. The third clause is the one a busy portal cannot do without —
 * 15 rows of 152 reads as the whole trail to anyone who counts what is on the
 * screen. The fourth is what stops a blank actor column being read as "nobody
 * touched this".
 */
export function settingsTrailNote(input: {
  groupId: string | null;
  total: number;
  loaded: number;
  named: number;
}): string {
  const { groupId, total, loaded, named } = input;
  const group = trailGroupById(groupId);
  const rows = (value: number) => `${value.toLocaleString()} row${value === 1 ? "" : "s"}`;
  const whose = group ? ` for ${group.label}` : "";

  if (total === 0) {
    return group
      ? `Nothing is recorded${whose} — this trail holds only changes made through this portal, so a setting nobody has saved has no row here.`
      : "No change has been recorded through this portal yet, so the trail is empty.";
  }

  const hidden = total - loaded;
  const span =
    hidden > 0
      ? `this listing carries the newest ${rows(loaded)} of them, so ${hidden.toLocaleString()} older ${
          hidden === 1 ? "change is" : "changes are"
        } not shown here`
      : `this listing carries all ${rows(total)}`;
  const who =
    named === 0
      ? "No row names the person who made it: those writes recorded no actor, and the trail does not guess one."
      : named === total
        ? "Every row names the person who made it."
        : `Only ${named.toLocaleString()} of the ${total.toLocaleString()} name${
            named === 1 ? "s" : ""
          } the person who made it — the rest were written by a door that recorded no actor.`;
  return `${rows(total)} recorded${whose} — ${span}. ${who}`;
}
