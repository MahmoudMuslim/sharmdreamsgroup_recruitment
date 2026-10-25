"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Gift,
  Loader2,
  Trophy,
  UserRoundPlus,
} from "lucide-react";
import {
  decideReferralBonus,
  fileReferral,
  reassignReferral,
} from "./actions";
import type { ReferralDesk, ReferralRow } from "@/modules/referrals/infrastructure/referralReader";
import {
  BONUS_LABELS,
  BONUS_STATES,
  referralLink,
  type BonusState,
} from "@/modules/referrals/domain/referral";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

/**
 * The referral book on screen.
 *
 * The two mutation shapes a row can take — a bonus decision and a reassignment —
 * are their own small components so a failed save on one row cannot leave every
 * other row's controls disabled without a reason. Both are only rendered for a
 * recruiter; the action refuses a hiring manager regardless, because a control
 * that is drawn is not a permission.
 *
 * The link is shown as a path and copied as an absolute address. The path is
 * deterministic on the server and on the client, so the card does not change
 * shape at hydration; the origin comes from the browser when the button is
 * pressed, which is the only moment it matters.
 */

const PROGRESS_TONE: Record<string, "neutral" | "gold" | "success" | "danger" | "info"> = {
  invited: "neutral",
  screening: "info",
  assessment: "info",
  interview: "gold",
  offer: "gold",
  hired: "success",
  closed: "danger",
};

const BONUS_TONE: Record<BonusState, "neutral" | "gold" | "success" | "danger"> = {
  NONE: "neutral",
  PENDING: "gold",
  PAID: "success",
  DECLINED: "danger",
};

const FIELD =
  "w-full rounded-lg border border-brand-line bg-white px-3 py-2 text-sm text-brand-ink outline-none transition focus:border-brand-gold";

function when(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function ReferralsBoard({ desk }: { desk: ReferralDesk }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [linkJobId, setLinkJobId] = useState(desk.jobs[0]?.id ?? "");
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [entryJobId, setEntryJobId] = useState(desk.jobs[0]?.id ?? "");
  const [note, setNote] = useState("");

  const canDecide = desk.role === "SUPER_ADMIN" || desk.role === "RECRUITER";
  const canReassign = canDecide;
  const board = desk.board;

  // The copied tick is feedback, not state: it clears itself so the button keeps
  // saying what it will do next.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function perform(
    work: () => Promise<{ ok: boolean; error?: string }>,
    success: string
  ) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (result.ok) {
          setDone(success);
          router.refresh();
        } else {
          setError(result.error ?? "The write did not land.");
        }
      } catch {
        setError("The portal did not answer, so nothing was saved.");
      }
    });
  }

  const relativeLink =
    desk.myCode && linkJobId ? referralLink("", linkJobId, desk.myCode) : "";

  async function copyLink() {
    if (!relativeLink) return;
    try {
      await navigator.clipboard.writeText(
        new URL(relativeLink, window.location.origin).toString()
      );
      setCopied(true);
    } catch {
      setError("The browser refused the clipboard. Copy the address from the box instead.");
    }
  }

  function submitEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Enter the candidate's email address.");
      return;
    }
    if (!entryJobId) {
      setError("Choose the role the candidate was referred to.");
      return;
    }
    perform(
      () => fileReferral({ email, fullName, jobId: entryJobId, note }),
      `${fullName.trim() || email.trim()} is now on your book.`
    );
  }

  return (
    <div className="space-y-6">
      {(error || done) && (
        <div
          role="status"
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            error
              ? "border-rose-500/25 bg-rose-500/5 text-rose-700"
              : "border-emerald-500/25 bg-emerald-500/5 text-emerald-700"
          )}
        >
          {error ?? done}
        </div>
      )}

      {!board.available ? (
        <Card className="flex items-start gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-base font-bold">The book cannot be read yet</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">{board.note}</p>
            {desk.codeNote && (
              <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">{desk.codeNote}</p>
            )}
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
              Nothing is lost: the page reads the table on every load, and what was filed while it
              was missing stays in the applications the claims point at.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Claims"
              value={board.counts.total}
              hint="every claim on this book"
              icon={<Gift className="h-5 w-5" aria-hidden />}
            />
            <StatTile
              label="Not applied yet"
              value={board.counts.invited}
              hint="referred, waiting on the person"
            />
            <StatTile
              label="In the pipeline"
              value={board.counts.active}
              hint="screening to offer"
            />
            <StatTile
              label="Hired"
              value={board.counts.hired}
              hint="the only hired state"
              icon={<Trophy className="h-5 w-5" aria-hidden />}
            />
            <StatTile label="Closed" value={board.counts.closed} hint="rejected applications" />
            <StatTile
              label="Bonus pending"
              value={board.counts.bonusPending}
              hint="a decision recorded as pending"
            />
            <StatTile
              label="Bonus paid"
              value={board.counts.bonusPaid}
              hint="recorded, not paid here"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Your referral link" meta="one code, every role" />
                <div className="space-y-3 p-5">
                  {desk.myCode ? (
                    <>
                      {desk.jobs.length > 0 ? (
                        <>
                          <label
                            htmlFor="referral-job"
                            className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                          >
                            The role to link
                          </label>
                          <select
                            id="referral-job"
                            value={linkJobId}
                            onChange={(event) => setLinkJobId(event.target.value)}
                            className={FIELD}
                          >
                            {desk.jobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                {job.title} — {job.status.toLowerCase()}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-stretch gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-lg border border-brand-line bg-brand-sand/40 px-3 py-2 font-mono text-xs text-brand-ink/70">
                              {relativeLink}
                            </code>
                            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                              {copied ? (
                                <Check className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                              )}
                              {copied ? "Copied" : "Copy"}
                            </Button>
                            <Link
                              href={relativeLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:bg-brand-sand"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                              Open
                            </Link>
                          </div>
                          <p className="text-xs leading-relaxed text-brand-ink/50">
                            A person who applies through this link is credited to you. Send the
                            role&apos;s own address if you want them to read the ad first — the code
                            travels on the application, not on the person.
                          </p>
                        </>
                      ) : (
                        <p className="text-sm leading-relaxed text-brand-ink/55">
                          There is no role to link yet. Publish an opening and its address will
                          appear here with your code on it.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm leading-relaxed text-brand-ink/55">
                      {desk.codeNote ??
                        "No code is on your profile yet. It is generated by the database when the referrals table is created, so this card fills itself in on the next load."}
                    </p>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="File a referral by hand"
                  meta="for someone who applied another way"
                />
                <form onSubmit={submitEntry} className="space-y-3 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="referral-email"
                        className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                      >
                        Candidate email
                      </label>
                      <input
                        id="referral-email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="maya.hassan@example.com"
                        className={cn(FIELD, "mt-1")}
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="referral-name"
                        className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                      >
                        Name <span className="normal-case tracking-normal text-brand-ink/35">optional</span>
                      </label>
                      <input
                        id="referral-name"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Maya Hassan"
                        className={cn(FIELD, "mt-1")}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="referral-entry-job"
                      className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                    >
                      Role
                    </label>
                    <select
                      id="referral-entry-job"
                      value={entryJobId}
                      onChange={(event) => setEntryJobId(event.target.value)}
                      className={cn(FIELD, "mt-1")}
                    >
                      {desk.jobs.length === 0 && <option value="">No roles yet</option>}
                      {desk.jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.title} — {job.status.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="referral-note"
                      className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/45"
                    >
                      Note <span className="normal-case tracking-normal text-brand-ink/35">optional, 600 characters</span>
                    </label>
                    <textarea
                      id="referral-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value.slice(0, 600))}
                      rows={2}
                      placeholder="How you know them, and why this role."
                      className={cn(FIELD, "mt-1 resize-y")}
                    />
                    <p className="mt-1 text-right text-[11px] text-brand-ink/35">
                      {note.length}/600
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-relaxed text-brand-ink/45">
                      First claim wins. A recruiter can move it afterwards.
                    </p>
                    <Button type="submit" disabled={pending || desk.jobs.length === 0}>
                      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      File the claim
                    </Button>
                  </div>
                </form>
              </Card>
            </div>

            <Card>
              <CardHeader title="Who brought the most" meta="hires, then the size of the book" />
              {board.leaderboard.length === 0 ? (
                <EmptyState
                  icon={<Trophy className="h-6 w-6" aria-hidden />}
                  title="No claims to rank yet"
                  description="The board lists every referrer, including the ones with no hires."
                />
              ) : (
                <ol className="divide-y divide-brand-line">
                  {board.leaderboard.map((entry) => (
                    <li
                      key={entry.profileId}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <span className="w-6 font-mono text-xs font-bold text-brand-ink/40">
                        {entry.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {entry.name}
                        {entry.profileId === desk.profileId && (
                          <span className="ml-1.5 text-[11px] font-normal text-brand-ink/40">you</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-brand-ink/55">
                        {entry.hired} hired · {entry.total} claimed
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="The book"
              meta={
                board.capped
                  ? `newest ${board.limit} shown`
                  : `${board.rows.length} claim${board.rows.length === 1 ? "" : "s"}`
              }
            />
            {board.note && (
              <p className="border-b border-brand-line bg-brand-sand/30 px-5 py-2.5 text-xs text-brand-ink/55">
                {board.note}
              </p>
            )}
            {board.rows.length === 0 ? (
              <EmptyState
                icon={<UserRoundPlus className="h-6 w-6" aria-hidden />}
                title="Nobody has been claimed yet"
                description="Send your link, or file a claim above. Progress follows the application's stage on its own."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[62rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-brand-line text-left text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                      <th className="px-5 py-3">Person</th>
                      <th className="px-3 py-3">Role</th>
                      <th className="px-3 py-3">Credited to</th>
                      <th className="px-3 py-3">Progress</th>
                      <th className="px-3 py-3">Bonus</th>
                      {canReassign && <th className="px-5 py-3">Reassign</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line">
                    {board.rows.map((row) => (
                      <tr key={row.id} className="align-top">
                        <td className="px-5 py-4">
                          <p className="font-semibold">{row.fullName ?? row.email}</p>
                          <p className="text-xs text-brand-ink/45">{row.email}</p>
                          {row.note && (
                            <p
                              className="mt-1 max-w-[18rem] text-xs leading-relaxed text-brand-ink/50"
                              title={row.note}
                            >
                              {row.note}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-brand-ink/35">
                            claimed {when(row.createdAt)}
                          </p>
                        </td>
                        <td className="px-3 py-4">
                          <p className="font-medium">{row.jobTitle}</p>
                          <p className="text-xs text-brand-ink/45">
                            {[row.jobLocation, row.jobStatus?.toLowerCase()]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </td>
                        <td className="px-3 py-4">
                          <p className="font-medium">{row.referrerName}</p>
                          {row.referrerProfileId === desk.profileId && (
                            <p className="text-xs text-brand-ink/45">you</p>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <Badge tone={PROGRESS_TONE[row.progress.key] ?? "neutral"}>
                            {row.progress.label}
                          </Badge>
                          {row.applicationId ? (
                            <Link
                              href={`/candidates/${row.applicationId}`}
                              className="mt-1.5 block text-[11px] font-semibold text-brand-gold-dark"
                            >
                              Open the application
                            </Link>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-brand-ink/40">
                              No application yet
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <BonusCell
                            key={`${row.id}:${row.bonusState}:${row.bonusNote ?? ""}`}
                            row={row}
                            canDecide={canDecide}
                            pending={pending}
                            onSave={(state, note) =>
                              perform(
                                () => decideReferralBonus({ referralId: row.id, state, note }),
                                `Recorded ${BONUS_LABELS[state].toLowerCase()} for ${row.email}.`
                              )
                            }
                          />
                        </td>
                        {canReassign && (
                          <td className="px-5 py-4">
                            <ReassignCell
                              row={row}
                              staff={desk.staff}
                              pending={pending}
                              onMove={(profileId) =>
                                perform(
                                  () => reassignReferral({ referralId: row.id, profileId }),
                                  `${row.email} moved to another member of staff.`
                                )
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function BonusCell({
  row,
  canDecide,
  pending,
  onSave,
}: {
  row: ReferralRow;
  canDecide: boolean;
  pending: boolean;
  onSave: (state: BonusState, note: string) => void;
}) {
  const [state, setState] = useState<BonusState>(row.bonusState);
  const [note, setNote] = useState(row.bonusNote ?? "");
  const dirty = state !== row.bonusState || note !== (row.bonusNote ?? "");

  return (
    <div className="w-44 space-y-1.5">
      <Badge tone={BONUS_TONE[row.bonusState]}>{BONUS_LABELS[row.bonusState]}</Badge>
      {(row.bonusDecidedByName || row.bonusDecidedAt) && (
        <p className="text-[11px] text-brand-ink/40">
          {[row.bonusDecidedByName, when(row.bonusDecidedAt)].filter(Boolean).join(" · ")}
        </p>
      )}
      {row.bonusNote && (
        <p className="text-[11px] leading-relaxed text-brand-ink/50" title={row.bonusNote}>
          {row.bonusNote}
        </p>
      )}

      {canDecide && (
        <>
          <select
            aria-label={`Bonus state for ${row.email}`}
            value={state}
            onChange={(event) => setState(event.target.value as BonusState)}
            className="w-full rounded-lg border border-brand-line bg-white px-2 py-1.5 text-xs"
          >
            {BONUS_STATES.map((option) => (
              <option key={option} value={option}>
                {BONUS_LABELS[option]}
              </option>
            ))}
          </select>
          <input
            aria-label={`Bonus note for ${row.email}`}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 400))}
            placeholder="Note, optional"
            className="w-full rounded-lg border border-brand-line bg-white px-2 py-1.5 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !dirty}
            onClick={() => onSave(state, note)}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            Save decision
          </Button>
        </>
      )}
    </div>
  );
}

function ReassignCell({
  row,
  staff,
  pending,
  onMove,
}: {
  row: ReferralRow;
  staff: ReferralDesk["staff"];
  pending: boolean;
  onMove: (profileId: string) => void;
}) {
  const [profileId, setProfileId] = useState("");
  const others = staff.filter((person) => person.id !== row.referrerProfileId);

  if (others.length === 0) {
    return <p className="text-xs text-brand-ink/40">No other member of staff.</p>;
  }

  return (
    <div className="w-44 space-y-1.5">
      <select
        aria-label={`Reassign the referral of ${row.email}`}
        value={profileId}
        onChange={(event) => setProfileId(event.target.value)}
        className="w-full rounded-lg border border-brand-line bg-white px-2 py-1.5 text-xs"
      >
        <option value="">Choose a person…</option>
        {others.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || !profileId}
        onClick={() => onMove(profileId)}
      >
        Move the claim
      </Button>
    </div>
  );
}
