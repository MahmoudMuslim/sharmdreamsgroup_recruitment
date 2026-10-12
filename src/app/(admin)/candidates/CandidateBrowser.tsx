"use client";

import { useMemo, useState } from "react";
import { FileText, Search, Send } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
} from "@/modules/analytics/presentation/Form";
import { Badge, Card, EmptyState, Meter } from "@/modules/analytics/presentation/ui";
import { sendBulkWhatsApp } from "./candidate-actions";
import type { CandidateRow } from "./actions";
import type { SoftSkillReport } from "@/types";

function stageTone(stage: string) {
  if (stage === "HIRED") return "success" as const;
  if (stage === "REJECTED") return "danger" as const;
  if (stage === "OFFER" || stage === "INTERVIEW") return "gold" as const;
  return "info" as const;
}

const STAGES = ["NEW", "AI_SCREENING", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];

const TEMPLATES = [
  {
    id: "STATUS_UPDATE",
    label: "Status update",
    body: "Hi {{candidate_name}}, your application for {{job_title}} is now at the {{stage}} stage. We will be in touch with the next steps.",
  },
  {
    id: "INTERVIEW_INVITE",
    label: "Interview invitation",
    body: "Hi {{candidate_name}}, we would like to invite you to interview for {{job_title}}. Please reply with two times that suit you this week.",
  },
  {
    id: "ASSESSMENT_REMINDER",
    label: "Assessment reminder",
    body: "Hi {{candidate_name}}, a reminder that your assessment for {{job_title}} is still open: {{assessment_link}}",
  },
];

function SoftSkillBars({ report }: { report: SoftSkillReport }) {
  const rows = [
    ["Emotional intelligence", report.emotional_intelligence],
    ["Communication", report.communication],
    ["Leadership potential", report.leadership_potential],
    ["Cultural fit", report.cultural_fit],
  ] as const;

  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-xs text-brand-ink/60">{label}</span>
          <Meter value={value} className="flex-1" />
          <span className="w-8 text-right text-xs font-bold">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Candidate table with working search, selection and profile view.
 *
 * Replaces the previous read-only server table: the "View", "Search" and
 * "Bulk WhatsApp" buttons were all inert. Search filters live, selection drives
 * the broadcast, and the profile drawer shows the real AI screening output.
 */
export function CandidateBrowser({ candidates }: { candidates: CandidateRow[] }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<CandidateRow | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (stageFilter && c.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.job_title ?? "").toLowerCase().includes(q) ||
        c.tracking_code.toLowerCase().includes(q)
      );
    });
  }, [candidates, query, stageFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((c) => c.id)));

  if (candidates.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No applications yet"
          description="New submissions appear here automatically, ranked by AI match score."
        />
      </Card>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
            aria-hidden
          />
          <input
            id="candidate-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, role or tracking code"
            aria-label="Search candidates"
            className="w-full rounded-xl border border-brand-line bg-white py-2.5 pl-10 pr-3 text-sm focus:border-brand-gold focus:outline-none"
          />
        </div>

        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          aria-label="Filter by stage"
          className="rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm focus:border-brand-gold focus:outline-none"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>

        <span className="text-xs text-brand-ink/50">
          {filtered.length} of {candidates.length}
        </span>

        <button
          type="button"
          onClick={() => setBroadcastOpen(true)}
          disabled={selected.size === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-sm font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden />
          Bulk WhatsApp{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No matches"
            description="Adjust the search or stage filter to see candidates again."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      aria-label="Select all visible candidates"
                      className="h-4 w-4 rounded border-brand-line"
                    />
                  </th>
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">AI match</th>
                  <th className="px-4 py-3 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition hover:bg-brand-cream">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.full_name}`}
                        className="h-4 w-4 rounded border-brand-line"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold">{c.full_name}</p>
                      <p className="text-xs text-brand-ink/50">{c.email}</p>
                    </td>
                    <td className="px-4 py-4 text-brand-ink/65">{c.job_title ?? "—"}</td>
                    <td className="px-4 py-4 font-mono text-xs text-brand-ink/45">
                      {c.tracking_code}
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-4">
                      {c.ai_match_score !== null ? (
                        <div className="flex w-32 items-center gap-2">
                          <span className="w-9 text-right font-display font-bold text-brand-gold-dark">
                            {c.ai_match_score}%
                          </span>
                          <Meter value={c.ai_match_score} className="flex-1" />
                        </div>
                      ) : (
                        <span className="text-xs text-brand-ink/35">Not screened</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setProfile(c)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tablet + mobile cards */}
          <ul className="divide-y divide-brand-line lg:hidden">
            {filtered.map((c) => (
              <li key={c.id} className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.full_name}`}
                      className="mt-1 h-4 w-4 rounded border-brand-line"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.full_name}</span>
                      <span className="block truncate text-xs text-brand-ink/55">{c.email}</span>
                    </span>
                  </label>
                  <Badge tone={stageTone(c.stage)}>{c.stage.replace("_", " ")}</Badge>
                </div>

                <p className="truncate text-sm text-brand-ink/65">{c.job_title ?? "—"}</p>

                <div className="flex items-center gap-2">
                  <span className="w-10 text-right text-sm font-display font-bold text-brand-gold-dark">
                    {c.ai_match_score !== null ? `${c.ai_match_score}%` : "—"}
                  </span>
                  <Meter value={c.ai_match_score ?? 0} className="flex-1" />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-brand-ink/40">{c.tracking_code}</span>
                  <button
                    type="button"
                    onClick={() => setProfile(c)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-xs font-semibold transition hover:bg-brand-sand"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    View profile
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ProfileDrawer candidate={profile} onClose={() => setProfile(null)} />

      <BroadcastDrawer
        open={broadcastOpen}
        recipients={candidates.filter((c) => selected.has(c.id))}
        onClose={() => setBroadcastOpen(false)}
        onSent={() => setSelected(new Set())}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ProfileDrawer({
  candidate,
  onClose,
}: {
  candidate: CandidateRow | null;
  onClose: () => void;
}) {
  const report = candidate?.ai_soft_skills as SoftSkillReport | null;
  const strengths = candidate?.ai_strengths ?? [];
  const gaps = candidate?.ai_gaps ?? [];

  return (
    <Drawer
      open={candidate !== null}
      onClose={onClose}
      width="max-w-lg"
      eyebrow={candidate?.tracking_code}
      title={candidate?.full_name ?? ""}
      subtitle={candidate?.email}
    >
      {candidate && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(candidate.stage)}>{candidate.stage.replace("_", " ")}</Badge>
            {candidate.job_title && <Badge tone="neutral">{candidate.job_title}</Badge>}
            {candidate.phone && <Badge tone="neutral">{candidate.phone}</Badge>}
          </div>

          <section>
            <h3 className="mb-2 font-display text-sm font-bold">AI match</h3>
            {candidate.ai_match_score !== null ? (
              <div className="flex items-center gap-3">
                <span className="w-12 text-right font-display text-2xl font-extrabold text-brand-gold-dark">
                  {candidate.ai_match_score}%
                </span>
                <Meter value={candidate.ai_match_score} className="flex-1" />
              </div>
            ) : (
              <p className="text-sm text-brand-ink/45">This candidate has not been screened yet.</p>
            )}
            {candidate.ai_screening_summary && (
              <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">
                {candidate.ai_screening_summary}
              </p>
            )}
          </section>

          {(strengths.length > 0 || gaps.length > 0) && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {strengths.length > 0 && (
                <div className="rounded-xl bg-brand-cream p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
                    Strengths
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm text-brand-ink/70">
                    {strengths.map((s) => (
                      <li key={s}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {gaps.length > 0 && (
                <div className="rounded-xl bg-brand-cream p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
                    Gaps
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm text-brand-ink/70">
                    {gaps.map((g) => (
                      <li key={g}>• {g}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {report && (
            <section>
              <h3 className="mb-2 font-display text-sm font-bold">Soft skills</h3>
              <SoftSkillBars report={report} />
              {report.summary && (
                <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">{report.summary}</p>
              )}
            </section>
          )}

          {candidate.ai_feedback && (
            <section>
              <h3 className="mb-1.5 font-display text-sm font-bold">Candidate feedback</h3>
              <p className="text-sm leading-relaxed text-brand-ink/65">{candidate.ai_feedback}</p>
            </section>
          )}

          {candidate.rejection_reason && (
            <section>
              <h3 className="mb-1.5 font-display text-sm font-bold">Rejection reason</h3>
              <p className="text-sm leading-relaxed text-rose-700">{candidate.rejection_reason}</p>
            </section>
          )}

          <section className="border-t border-brand-line pt-4 text-xs text-brand-ink/45">
            <p>Applied {new Date(candidate.created_at).toLocaleDateString()}</p>
            {candidate.cv_file_path && (
              <p className="mt-1 break-all">CV: {candidate.cv_file_path}</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function BroadcastDrawer({
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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function pickTemplate(id: string) {
    setTemplate(id);
    const found = TEMPLATES.find((t) => t.id === id);
    if (found) setBody(found.body);
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

    setPending(true);
    try {
      const result = await sendBulkWhatsApp({
        applicationIds: recipients.map((r) => r.id),
        templateKey: template,
        message: body,
      });
      if (result.ok) {
        setDone(
          `Queued ${result.queued ?? recipients.length} message${(result.queued ?? 0) === 1 ? "" : "s"}.`
        );
        setTimeout(() => {
          setDone(null);
          onSent();
          onClose();
        }, 900);
      } else {
        setError(result.error ?? "Could not send.");
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
      title="Bulk WhatsApp"
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
        <Field label="Template" htmlFor="wa-template">
          <Select id="wa-template" value={template} onChange={(e) => pickTemplate(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

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
                {!r.phone && (
                  <span className="shrink-0 text-[11px] text-rose-600">no number</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <FormMessage error={error} success={done} />
      </div>
    </Drawer>
  );
}