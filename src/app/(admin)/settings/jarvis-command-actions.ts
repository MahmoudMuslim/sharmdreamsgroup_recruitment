"use server";

import { requireStaff } from "@/lib/auth/session";
import { createServerRestClient } from "@/lib/data-api/server";
import { recordActivity } from "@/modules/activity/application/record";
import { ASSISTANT_TOOLS } from "@/modules/assistant/domain/tools";
import {
  COMMAND_LIMITS,
  normalizeCommandRow,
  parseCommandDraft,
  type CommandDraft,
  type CommandRow,
  type VoiceCommand,
} from "@/modules/assistant/domain/commands";
import { readVoiceCommand } from "@/modules/assistant/application/jarvisCommands";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";

const GUARD = "/settings?area=assistant&section=commands";
const TABLE = "assistant_jarvis_commands";
const NOT_FOUND = "That command is not in your list. Reload the list and try again.";

export type CommandWriteResult =
  | { ok: true; command: VoiceCommand | null }
  | { ok: false; error: string; field?: keyof CommandDraft };

function toRow(command: VoiceCommand): Omit<CommandRow, "id"> {
  const { type: action_type, ...action_payload } = command.action ?? { type: "" };
  return {
    scope: command.scope,
    owner_profile_id: command.ownerProfileId,
    trigger_phrase: command.triggerPhrase,
    title: command.title,
    category: command.rawCategory ?? command.category,
    action_type,
    action_payload,
    notes: command.notes,
    enabled: command.enabled,
  };
}

function refusal(error: { code?: string | null; message?: string | null }, phrase = ""): CommandWriteResult {
  if (/42P01|PGRST205|PGRST204|does not exist|schema cache/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    return {
      ok: false,
      error:
        "This command could not be saved, because this database holds no voice commands table to save it into. " +
        "db/migrations/051_jarvis_voice_commands.sql is the file that creates it, and running it is somebody's decision.",
    };
  }
  if (error.code === "23505") {
    return {
      ok: false,
      field: "trigger_phrase",
      error: `Something already answers to “${phrase}” in this list. A phrase is one command, and the existing one keeps it.`,
    };
  }
  return { ok: false, error: error.message || "The command could not be saved." };
}

async function writePermission(command: VoiceCommand, profileId: string): Promise<string | null> {
  if (command.scope === "shared") {
    return await hasPermissionForUser("assistant.commands")
      ? null
      : "Changing shared commands needs the assistant.commands permission, which this account does not have.";
  }
  return command.ownerProfileId === profileId ? null : NOT_FOUND;
}

async function trail(profileId: string, action: string, summary: string, detail: Record<string, unknown>): Promise<void> {
  await recordActivity({ area: "settings", entity: "setting", action, summary, detail, actorId: profileId });
}

export async function saveCommand(draft: CommandDraft, scope: "personal" | "shared"): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  if (scope !== "personal" && scope !== "shared") return { ok: false, error: "Choose a personal or shared list." };
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { ok: false, error: "A command must contain named fields." };
  if (scope === "shared" && !(await hasPermissionForUser("assistant.commands"))) {
    return { ok: false, error: "Publishing shared commands needs the assistant.commands permission, which this account does not have." };
  }
  if (draft.id !== undefined && (typeof draft.id !== "string" || !draft.id.trim())) {
    return { ok: false, error: "Choose an existing command to update.", field: "id" };
  }
  const id = typeof draft.id === "string" ? draft.id : "";
  const { command: previous, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? NOT_FOUND };
  if (id && !previous) return { ok: false, error: NOT_FOUND, field: "id" };
  if (previous) {
    const denied = await writePermission(previous, staff.profileId);
    if (denied) return { ok: false, error: denied };
    if (previous.scope !== scope) return { ok: false, error: "A saved command stays in its list. Use Add to mine to copy a shared command." };
  }
  const base: VoiceCommand = previous ?? {
    id: crypto.randomUUID(), scope, ownerProfileId: scope === "personal" ? staff.profileId : null,
    triggerPhrase: "", title: "", category: "personal", rawCategory: null,
    action: null, notes: null, enabled: true, problem: null,
  };
  const parsed = parseCommandDraft(draft, base, ASSISTANT_TOOLS);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field };
  const rest = await createServerRestClient();
  const row = toRow(parsed.command);
  const query = previous
    ? rest.from(TABLE).update(row).eq("id", previous.id)
    : rest.from(TABLE).insert(row);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) return refusal(error, parsed.command.triggerPhrase);
  if (!data) return { ok: false, error: NOT_FOUND };
  const command = normalizeCommandRow(data as unknown as CommandRow);
  await trail(staff.profileId, previous ? "command updated" : "command created",
    `${previous ? "Updated" : "Created"} the voice command “${command.title}”`, { from: previous, to: command });
  return { ok: true, command };
}

export async function duplicateCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? NOT_FOUND };
  if (!command) return { ok: false, error: NOT_FOUND };
  const denied = await writePermission(command, staff.profileId);
  if (denied) return { ok: false, error: denied };
  const phrase = `${command.triggerPhrase.slice(0, COMMAND_LIMITS.phraseMax - 5)} copy`;
  const title = `${command.title.slice(0, COMMAND_LIMITS.titleMax - 7)} (copy)`;
  const parsed = parseCommandDraft({ ...toRow(command), trigger_phrase: phrase, title }, command, ASSISTANT_TOOLS);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field };
  const rest = await createServerRestClient();
  const { data, error } = await rest.from(TABLE).insert(toRow(parsed.command)).select("*").maybeSingle();
  if (error) return refusal(error, phrase);
  if (!data) return { ok: false, error: NOT_FOUND };
  const copied = normalizeCommandRow(data as unknown as CommandRow);
  await trail(staff.profileId, "command duplicated", `Duplicated the voice command “${command.title}”`, { from: command, to: copied });
  return { ok: true, command: copied };
}

export async function deleteCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? NOT_FOUND };
  if (!command) return { ok: false, error: NOT_FOUND };
  const denied = await writePermission(command, staff.profileId);
  if (denied) return { ok: false, error: denied };
  const rest = await createServerRestClient();
  const { data, error } = await rest.from(TABLE).delete().eq("id", command.id).select("id").maybeSingle();
  if (error) return refusal(error, command.triggerPhrase);
  if (!data) return { ok: false, error: NOT_FOUND };
  await trail(staff.profileId, "command deleted", `Deleted the voice command “${command.title}”`, { from: command, to: null });
  return { ok: true, command: null };
}

export async function setCommandEnabled(id: string, enabled: boolean): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  if (typeof enabled !== "boolean") return { ok: false, error: "Enabled is a yes or a no.", field: "enabled" };
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? NOT_FOUND };
  if (!command) return { ok: false, error: NOT_FOUND };
  const denied = await writePermission(command, staff.profileId);
  if (denied) return { ok: false, error: denied };
  if (enabled && command.problem) return { ok: false, error: "Edit and save this command before enabling it; its stored fields cannot be used." };
  const rest = await createServerRestClient();
  const { data, error } = await rest.from(TABLE).update({ enabled }).eq("id", command.id).select("id").maybeSingle();
  if (error) return refusal(error, command.triggerPhrase);
  if (!data) return { ok: false, error: NOT_FOUND };
  await trail(staff.profileId, "command switched", `${enabled ? "Enabled" : "Disabled"} the voice command “${command.title}”`,
    { from: { enabled: command.enabled }, to: { enabled } });
  return { ok: true, command: null };
}

export async function adoptSharedCommand(id: string): Promise<CommandWriteResult> {
  const staff = await requireStaff(GUARD);
  const { command, read } = await readVoiceCommand(id);
  if (read.problem) return { ok: false, error: read.message ?? NOT_FOUND };
  if (!command) return { ok: false, error: NOT_FOUND };
  if (command.scope !== "shared") return { ok: false, error: "That one is already yours." };
  const personal = { ...command, scope: "personal" as const, ownerProfileId: staff.profileId };
  const parsed = parseCommandDraft(toRow(command), personal, ASSISTANT_TOOLS);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field };
  const rest = await createServerRestClient();
  const { data, error } = await rest.from(TABLE).insert(toRow(parsed.command)).select("*").maybeSingle();
  if (error) return refusal(error, command.triggerPhrase);
  if (!data) return { ok: false, error: NOT_FOUND };
  const copied = normalizeCommandRow(data as unknown as CommandRow);
  await trail(staff.profileId, "command adopted", `Added the shared voice command “${command.title}” to your own list`, { from: command, to: copied });
  return { ok: true, command: copied };
}
