"use client";

import { useState } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import { sendBulkEmail, sendBulkWhatsApp } from "./candidate-actions";
import type { CandidateRow } from "./actions";

/* The bulk composer the candidates toolbar opens — see ./CandidateBrowser.tsx.
   A selection of rows becomes one message on one or both channels. */

type BroadcastChannel = "WHATSAPP" | "EMAIL" | "BOTH";

/**
 * Draft copy for the bulk composer. `body` is sent on whichever channel the
 * recruiter picks; `subject` only matters for email, which cannot be delivered
 * without one.
 */
const TEMPLATES = [
  {
    id: "STATUS_UPDATE",
    label: "Status update",
    subject: "Your application for {{job_title}}",
    body: "Hi {{candidate_name}}, your application for {{job_title}} is now at the {{stage}} stage. We will be in touch with the next steps.",
  },
  {
    id: "INTERVIEW_INVITE",
    label: "Interview invitation",
    subject: "Interview for {{job_title}}",
    body: "Hi {{candidate_name}}, we would like to invite you to interview for {{job_title}}. Please reply with two times that suit you this week.",
  },
  {
    id: "ASSESSMENT_REMINDER",
    label: "Assessment reminder",
    subject: "Your {{job_title}} assessment is still open",
    body: "Hi {{candidate_name}}, a reminder that your assessment for {{job_title}} is still open: {{assessment_link}}",
  },
];

const CHANNEL_CHOICES: { id: BroadcastChannel; label: string; blurb: string }[] = [
  { id: "WHATSAPP", label: "WhatsApp", blurb: "Chat message to the number on file." },
  { id: "EMAIL", label: "Email", blurb: "Letter through the SMTP relay in Settings → API keys." },
  { id: "BOTH", label: "Both", blurb: "Each candidate gets whichever of the two they have." },
];

export function BroadcastDrawer({
  open,
  recipients,
  onClose,
  onSent,
}: {
  open: boolean;
  recipients: CandidateRow[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [body, setBody] = useState(TEMPLATES[0].body);
  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [channel, setChannel] = useState<BroadcastChannel>("WHATSAPP");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const needsSubject = channel !== "WHATSAPP";
  const withoutEmail = recipients.filter((r) => !r.email).length;
  const withoutPhone = recipients.filter((r) => !r.phone).length;

  function pickTemplate(id: string) {
    const found = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
    setTemplate(found.id);
    setBody(found.body);
    setSubject(found.subject);
    if (error) setError(null);
  }

  async function send() {
    if (recipients.length === 0) {
      setError("Select at least one candidate first.");
      return;
    }
    if (!body.trim()) {
      setError("The message cannot be empty.");
      return;
    }
    if (needsSubject && !subject.trim()) {
      setError("Email needs a subject line.");
      return;
    }

    setPending(true);
    setError(null);
    setDone(null);
    const ids = recipients.map((r) => r.id);
    const delivered: string[] = [];
    let problem: string | null = null;

    try {
      if (channel !== "EMAIL") {
        const whatsapp = await sendBulkWhatsApp({
          applicationIds: ids,
          templateKey: template,
          message: body,
        });
        if (whatsapp.ok) delivered.push(`WhatsApp queued for ${whatsapp.queued ?? 0}`);
        else problem = whatsapp.error ?? "Could not send the WhatsApp batch.";
      }

      if (channel !== "WHATSAPP") {
        const email = await sendBulkEmail({
          applicationIds: ids,
          subject,
          message: body,
        });
        if (email.ok) {
          delivered.push(
            `email delivered to ${email.sent ?? 0}${email.failed ? `, rejected for ${email.failed}` : ""}`
          );
        } else {
          problem = [problem, email.error].filter(Boolean).join(" ");
        }
      }

      if (delivered.length > 0) {
        setDone(`Sent — ${delivered.join(" and ")}.`);
        setTimeout(() => {
          setDone(null);
          onSent();
          onClose();
        }, 2600);
      } else {
        setError(problem ?? "Nothing was sent.");
        setPending(false);
        return;
      }
    } catch {
      setError("Something went wrong sending the broadcast.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Messaging"
      title="Bulk message"
      subtitle={`${recipients.length} recipient${recipients.length === 1 ? "" : "s"} selected`}
      onSubmit={send}
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={`Send to ${recipients.length}`}
          pending={pending}
          note="Placeholders are filled per candidate."
        />
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
            Channel
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHANNEL_CHOICES.map((choice) => (
              <label
                key={choice.id}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition ${
                  channel === choice.id
                    ? "border-brand-gold bg-brand-gold/10 font-semibold"
                    : "border-brand-line bg-white hover:bg-brand-cream"
                }`}
              >
                <input
                  type="radio"
                  name="broadcast-channel"
                  value={choice.id}
                  checked={channel === choice.id}
                  onChange={() => setChannel(choice.id)}
                  className="sr-only"
                />
                {choice.label}
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-brand-ink/55">
                  {choice.blurb}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Template" htmlFor="wa-template">
          <Select id="wa-template" value={template} onChange={(e) => pickTemplate(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        {needsSubject && (
          <Field
            label="Subject"
            htmlFor="bulk-subject"
            required
            hint="{{job_title}} and {{candidate_name}} are replaced per recipient."
          >
            <TextInput id="bulk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}

        <Field
          label="Message"
          htmlFor="wa-body"
          required
          hint="{{candidate_name}}, {{job_title}}, {{stage}} and {{assessment_link}} are replaced per recipient."
        >
          <TextArea id="wa-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <div className="rounded-xl bg-brand-cream p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Recipients
          </p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-sm text-brand-ink/70">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{r.full_name}</span>
                {channel !== "EMAIL" && !r.phone && (
                  <span className="shrink-0 text-[11px] text-rose-600">no number</span>
                )}
                {channel !== "WHATSAPP" && !r.email && (
                  <span className="shrink-0 text-[11px] text-rose-600">no email</span>
                )}
              </li>
            ))}
          </ul>
          {(withoutEmail > 0 || withoutPhone > 0) && channel === "BOTH" && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
              {withoutPhone > 0 && `${withoutPhone} without a number `}
              {withoutPhone > 0 && withoutEmail > 0 && "and "}
              {withoutEmail > 0 && `${withoutEmail} without an email `}
              will be skipped on that channel.
            </p>
          )}
          {channel !== "WHATSAPP" && recipients.length > 40 && (
            <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
              Email is handed to the relay one message at a time, so this batch will take a minute or
              two. Gmail accounts also cap out near 500 recipients a day.
            </p>
          )}
        </div>

        <FormMessage error={error} success={done} />
      </div>
    </Drawer>
  );
}
