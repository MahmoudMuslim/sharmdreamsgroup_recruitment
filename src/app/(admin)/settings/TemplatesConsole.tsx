"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { saveNotificationTemplate } from "@/app/(admin)/settings/actions";
import { Badge, Button, Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_PREVIEW_VARS,
  TEMPLATE_PURPOSE,
  TEMPLATE_TOKENS,
  renderTemplate,
  templateIsWired,
} from "@/modules/settings/domain/templates";
import type { NotificationTemplate } from "@/modules/settings/domain/types";

function Editor({
  template,
  editable,
}: {
  template: NotificationTemplate;
  editable: boolean;
}) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [active, setActive] = useState(template.is_active);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const wired = templateIsWired(template);
  const dirty =
    subject !== (template.subject ?? "") || body !== template.body || active !== template.is_active;

  const preview = renderTemplate(body || "—", TEMPLATE_PREVIEW_VARS);

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
        setSavedAt(
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        );
      } else {
        setError(result.error ?? "Could not save this template.");
      }
    });
  }

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
    </li>
  );
}

/**
 * Notification template editor. Rows are read at send time by the dispatch
 * paths — `resolveTemplate` in whatsapp-dispatch.ts for WhatsApp and
 * `resolveEmailCopy` in candidate-notifications.ts for email.
 */
export function TemplatesConsole({
  templates,
  editable,
}: {
  templates: NotificationTemplate[];
  editable: boolean;
}) {
  const whatsapp = templates.filter((template) => template.channel === "WHATSAPP");
  const email = templates.filter((template) => template.channel !== "WHATSAPP");

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

      {whatsapp.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-base font-bold">WhatsApp</h3>
          <ul className="space-y-3">
            {whatsapp.map((template) => (
              <Editor key={template.id} template={template} editable={editable} />
            ))}
          </ul>
        </section>
      )}

      {email.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 font-display text-base font-bold">Email</h3>
          <ul className="space-y-3">
            {email.map((template) => (
              <Editor key={template.id} template={template} editable={editable} />
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
