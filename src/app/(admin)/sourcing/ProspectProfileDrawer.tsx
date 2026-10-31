"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ArrowRightLeft,
  ExternalLink,
  Mail,
  MessageCircle,
  Pencil,
  Send
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  Field,
  FormMessage,
  Select
} from "@/modules/analytics/presentation/Form";
import {
  Badge,
  Button
} from "@/modules/analytics/presentation/ui";
import { openingOptionLabel, pickerWindowNote } from "@/modules/jobs/domain/hireable";
import { cn } from "@/lib/utils";
import {
  stageWord
} from "./pool-model";
import {
  convertProspect,
  getProspectHistory,
  type JobOption,
  type OutreachChannel,
  type ProspectHistoryRow,
  type ProspectRow
} from "./actions";
import { ProfilePanel } from "./ProfilePanel";
import { type ContactField, originLabel, reachDoor } from "./SourcingBits";

/* -------------------------------------------------------------------------- */

export function ProfileDrawer({
  prospect,
  jobs,
  jobsTotal,
  copy,
  canWrite,
  canSend,
  onClose,
  onChanged,
  onCompose,
  onEdit,
}: {
  prospect: ProspectRow;
  jobs: JobOption[];
  jobsTotal: number;
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  canWrite: boolean;
  canSend: boolean;
  onClose: () => void;
  onChanged: () => void;
  onCompose: () => void;
  /** Opens the record editor; pass the field when a reach door needs an address. */
  onEdit: (field?: ContactField) => void;
}) {
  const [history, setHistory] = useState<ProspectHistoryRow[] | null>(null);
  // Pre-select the role this prospect is already linked to, but only when that
  // opening is on the list: a link to a closed role is not a conversion target,
  // and pre-filling one would leave the field blank beside a live Convert button.
  const [jobId, setJobId] = useState(
    prospect.job_id && jobs.some((job) => job.id === prospect.job_id) ? prospect.job_id : ""
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getProspectHistory(prospect.id).then((rows) => {
      if (active) setHistory(rows);
    });
    return () => {
      active = false;
    };
  }, [prospect.id, prospect.last_contacted_at]);

  function convert() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await convertProspect({ id: prospect.id, job_id: jobId });
      if (!result.ok) {
        setError(result.error ?? "That could not be converted.");
        return;
      }
      setNotice("They are on the Candidates board now, sourced as LinkedIn.");
      onChanged();
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={stageWord(prospect.stage)}
      title={prospect.full_name}
      subtitle={[prospect.headline, prospect.company, prospect.location].filter(Boolean).join(" · ")}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {prospect.linkedin_url && (
            <a
              href={prospect.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3.5 py-2 text-sm font-semibold hover:bg-brand-sand"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open on LinkedIn
            </a>
          )}
          {(["EMAIL", "WHATSAPP"] as const).map((channel) => {
            const door = reachDoor(prospect, channel, copy);
            const Icon = channel === "EMAIL" ? Mail : MessageCircle;
            const label = channel === "EMAIL" ? "Email" : "WhatsApp";
            const chrome =
              "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition";

            if (door.href) {
              return (
                <a
                  key={channel}
                  href={door.href}
                  target={channel === "WHATSAPP" ? "_blank" : undefined}
                  rel={channel === "WHATSAPP" ? "noopener noreferrer" : undefined}
                  title={`Opens the first-touch letter to ${door.address} in your own ${channel === "EMAIL" ? "mail" : "WhatsApp"} app`}
                  className={cn(chrome, "border-brand-line bg-white hover:bg-brand-sand")}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  Reach by {label}
                </a>
              );
            }

            if (!canWrite) {
              return (
                <span
                  key={channel}
                  title={`No ${door.field} on file for this prospect, and this account cannot add one`}
                  className={cn(chrome, "border-dashed border-brand-line bg-white text-brand-ink/35")}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  Reach by {label}
                </span>
              );
            }

            return (
              <button
                key={channel}
                type="button"
                onClick={() => onEdit(door.field)}
                title={`No ${door.field} on file — add one and this door opens the letter`}
                className={cn(
                  chrome,
                  "border-dashed border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                Reach by {label}
              </button>
            );
          })}
          {canSend && (
            <Button size="sm" className="ml-auto" onClick={onCompose}>
              <Send className="h-4 w-4" aria-hidden />
              Message from here
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Detail label="Email" value={prospect.email} href={prospect.email ? `mailto:${prospect.email}` : undefined} />
        <Detail label="Phone" value={prospect.phone} href={prospect.phone ? `tel:${prospect.phone}` : undefined} />
        <Detail label="Linked opening" value={prospect.job_title} />
        <Detail label="Loaded" value={new Date(prospect.created_at).toLocaleDateString()} />
        <Detail label="Source of the record" value={originLabel(prospect.origin)} />
        <Detail
          label="Last touch"
          value={
            prospect.last_contacted_at
              ? new Date(prospect.last_contacted_at).toLocaleString()
              : "Never contacted"
          }
        />
      </dl>

      {prospect.notes && (
        <p className="mt-4 whitespace-pre-line rounded-xl border border-brand-line bg-brand-cream/60 p-3.5 text-sm leading-relaxed text-brand-ink/70">
          {prospect.notes}
        </p>
      )}

      <ProfilePanel prospect={prospect} canWrite={canWrite} />

      {canWrite && (
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-brand-line pt-4">
          <Field
            label="Convert to an application"
            htmlFor="convert-job"
            className="min-w-[200px] flex-1"
            hint={pickerWindowNote(jobsTotal, jobs.length) ?? undefined}
          >
            <Select id="convert-job" value={jobId} onChange={(event) => setJobId(event.target.value)}>
              <option value="">Choose an opening…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {openingOptionLabel(job.title, job.status)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={convert}
            disabled={!jobId || pending || Boolean(prospect.application_id) || !prospect.email}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            {prospect.application_id ? "Already converted" : "Convert"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit()}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </Button>
        </div>
      )}

      {prospect.email === null && !prospect.application_id && (
        <p className="mt-2 text-[11px] text-brand-ink/45">
          Conversion needs an email address — an application cannot exist without one.
        </p>
      )}

      <FormMessage error={error} success={notice} />

      <section className="mt-5 border-t border-brand-line pt-4">
        <h3 className="font-display text-sm font-bold">What we have sent</h3>
        {!history ? (
          <p className="mt-2 text-xs text-brand-ink/45">Loading…</p>
        ) : history.length === 0 ? (
          <p className="mt-2 text-xs text-brand-ink/55">
            Nothing yet. Every message you send from here is recorded, delivered or refused.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.map((row) => (
              <li key={row.id} className="rounded-xl border border-brand-line bg-white p-3.5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-brand-ink/45">
                  <Badge tone={row.channel === "EMAIL" ? "info" : "success"}>{row.channel}</Badge>
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                  <span className="ml-auto">
                    {row.delivered ? "Delivered" : "Refused"}
                  </span>
                </div>
                {row.subject && <p className="mt-2 text-sm font-semibold">{row.subject}</p>}
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-brand-ink/65">
                  {row.body}
                </p>
                {row.error_message && (
                  <p className="mt-2 text-[11px] text-rose-700">{row.error_message}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}

function Detail({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/40">{label}</dt>
      <dd className="truncate text-sm">
        {value ? (
          href ? (
            <a href={href} className="text-brand-gold-dark hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-brand-ink/35">—</span>
        )}
      </dd>
    </div>
  );
}
