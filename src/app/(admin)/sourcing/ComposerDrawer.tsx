"use client";

import { useState, useTransition } from "react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  TextArea,
  TextInput
} from "@/modules/analytics/presentation/Form";
import { isHireable, openingOptionLabel } from "@/modules/jobs/domain/hireable";
import { cn } from "@/lib/utils";
import {
  sendProspectOutreach,
  type OutreachChannel,
  type ProspectRow
} from "./actions";

/* -------------------------------------------------------------------------- */

export function ComposerDrawer({
  rows,
  copy,
  onClose,
  onSent,
}: {
  rows: ProspectRow[];
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  onClose: () => void;
  onSent: (summary: string) => void;
}) {
  const [channel, setChannel] = useState<OutreachChannel>(rows.some((r) => r.email) ? "EMAIL" : "WHATSAPP");
  const [subject, setSubject] = useState(copy.EMAIL.subject);
  const [body, setBody] = useState(copy[channel].body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reachable = rows.filter((row) => (channel === "EMAIL" ? row.email : row.phone)).length;

  // A prospect can be linked to an opening that closed after the link was made,
  // and the letter quotes that opening by name. Nothing here can refile the
  // person — that is the edit drawer's job — so the composer says what it knows.
  const closedRoles = Array.from(
    new Set(
      rows
        .filter((row) => row.job_id && row.job_status && !isHireable(row.job_status))
        .map((row) => openingOptionLabel(row.job_title ?? "an unnamed opening", row.job_status ?? ""))
    )
  );
  const closedCount = rows.filter(
    (row) => row.job_id && row.job_status && !isHireable(row.job_status)
  ).length;

  function pickChannel(next: OutreachChannel) {
    setChannel(next);
    setBody(next === "EMAIL" ? copy.EMAIL.body : copy.WHATSAPP.body);
    setError(null);
  }

  function send() {
    if (!body.trim()) {
      setError("The message cannot be empty.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const outcome = await sendProspectOutreach({
        ids: rows.map((row) => row.id),
        channel,
        subject: channel === "EMAIL" ? subject : undefined,
        body,
      });
      if (!outcome.ok) {
        setError(outcome.error ?? "Nothing was sent.");
        return;
      }
      const summary = `Sent to ${outcome.sent}${outcome.failed ? `, refused by the relay for ${outcome.failed}` : ""}${
        outcome.skipped ? `, ${outcome.skipped} without a ${channel === "EMAIL" ? "email" : "phone"} on file` : ""
      }.`;
      onSent(summary);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="First touch"
      title={`Message ${rows.length} prospect${rows.length > 1 ? "s" : ""}`}
      subtitle="Placeholders are replaced per person, so each message names them and the role."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Sending…" : `Send on ${channel === "EMAIL" ? "email" : "WhatsApp"}`}
          pending={pending}
          disabled={reachable === 0}
          note={`${reachable} of ${rows.length} can be reached on this channel.`}
        />
      }
      onSubmit={send}
    >
      <div className="flex gap-2">
        {(["EMAIL", "WHATSAPP"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => pickChannel(option)}
            aria-pressed={channel === option}
            className={cn(
              "flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition",
              channel === option
                ? "border-brand-ink bg-brand-ink text-brand-cream"
                : "border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
            )}
          >
            {option === "EMAIL" ? "Email" : "WhatsApp"}
          </button>
        ))}
      </div>

      {closedCount > 0 && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          {closedCount} of {rows.length} {rows.length === 1 ? "prospect" : "prospects"} here{" "}
          {closedCount === 1 ? "is" : "are"} linked to a role the group stopped hiring for:{" "}
          {closedRoles.map((role, index) => (
            <span key={role}>
              {index > 0 && ", "}“{role}”
            </span>
          ))}
          . The copy below still quotes {closedRoles.length === 1 ? "it" : "them"} by name, so
          reopen {closedRoles.length === 1 ? "that opening" : "those openings"} from Jobs, change
          the letter, or move these prospects off {closedRoles.length === 1 ? "it" : "them"} before
          sending.
        </p>
      )}

      {channel === "EMAIL" && (
        <Field label="Subject" htmlFor="composer-subject" className="mt-4">
          <TextInput id="composer-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
      )}

      <Field
        label="Message"
        htmlFor="composer-body"
        hint="{{candidate_name}} · {{job_title}} · {{company_name}} — edit freely, what you see is what is sent."
        className="mt-4"
      >
        <TextArea
          id="composer-body"
          rows={channel === "EMAIL" ? 10 : 6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>

      <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
        The copy starts from Settings → Access &amp; comms → Templates, so a recruiter can change the
        first-touch letter once and have it apply to every import.
      </p>

      <FormMessage error={error} />
    </Drawer>
  );
}
