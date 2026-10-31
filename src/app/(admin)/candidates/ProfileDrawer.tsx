"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Send, Sparkles, User, type LucideIcon } from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { navForward } from "@/modules/shell/domain/navTransition";
import { Field, FormMessage, TextInput } from "@/modules/analytics/presentation/Form";
import { Badge, Button, Meter } from "@/modules/analytics/presentation/ui";
import { PIPELINE_STAGES as STAGES } from "@/modules/candidates/domain/listFilters";
import {
  draftCandidateFeedback,
  screenApplication,
  sendCandidateFeedback,
  updateApplicationStage,
  updateCandidateContact,
  type PipelineStage,
} from "./candidate-actions";
import type { CandidateRow } from "./actions";
import { CandidateDossier } from "./CandidateDossier";
import { IntegrityPanel } from "./IntegrityPanel";
import { InterviewPanel } from "./InterviewPanel";
import { OfferPanel } from "./OfferPanel";
import { RejectReasonForm } from "./RejectReasonForm";
import { ArchiveButton, stageTone } from "./CandidateBrowserBits";
import { cn } from "@/lib/utils";
import type { SoftSkillReport } from "@/core/entities";

/* The one candidate's profile drawer — see ./CandidateBrowser.tsx for the table
   that opens it. Everything here is scoped to a single application row. */

/** The three panels the profile drawer is split into. */
type ProfileTab = "overview" | "record" | "ai";

/**
 * One candidate across three tabs: the pipeline decisions, the record they
 * applied with, and what the AI made of it. Everything the drawer used to stack
 * into one long scroll is still rendered — only the order and the fold changed.
 */
export function ProfileDrawer({
  candidate,
  canWrite,
  timeZone,
  canGenerateQuestions,
  pendingArchive,
  archiveNote,
  onArchive,
  onClose,
}: {
  candidate: CandidateRow | null;
  canWrite: boolean;
  timeZone: string;
  canGenerateQuestions: boolean;
  pendingArchive: string | null;
  archiveNote: string | null;
  onArchive: (candidate: CandidateRow) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const report = candidate?.ai_soft_skills as SoftSkillReport | null;
  const strengths = candidate?.ai_strengths ?? [];
  const gaps = candidate?.ai_gaps ?? [];

  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [screenPending, setScreenPending] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Bumped by a contact edit so the record on the Application tab re-reads the row. */
  const [contactRev, setContactRev] = useState(0);

  /**
   * The drawer opens on Overview. "Application" is a second read of its own, so
   * the dossier is fetched the first time that tab is opened rather than on every
   * profile someone peeks at — and every panel stays mounted once seen, so a
   * half-typed rejection reason survives a switch away and back.
   */
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [dossierSeen, setDossierSeen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);

  function selectTab(next: ProfileTab) {
    setTab(next);
    if (next === "record") setDossierSeen(true);
    // The panels differ wildly in height, so a switch starts the next one at its
    // own top rather than wherever the last one left the drawer scrolled to.
    headRef.current?.scrollIntoView({ block: "start" });
  }

  const tabs: { key: ProfileTab; label: string; icon: LucideIcon }[] = [
    { key: "overview", label: "Overview", icon: User },
    { key: "record", label: "Application", icon: FileText },
    { key: "ai", label: "AI screening", icon: Sparkles },
  ];

  async function moveTo(stage: PipelineStage) {
    if (!candidate || stage === candidate.stage) return;
    if (stage === "REJECTED") {
      setRejectOpen(true);
      return;
    }
    setPendingStage(stage);
    setError(null);
    setDone(null);
    try {
      const result = await updateApplicationStage({ applicationId: candidate.id, stage });
      if (result.ok) {
        setDone(`Moved to ${stage.replace("_", " ").toLowerCase()}.`);
        router.refresh();
      } else {
        setError(result.error ?? "Could not move the candidate.");
      }
    } catch {
      setError("Something went wrong moving the candidate.");
    } finally {
      setPendingStage(null);
    }
  }

  async function runScreen() {
    if (!candidate) return;
    setScreenPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await screenApplication(candidate.id);
      if (result.ok) {
        setDone(
          `Screened: ${result.score}% fit${result.decision ? ` — ${result.decision.toLowerCase()}` : ""}.` +
            (result.auto_stage
              ? ` The score crossed your AI thresholds, so the candidate moved to ${result.auto_stage.toLowerCase()} automatically.`
              : "")
        );
        router.refresh();
      } else {
        setError(result.error ?? "Screening failed.");
      }
    } catch {
      setError("Something went wrong running the screening.");
    } finally {
      setScreenPending(false);
    }
  }

  async function draftFeedback() {
    if (!candidate) return;
    setFeedbackPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await draftCandidateFeedback(candidate.id);
      if (result.ok) {
        setDone("Feedback draft written.");
        router.refresh();
      } else {
        setError(result.error ?? "Could not draft feedback.");
      }
    } catch {
      setError("Something went wrong drafting the feedback.");
    } finally {
      setFeedbackPending(false);
    }
  }

  async function sendFeedback() {
    if (!candidate) return;
    setSendPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await sendCandidateFeedback(candidate.id);
      if (result.ok) {
        setDone(
          `Sent to ${result.recipient} — ${result.characters} characters, exactly the text above.` +
            (result.inApp === "sent"
              ? " Copied into the candidate's portal inbox."
              : " In-app notices are switched off, so only the email went out.")
        );
        router.refresh();
      } else {
        setError(result.error ?? "Could not send the feedback.");
      }
    } catch {
      setError("Something went wrong sending the feedback.");
    } finally {
      setSendPending(false);
    }
  }

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
          <div ref={headRef} className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(candidate.stage)}>{candidate.stage.replace("_", " ")}</Badge>
            {candidate.archived_at && <Badge tone="neutral">Filed away</Badge>}
            {candidate.job_title && <Badge tone="neutral">{candidate.job_title}</Badge>}
            {candidate.phone && <Badge tone="neutral">{candidate.phone}</Badge>}
            {candidate.attempt_token && (
              <IntegrityPanel
                key={`integrity-${candidate.id}`}
                accessToken={candidate.attempt_token}
                candidateName={candidate.full_name}
              />
            )}
            <InterviewPanel
              key={`interviews-${candidate.id}`}
              applicationId={candidate.id}
              candidateName={candidate.full_name}
              jobTitle={candidate.job_title}
              initialInterviews={candidate.interviews}
              canWrite={canWrite}
              timeZone={timeZone}
              canGenerateQuestions={canGenerateQuestions}
            />
            {/* This drawer is one application's. The profile is the person's — every
                opening they hold, with the tests, files, messages and changes that
                sit on any of them. */}
            <Link
              href={`/candidates/${candidate.id}`}
              transitionTypes={navForward}
              className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-gold-dark transition hover:bg-brand-sand"
            >
              <User className="h-3.5 w-3.5" aria-hidden />
              Their whole profile
            </Link>
          </div>

          {/* Integrity and interviews each open a full-screen report of their own,
              so they stay on the identity row rather than behind a tab that would
              hold nothing but the trigger. */}
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Candidate profile sections"
          >
            {tabs.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                id={`profile-tab-${option.key}`}
                aria-selected={tab === option.key}
                aria-controls={`profile-panel-${option.key}`}
                onClick={() => selectTab(option.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                  tab === option.key
                    ? "bg-brand-ink text-brand-cream shadow-soft"
                    : "border border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
                )}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>

          {/* One message slot outside the panels, so the answer to a stage move or
              a screen run is read wherever the recruiter happens to be looking. */}
          <FormMessage error={error} success={done} />

          <section
            role="tabpanel"
            id="profile-panel-overview"
            aria-labelledby="profile-tab-overview"
            className={cn("space-y-5", tab !== "overview" && "hidden")}
          >
            {canWrite && (
              <ContactSection
                key={`contact-${candidate.id}`}
                candidate={candidate}
                onSaved={() => setContactRev((n) => n + 1)}
              />
            )}

            {canWrite && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold">Pipeline</h3>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((stage) => {
                    const active = candidate.stage === stage;
                    const isReject = stage === "REJECTED";
                    // A rejection in progress or half-typed is the one moment the
                    // other stage buttons must not answer, or a second write would
                    // silently overwrite the reason being written.
                    const blocked = active || pendingStage !== null || rejectOpen;
                    return (
                      <button
                        key={stage}
                        type="button"
                        disabled={blocked}
                        aria-pressed={active}
                        onClick={() => void moveTo(stage as PipelineStage)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition",
                          active
                            ? "border-brand-gold bg-brand-gold/15 text-brand-gold-dark"
                            : isReject
                              ? "border-brand-line bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                              : "border-brand-line bg-white text-brand-ink/60 hover:bg-brand-sand",
                          blocked && !active && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {pendingStage === stage && (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        )}
                        {stage.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>

                {rejectOpen && (
                  <div className="mt-3">
                    <RejectReasonForm
                      candidate={candidate}
                      onCancel={() => setRejectOpen(false)}
                      onMoved={(autoFeedback) => {
                        setRejectOpen(false);
                        setDone(
                          autoFeedback
                            ? "Candidate rejected. A feedback draft is being written in the background."
                            : "Candidate rejected. Personalised feedback is switched off in Settings, so no draft was written — use Draft feedback whenever you want one."
                        );
                        router.refresh();
                      }}
                    />
                  </div>
                )}
              </section>
            )}

            {/* The offer is worked on where the person is: the drawer at the Offer
                stage carries the link, the deadline and the separate hire click. */}
            {canWrite && candidate.stage === "OFFER" && (
              <OfferPanel
                key={`offer-${candidate.id}`}
                applicationId={candidate.id}
                candidateName={candidate.full_name}
                timeZone={timeZone}
              />
            )}

            {canWrite && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold">Filing</h3>
                <p className="mb-2.5 text-xs leading-relaxed text-brand-ink/55">
                  {candidate.archived_at
                    ? "Filed away: out of the pipeline, the dashboard and the job’s applicant list, with nothing deleted. Restore returns the record exactly where it was."
                    : "Filing takes this candidate out of the pipeline, the dashboard and the job’s applicant list without erasing anything — their answers, scores and the notices they were sent all stay on the record."}
                </p>
                {candidate.archived_at && (
                  <p className="mb-2.5 text-xs text-brand-ink/45">
                    Filed on{" "}
                    {new Date(candidate.archived_at).toLocaleDateString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    .
                  </p>
                )}
                {archiveNote && (
                  <p
                    role="alert"
                    className="mb-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    {archiveNote}
                  </p>
                )}
                <ArchiveButton
                  candidate={candidate}
                  pending={pendingArchive === candidate.id}
                  onToggle={() => onArchive(candidate)}
                />
                {!candidate.archived_at && (
                  <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/40">
                    An open assessment link or an interview still on the calendar is cleared first —
                    the button says which one is holding the record in place.
                  </p>
                )}
              </section>
            )}

            {candidate.rejection_reason && (
              <section>
                <h3 className="mb-1.5 font-display text-sm font-bold">Rejection reason</h3>
                <p className="text-sm leading-relaxed text-rose-700">{candidate.rejection_reason}</p>
              </section>
            )}
          </section>

          <section
            role="tabpanel"
            id="profile-panel-record"
            aria-labelledby="profile-tab-record"
            className={cn(tab !== "record" && "hidden")}
          >
            {dossierSeen && (
              <CandidateDossier
                key={`dossier-${candidate.id}`}
                applicationId={candidate.id}
                reloadKey={contactRev}
              />
            )}
          </section>

          <section
            role="tabpanel"
            id="profile-panel-ai"
            aria-labelledby="profile-tab-ai"
            className={cn("space-y-5", tab !== "ai" && "hidden")}
          >
            <section>
              <h3 className="mb-2 font-display text-sm font-bold">AI screening</h3>
              {candidate.scores_masked ? (
                <p className="text-sm text-brand-ink/45">
                  Scores are hidden for your role. Ask an administrator for the
                  &ldquo;View unmasked scores&rdquo; permission, or switch
                  &ldquo;Mask scores for interviewers&rdquo; off in Settings.
                </p>
              ) : candidate.ai_match_score !== null ? (
                <div className="flex items-center gap-3">
                  <span className="w-12 text-right font-display text-2xl font-extrabold text-brand-gold-dark">
                    {candidate.ai_match_score}%
                  </span>
                  <Meter value={candidate.ai_match_score} className="flex-1" />
                </div>
              ) : (
                <p className="text-sm text-brand-ink/45">
                  This candidate has not been screened yet.
                </p>
              )}
              {candidate.ai_screening_summary && (
                <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">
                  {candidate.ai_screening_summary}
                </p>
              )}
              {/* Recorded by the screen itself, so it reports the bias-reduction
                  setting as it stood when this score was produced. */}
              {candidate.screened &&
                candidate.diversity_flags?.cv_anonymization && (
                  <p className="mt-2 text-xs text-brand-ink/45">
                    {candidate.diversity_flags.cv_anonymization === "applied"
                      ? "Demographic markers were stripped from the CV before the model scored it."
                      : "Bias reduction was switched off for this screen — the model saw the CV as submitted."}
                  </p>
                )}

              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void runScreen()}
                    disabled={screenPending || pendingStage !== null}
                  >
                    {screenPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {candidate.screened ? "Re-screen" : "Screen with AI"}
                  </Button>
                  {candidate.screened && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void draftFeedback()}
                      disabled={feedbackPending}
                    >
                      {feedbackPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      )}
                      {candidate.ai_feedback ? "Redraft feedback" : "Draft feedback"}
                    </Button>
                  )}
                </div>
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
                {canWrite && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void sendFeedback()}
                      disabled={sendPending || feedbackPending}
                    >
                      {sendPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Email this to the candidate
                    </Button>
                    <p className="mt-1.5 text-xs text-brand-ink/45">
                      {candidate.email
                        ? `Goes to ${candidate.email} as written above, under the subject “Feedback on your application — ${candidate.job_title ?? "the role"}”. WhatsApp is not used for this letter.`
                        : "This candidate has no email address on the record, so there is nowhere to send it."}
                    </p>
                  </div>
                )}
              </section>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

/** Four scored soft skills, read straight off the screening report. */
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
          {/*
            Capped, not fixed: 144px of label plus the number and the gaps leaves
            a drawer on a phone with almost no bar left to read. The cap is a
            share of the row, so the meter keeps the wider half at any width.
          */}
          <span className="w-36 max-w-[45%] shrink-0 text-xs text-brand-ink/60">{label}</span>
          <Meter value={value} className="min-w-0 flex-1" />
          <span className="w-8 shrink-0 text-right text-xs font-bold">{value}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The three columns every outbound message is addressed to. The caller keys
 * this by candidate id, so half-typed text in one profile never leaks into the
 * next one opened, and renders it only for someone who can write.
 */
function ContactSection({
  candidate,
  onSaved,
}: {
  candidate: CandidateRow;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(candidate.full_name);
  const [email, setEmail] = useState(candidate.email);
  const [phone, setPhone] = useState(candidate.phone ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit() {
    setFullName(candidate.full_name);
    setEmail(candidate.email);
    setPhone(candidate.phone ?? "");
    setError(null);
    setSaved(null);
    setNotice(null);
    setEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setNotice(null);
    setEditing(false);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await updateCandidateContact({
        applicationId: candidate.id,
        fullName,
        email,
        phone,
      });
      if (!result.ok || !result.contact) {
        // A refused write keeps the form and its text on screen, so the reason
        // reads against what was typed instead of forcing a retype from memory.
        setError(result.error ?? "Could not save the contact details.");
        return;
      }
      setSaved(
        `Saved: ${result.contact.full_name} · ${result.contact.email}` +
          (result.contact.phone ? ` · ${result.contact.phone}` : "")
      );
      setNotice(result.notice ?? null);
      setEditing(false);
      onSaved();
      router.refresh();
    } catch {
      setError("Something went wrong saving the contact details.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {saved ? (
            <p role="status" className="text-xs font-semibold text-emerald-800">
              {saved}
            </p>
          ) : (
            <p className="text-xs text-brand-ink/50">
              Every notice, email and WhatsApp to this candidate goes to these details.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={startEdit}>
            Edit contact details
          </Button>
        </div>
        {notice && (
          <p
            role="status"
            className="rounded-xl border border-brand-gold/50 bg-brand-sand/60 px-3 py-2 text-xs leading-relaxed text-brand-ink/70"
          >
            {notice}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-brand-line bg-white p-3.5">
      <h3 className="font-display text-sm font-bold">Contact details</h3>

      <Field label="Full name" htmlFor="contact-name" required>
        <TextInput
          id="contact-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Email" htmlFor="contact-email" required hint="Stored lowercase, like the apply form writes it.">
        <TextInput
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Phone" htmlFor="contact-phone" hint="Leave empty when the candidate has no number on file.">
        <TextInput
          id="contact-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
        />
      </Field>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={cancelEdit} disabled={pending}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
