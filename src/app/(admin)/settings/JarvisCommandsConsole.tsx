"use client";

import { useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Mic, Plus } from "lucide-react";
import { Badge, Button, Card } from "@/modules/analytics/presentation/ui";
import { Field, FormMessage, Select, TextArea, TextInput } from "@/modules/analytics/presentation/Form";
import { NAV } from "@/modules/analytics/presentation/nav";
import { fold } from "@/modules/assistant/domain/voice";
import {
  COMMAND_ACTION_TYPES, COMMAND_CATEGORIES, COMMAND_LIMITS,
  type CommandDraft, type CommandScope, type CommandTool, type VoiceCommand,
} from "@/modules/assistant/domain/commands";
import type { VoiceCommandsRead } from "@/modules/assistant/application/jarvisCommands";
import {
  adoptSharedCommand, deleteCommand, duplicateCommand, saveCommand, setCommandEnabled,
  type CommandWriteResult,
} from "./jarvis-command-actions";

type Refusal = { error: string; field?: keyof CommandDraft };

export function JarvisCommandsConsole({ initial, canPublish, tools }: {
  initial: VoiceCommandsRead;
  canPublish: boolean;
  tools: readonly CommandTool[];
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const tab = params.get("tab") === "shared" ? "shared" : "mine";
  const scope: CommandScope = tab === "shared" ? "shared" : "personal";
  const query = params.get("q") ?? "";
  const [rows, setRows] = useState(initial.commands);
  const [lastInitial, setLastInitial] = useState(initial);
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setRows(initial.commands);
    setEditing(null);
    setRefusal(null);
  }
  const editable = !initial.problem && (scope === "personal" || canPublish);
  const scoped = rows.filter((row) => row.scope === scope);
  const needle = fold(query);
  const visible = scoped.filter((row) => (!category || row.category === category)
    && (!needle || fold(`${row.triggerPhrase} ${row.title}`).includes(needle)));

  function updateQuery(key: "tab" | "q", value: string) {
    const search = new URLSearchParams(window.location.search);
    if (value) search.set(key, value); else search.delete(key);
    window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
    setEditing(null);
    setRefusal(null);
    if (key === "tab") setCategory("");
  }

  function run(operation: () => Promise<CommandWriteResult>, message: string, after?: () => void) {
    setRefusal(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await operation();
        if (!result.ok) { setRefusal(result); return; }
        const command = result.command;
        if (command) setRows((current) => [...current.filter((row) => row.id !== command.id), command]);
        after?.();
        setSuccess(message);
      } catch {
        setRefusal({ error: "The request could not be completed. Reload the list before retrying to check whether it was saved." });
      }
    });
  }

  function editor(command?: VoiceCommand) {
    return <CommandEditor key={command?.id ?? `new-${scope}`} command={command} tools={tools}
      editable={editable} pending={pending} refusal={refusal} onRefusal={setRefusal}
      onClose={() => { setEditing(null); setRefusal(null); }}
      onSave={(draft) => run(() => saveCommand(draft, scope), "Command saved.", () => setEditing(null))}
      onDuplicate={() => command && run(() => duplicateCommand(command.id), "Command duplicated.", () => setEditing(null))}
      onDelete={() => command && run(() => deleteCommand(command.id), "Command deleted.", () => {
        setRows((current) => current.filter((row) => row.id !== command.id)); setEditing(null);
      })} />;
  }

  return <div className="space-y-5">
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-brand-gold-dark"><Mic className="h-4 w-4" aria-hidden /><span className="text-xs font-bold uppercase tracking-wider">Your words, your shortcuts</span></div>
          <h2 className="font-display text-xl font-bold">Voice commands</h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-ink/65">Save a phrase to open a page, ask a question, run an assistant tool or say a line. Say it after your wake word.</p>
          <p className="mt-2 text-xs text-brand-ink/55">The list reloads when you visit. Your own phrase takes priority over an identical shared phrase.</p>
        </div>
        <Button type="button" disabled={!editable || pending} onClick={() => { setEditing("new"); setRefusal(null); setSuccess(null); }}><Plus className="h-4 w-4" aria-hidden />Add command</Button>
      </div>
      <div className="flex gap-2 border-t border-brand-line px-5 py-3" role="group" aria-label="Command scope">
        {(["mine", "shared"] as const).map((value) => <Button key={value} type="button" size="sm" variant={tab === value ? "primary" : "ghost"} aria-pressed={tab === value} disabled={pending} onClick={() => updateQuery("tab", value)}>{value === "mine" ? "Mine" : "Shared"}</Button>)}
      </div>
    </Card>
    {initial.problem && <p role="alert" className="rounded-xl border border-brand-gold/40 bg-brand-sand p-4 text-sm break-words">{initial.message}</p>}
    {initial.capped && <p role="status" className="text-sm text-brand-ink/65">The list is showing the first {COMMAND_LIMITS.rows} commands. Filters only narrow these rows.</p>}
    {tab === "shared" && !canPublish && <p className="text-sm text-brand-ink/65">Shared commands are read-only for this account. Add one to your own list to customise it.</p>}
    <div className="space-y-3">
      <Field label="Search phrases and titles" htmlFor="command-search"><TextInput id="command-search" type="search" value={query} disabled={pending} onChange={(event) => updateQuery("q", event.target.value)} placeholder="Find a phrase or command title" /></Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Command categories">
        <Button type="button" size="sm" variant={category === "" ? "primary" : "outline"} aria-pressed={category === ""} disabled={pending} onClick={() => { setCategory(""); setEditing(null); }}>All categories</Button>
        {COMMAND_CATEGORIES.map((entry) => <Button key={entry.id} type="button" size="sm" variant={category === entry.id ? "primary" : "outline"} aria-pressed={category === entry.id} disabled={pending} onClick={() => { setCategory(entry.id); setEditing(null); }}>{entry.label}</Button>)}
      </div>
    </div>
    {editing === null && <FormMessage error={refusal?.error} success={success} />}
    {editing === "new" && <Card className="p-5 sm:p-6">{editor()}</Card>}
    <ul aria-label="Voice commands" className="space-y-3">
      {visible.map((row) => <li key={row.id}><Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 flex-1 basis-56">
            <p className="break-words font-display text-xl font-semibold">“{row.triggerPhrase}”</p>
            <p className="mt-1 break-words text-sm text-brand-ink/65">{row.title}</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge>{row.rawCategory !== null ? "Uncategorised" : COMMAND_CATEGORIES.find((entry) => entry.id === row.category)?.label}</Badge><Badge tone="gold">{COMMAND_ACTION_TYPES.find((entry) => entry.id === row.action?.type)?.label ?? "Unreadable action"}</Badge></div>
            {row.problem && <p className="mt-3 text-sm text-rose-700">{row.problem === "category"
              ? `Uncategorised — this row names “${row.rawCategory}”, which this portal does not offer.`
              : row.problem === "action" ? "Switched off — this row's action cannot be read, so saying its phrase does nothing."
                : "Switched off — the stored phrase is not one this portal can match."}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" role="switch" aria-checked={row.enabled} aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.title}`} disabled={!editable || pending || (!row.enabled && !!row.problem)} onClick={() => run(() => setCommandEnabled(row.id, !row.enabled), row.enabled ? "Command disabled." : "Command enabled.", () => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, enabled: !row.enabled } : entry)))}>{row.enabled ? "Enabled" : "Disabled"}</Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`${editable ? "Edit" : "View"} ${row.title}`} aria-expanded={editing === row.id} aria-controls={`command-editor-${row.id}`} disabled={pending} onClick={() => { setEditing(editing === row.id ? null : row.id); setRefusal(null); }}>{editable ? "Edit" : "View"}</Button>
            {row.scope === "shared" && <Button type="button" size="sm" variant="outline" disabled={pending || !!initial.problem} onClick={() => run(() => adoptSharedCommand(row.id), "Command added to your list.", () => setEditing(null))}>Add to mine</Button>}
          </div>
        </div>
        {editing === row.id && <div id={`command-editor-${row.id}`} className="border-t border-brand-line bg-brand-cream/40 p-5">{editor(row)}</div>}
      </Card></li>)}
    </ul>
    {!initial.problem && visible.length === 0 && <p className="rounded-2xl border border-dashed border-brand-line p-8 text-center text-sm text-brand-ink/65">{scoped.length === 0 ? "No commands yet — add one and say its phrase after the wake word." : "No commands match these filters. Clear the search or choose another category."}</p>}
  </div>;
}

function CommandEditor({ command, tools, editable, pending, refusal, onRefusal, onClose, onSave, onDuplicate, onDelete }: {
  command?: VoiceCommand;
  tools: readonly CommandTool[];
  editable: boolean;
  pending: boolean;
  refusal: Refusal | null;
  onRefusal: (value: Refusal | null) => void;
  onClose: () => void;
  onSave: (draft: CommandDraft) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const action = command?.action;
  const [phrase, setPhrase] = useState(command?.triggerPhrase ?? "");
  const [title, setTitle] = useState(command?.title ?? "");
  const [category, setCategory] = useState<string>(command?.rawCategory ?? command?.category ?? "personal");
  const [type, setType] = useState<string>(command ? action?.type ?? "" : "ask");
  const [href, setHref] = useState(action?.type === "open" ? action.href : "");
  const [tool, setTool] = useState(action?.type === "tool" ? action.tool : "");
  const [args, setArgs] = useState(action?.type === "tool" ? JSON.stringify(action.args, null, 2) : "{}");
  const [prompt, setPrompt] = useState(action?.type === "ask" ? action.prompt ?? "" : "");
  const [line, setLine] = useState(action?.type === "note" ? action.text : "");
  const [notes, setNotes] = useState(command?.notes ?? "");
  const [confirming, setConfirming] = useState(false);
  const disabled = !editable || pending;
  const control = (field: keyof CommandDraft) => ({
    disabled, "aria-invalid": refusal?.field === field,
    "aria-describedby": refusal?.field === field ? "command-error" : undefined,
  });

  function submit() {
    if (disabled) return;
    let payload: Record<string, unknown> = {};
    if (type === "open") payload = { href };
    if (type === "ask") payload = { prompt };
    if (type === "note") payload = { text: line };
    if (type === "tool") {
      try { payload = { tool, args: JSON.parse(args) }; }
      catch { onRefusal({ field: "action_payload", error: "Enter valid JSON for the tool's named arguments." }); return; }
    }
    onSave({ ...(command ? { id: command.id } : {}), trigger_phrase: phrase, title, category, action_type: type, action_payload: payload, notes, enabled: command?.enabled ?? true });
  }

  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-display font-bold">{command ? editable ? "Edit command" : "Command details" : "New command"}</h3><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>Close</Button></div>
    {refusal && <p id="command-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{refusal.error}</p>}
    <Field label="Voice trigger phrase (what you speak)" htmlFor="command-trigger_phrase" required hint={`Say this after your wake word. ${phrase.length} / ${COMMAND_LIMITS.phraseMax}`}><TextInput id="command-trigger_phrase" {...control("trigger_phrase")} required minLength={COMMAND_LIMITS.phraseMin} maxLength={COMMAND_LIMITS.phraseMax} value={phrase} onChange={(event) => setPhrase(event.target.value)} /></Field>
    <Field label="Command label / title" htmlFor="command-title" required><TextInput id="command-title" {...control("title")} required maxLength={COMMAND_LIMITS.titleMax} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Category" htmlFor="command-category"><Select id="command-category" {...control("category")} value={category} onChange={(event) => setCategory(event.target.value)}>{command?.rawCategory !== null && command?.rawCategory !== undefined && <option value={command.rawCategory}>Uncategorised — {command.rawCategory}</option>}{COMMAND_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</Select></Field>
      <Field label="Action type" htmlFor="command-action_type"><Select id="command-action_type" {...control("action_type")} value={type} onChange={(event) => setType(event.target.value)}><option value="" disabled>Choose an action</option>{COMMAND_ACTION_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</Select></Field>
    </div>
    <p className="text-xs text-brand-ink/60">{COMMAND_ACTION_TYPES.find((entry) => entry.id === type)?.description}</p>
    {type === "open" && <Field label="Staff page" htmlFor="command-href" required><TextInput id="command-href" {...control("action_payload")} required list="command-pages" value={href} onChange={(event) => setHref(event.target.value)} placeholder="/reports" /><datalist id="command-pages">{NAV.map((page) => <option key={page.href} value={page.href}>{page.label}</option>)}</datalist></Field>}
    {type === "tool" && <>
      <Field label="Assistant tool" htmlFor="command-tool" required><Select id="command-tool" {...control("action_payload")} required value={tool} onChange={(event) => setTool(event.target.value)}><option value="">Choose a tool</option>{tool && !tools.some((entry) => entry.name === tool) && <option value={tool}>Unavailable — {tool}</option>}{tools.map((entry) => <option key={entry.name} value={entry.name}>{entry.label}</option>)}</Select></Field>
      <Field label="Tool arguments (JSON)" htmlFor="command-args" hint={'Named text, number or boolean values, for example {"stage":"APPLIED"}. Use {} for no arguments.'}><TextArea id="command-args" {...control("action_payload")} rows={4} value={args} onChange={(event) => setArgs(event.target.value)} className="font-mono" /></Field>
    </>}
    {type === "ask" && <Field label="Saved question (optional)" htmlFor="command-prompt"><TextArea id="command-prompt" {...control("action_payload")} rows={3} maxLength={COMMAND_LIMITS.promptMax} placeholder="Leave empty to ask whatever you say after the phrase." value={prompt} onChange={(event) => setPrompt(event.target.value)} /></Field>}
    {type === "note" && <Field label="Line to say" htmlFor="command-text" required hint={`${line.length} / ${COMMAND_LIMITS.noteTextMax}`}><TextInput id="command-text" {...control("action_payload")} required maxLength={COMMAND_LIMITS.noteTextMax} value={line} onChange={(event) => setLine(event.target.value)} /></Field>}
    <Field label="Description / notes" htmlFor="command-notes" hint={`${notes.length} / ${COMMAND_LIMITS.notesMax}`}><TextArea id="command-notes" {...control("notes")} rows={3} maxLength={COMMAND_LIMITS.notesMax} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    {editable && <div className="flex flex-wrap items-center gap-2 border-t border-brand-line pt-4">
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save command"}</Button>
      {command && <><Button type="button" variant="outline" disabled={pending} onClick={onDuplicate}>Duplicate</Button>
        {!confirming ? <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(true)}>Delete</Button> : <div className="flex flex-wrap items-center gap-2"><span className="text-xs">Delete this command?</span><Button type="button" variant="outline" disabled={pending} onClick={onDelete}>Delete command</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Keep command</Button></div>}</>}
    </div>}
  </form>;
}
