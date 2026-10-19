"use client";

import { useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Check,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  deleteNotificationTemplate,
  resetNotificationTemplate,
  saveNotificationTemplate,
} from "@/app/(admin)/settings/actions";
import { Badge, Button, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_PREVIEW_VARS,
  TEMPLATE_PURPOSE,
  TEMPLATE_TOKENS,
  renderTemplate,
  shippedTemplate,
  templateIsWired,
} from "@/modules/settings/domain/templates";
import {
  TEMPLATES_CONSOLE_TABS,
  TEMPLATES_TAB_IDS,
  templatesTab,
  type TemplatesTabId,
} from "@/modules/settings/domain/settingsNav";
import type { NotificationTemplate } from "@/modules/settings/domain/types";

/** Typed by the shared tab table, so a tab added there has to be given an icon here. */
const TAB_ICONS: Record<TemplatesTabId, LucideIcon> = {
  whatsapp: MessageCircle,
  email: Mail,
  portal: Inbox,
};

function Editor({
  template,
  editable,
  onDeleted,
}: {
  template: NotificationTemplate;
  editable: boolean;
  onDeleted: (id: string) => void;
}) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [active, setActive] = useState(template.is_active);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  const wired = templateIsWired(template);
  const shipped = shippedTemplate(template.key, template.channel);
  const dirty =
    subject !== (template.subject ?? "") || body !== template.body || active !== template.is_active;

  const preview = renderTemplate(body || "—", TEMPLATE_PREVIEW_VARS);

  const stamp = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveNotificationTemplate({
        id: template.id,
        subject: template.channel === "EMAIL" ? subject : null,
        body,
        is_active: active,
      });
      if (result.ok) {
        setSavedAt(stamp());
      } else {
        setError(result.error ?? "Could not save this template.");
      }
    });
  }

  function reset() {
    setError(null);
    startTransition(async () => {
      const result = await resetNotificationTemplate({ id: template.id });
      if (!result.ok) {
        setError(result.error ?? "Could not restore this template.");
      } else if (shipped) {
        // The boxes are the recruiter's source of truth between saves, so a
        // reset has to land in them as well as in the row.
        setSubject(shipped.subject);
        setBody(shipped.body);
        setActive(true);
        setConfirming(null);
        setSavedAt(stamp());
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteNotificationTemplate({ id: template.id });
      if (result.ok) {
        onDeleted(template.id);
      } else {
        setError(result.error ?? "Could not delete this template.");
      }
      setConfirming(null);
    });
  }

  const deleteNote = !wired
    ? "Nothing sends this key, so deleting it changes no message a candidate receives."
    : shipped
      ? "The next message on this channel is sent using the copy shipped in code — the wording below goes back to how the platform writes it."
      : "No copy is shipped for this key, so the next message falls back to the generic status-update line.";

  return (
    <li className="rounded-xl border border-brand-line bg-brand-cream p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold">{template.key}</p>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            {TEMPLATE_PURPOSE[template.key] ?? "No flow reads this key yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={template.channel === "EMAIL" ? "info" : "gold"}>{template.channel}</Badge>
          {!wired && <Badge tone="neutral">Not sent yet</Badge>}
          {!active && <Badge tone="danger">Disabled</Badge>}
        </div>
      </div>

      {template.channel === "EMAIL" && (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
            Subject
          </span>
          <input
            value={subject}
            disabled={!editable}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm focus:border-brand-gold focus:outline-none disabled:opacity-60"
          />
        </label>
      )}

      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">
          Copy
        </span>
        <textarea
          value={body}
          rows={body.length > 220 ? 5 : 3}
          disabled={!editable}
          onChange={(event) => setBody(event.target.value)}
          className="w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm leading-relaxed focus:border-brand-gold focus:outline-none disabled:opacity-60"
        />
      </label>

      <div className="mt-3 rounded-xl border border-brand-line bg-white px-3 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/45">
          Preview with sample values
        </p>
        <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-brand-ink/70">{preview}</p>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={`Send the ${template.key} template`}
          disabled={!editable}
          onClick={() => setActive((current) => !current)}
          className="flex items-center gap-2 text-xs font-semibold text-brand-ink/65 disabled:opacity-60"
        >
          <span
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition",
              active ? "bg-brand-gold" : "bg-brand-line"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                active ? "left-[18px]" : "left-0.5"
              )}
            />
          </span>
          {active ? "Active" : "Inactive — dispatch skips it"}
        </button>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-brand-ink/45" aria-live="polite">
            {pending ? "Saving…" : savedAt && !dirty ? `Saved at ${savedAt}` : dirty ? "Unsaved" : ""}
          </span>
          <Button size="sm" onClick={save} disabled={!editable || !dirty || pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : savedAt && !dirty ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : null}
            Save
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-brand-line pt-3">
        {confirming === "delete" ? (
          <div className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-rose-800">{deleteNote}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={remove}
                className="bg-rose-700 text-brand-on-accent hover:bg-rose-800"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete template
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : confirming === "reset" ? (
          <div className="w-full rounded-xl border border-brand-line bg-white px-3 py-2.5">
            <p className="text-xs leading-relaxed text-brand-ink/65">
              Replaces the copy in this row with the wording the platform ships
              {dirty ? ", including any edit you have not saved yet" : ""}, and switches the row back
              on.
            </p>
            <p className="mt-1.5 whitespace-pre-line rounded-lg bg-brand-cream px-2.5 py-2 text-[11px] leading-relaxed text-brand-ink/70">
              {shipped?.body}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Restore shipped copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {shipped && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirming("reset");
                }}
                disabled={!editable || pending}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink/55 hover:text-brand-ink disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset to shipped copy
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirming("delete");
              }}
              disabled={!editable || pending}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-700/80 hover:text-rose-700 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete template
            </button>
            {!shipped && (
              <span className="text-[11px] text-brand-ink/40">
                No copy is shipped for this key, so there is nothing here to reset it to.
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Notification template editor. Rows are read at send time by the dispatch
 * paths — `resolveTemplate` in whatsapp-dispatch.ts for WhatsApp and
 * `resolveEmailCopy` in candidate-notifications.ts for email.
 *
 * The channel tab strip is drawn from the shared table in `settingsNav`, so a tab
 * is a view the assistant can link to and a link the assistant writes is a tab
 * that exists — which matters because a row's channel is the only thing that says
 * where to find it.
 */
export function TemplatesConsole({
  templates,
  editable,
}: {
  templates: NotificationTemplate[];
  editable: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [deleted, setDeleted] = useState<string[]>([]);

  /**
   * The channel tab is read from `?tab=` and written back when a tab is clicked,
   * so an answer about an email template links to the Email tab rather than to
   * whichever tab the page happens to open on. Typing here is impossible, but the
   * same route reached again re-renders rather than remounts, so the last value
   * taken from the address bar is tracked and applied the way the list pages do.
   */
  const incomingTab = templatesTab(params.get("tab"));
  const [tab, setTab] = useState<TemplatesTabId>(incomingTab);
  const [lastAppliedTab, setLastAppliedTab] = useState(incomingTab);
  if (incomingTab !== lastAppliedTab) {
    setLastAppliedTab(incomingTab);
    setTab(incomingTab);
  }

  // The row is dropped locally as well as server-side, because a revalidated
  // payload can arrive a navigation later under partial prefetching — and a
  // template that is still on screen after "Deleted" reads like a lie.
  const rows = templates.filter((template) => !deleted.includes(template.id));

  /**
   * One tab per channel, in the shared table's order, each listing the rows whose
   * channel matches. Portal notices are the exception: no flow reads an `IN_APP`
   * row today, so an empty tab would advertise a channel nobody uses — it appears
   * when such a row exists, or when the address bar asks for it, because a link
   * about a portal notice that opened on the WhatsApp tab would be the lie in the
   * other direction.
   */
  const tabs = TEMPLATES_TAB_IDS.map((key) => ({
    key,
    label: TEMPLATES_CONSOLE_TABS[key].label,
    icon: TAB_ICONS[key],
    rows: rows.filter((t) => t.channel === TEMPLATES_CONSOLE_TABS[key].channel),
  })).filter((option) => option.key !== "portal" || option.rows.length > 0 || incomingTab === "portal");

  function openTab(next: TemplatesTabId) {
    setTab(next);
    const search = new URLSearchParams(window.location.search);
    search.set("tab", next);
    window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
  }

  return (
    <Card className="p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg font-bold">Notification templates</h2>
        <p className="mt-1 text-sm text-brand-ink/60">
          Every row below is live copy: each alert looks its row up at send time, so a save here
          changes the next message. WhatsApp rows go to the candidate&apos;s phone, Email rows are
          sent as letters with their subject line, and the portal notice shows the same email copy
          when a channel cannot deliver. A stage or interview event with no stored row is sent using
          the copy shipped in code.
        </p>
      </header>

      <div className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink/50">Placeholders</p>
        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {TEMPLATE_TOKENS.map((token) => (
            <li key={token.token} className="text-xs text-brand-ink/65">
              <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">{token.token}</code>{" "}
              {token.renders}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/50">
          A token the platform cannot fill is left visible in the preview instead of being dropped, so a
          typo shows up here rather than on the candidate&apos;s phone.
        </p>
      </div>

      {!editable && (
        <p className="mb-4 rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
          You can read every template; saving requires the
          <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">settings.manage_platform</code>
          permission.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Template channels">
        {tabs.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            id={`templates-tab-${option.key}`}
            aria-selected={tab === option.key}
            aria-controls={`templates-panel-${option.key}`}
            onClick={() => openTab(option.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
              tab === option.key
                ? "bg-brand-ink text-brand-cream shadow-soft"
                : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
            )}
          >
            <option.icon className="h-4 w-4" aria-hidden />
            {`${option.label} (${option.rows.length})`}
          </button>
        ))}
      </div>

      {tabs.map((option) => (
        <div
          key={option.key}
          role="tabpanel"
          id={`templates-panel-${option.key}`}
          aria-labelledby={`templates-tab-${option.key}`}
          className={cn("mt-4", tab !== option.key && "hidden")}
        >
          {option.rows.length === 0 ? (
            <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
              No {option.label.toLowerCase()} templates are stored yet, so every message on this
              channel is sent using the copy shipped in code.
            </p>
          ) : (
            <ul className="space-y-3">
              {option.rows.map((template) => (
                <Editor
                  key={template.id}
                  template={template}
                  editable={editable}
                  onDeleted={(id) => setDeleted((current) => [...current, id])}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </Card>
  );
}
