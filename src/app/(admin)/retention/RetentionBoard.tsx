"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eraser,
  FileSearch,
  Inbox,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

import {
  canDecidePrivacyRequest,
  canExecuteErasure,
  canVerifyPrivacyRequest,
  privacyStateLabel,
  type PrivacyRequestAction,
  type PrivacyRequestState,
} from "@/modules/privacy/domain/privacy";
import type {
  PrivacyRequestRow,
  RetentionReview,
} from "@/modules/privacy/infrastructure/privacyReader";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

import { actOnPrivacyRequest, type RetentionPageData } from "./actions";

/**
 * The privacy desk on screen.
 *
 * The buttons a row draws are a reading of the same role gates the action runs,
 * never a permission: a control that is drawn is refused by `actOnPrivacyRequest`
 * and again by the UPDATE policy in 041. Keeping the two in step is why the
 * booleans come from the domain rather than from a role string compared here.
 *
 * Execution is two presses. It is the one control on the portal that destroys
 * data, and a single mistaken click on a row in a table is too cheap for that.
 */

const STATE_TONE: Record<PrivacyRequestState, "neutral" | "info" | "gold" | "success" | "danger"> = {
  RECEIVED: "neutral",
  VERIFIED: "info",
  APPROVED: "gold",
  EXECUTED: "success",
  DECLINED: "danger",
};

function when(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function kindLabel(kind: string): string {
  return kind === "erasure" ? "Erase my data" : "Copy of my data";
}

export function RetentionBoard({ data }: { data: RetentionPageData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (data.denied) {
    return (
      <Card className="flex items-start gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h3 className="font-display text-base font-bold">This desk is not yours</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
            A privacy request names a person&apos;s address and what they asked for, so the desk is
            read by a recruiter or the owner rather than by every member of staff. Nothing on this
            page changed your access; the rail entry opens for the people whose job this is.
          </p>
        </div>
      </Card>
    );
  }

  const desk = data.desk;
  const canVerify = canVerifyPrivacyRequest(desk.role);
  const canDecide = canDecidePrivacyRequest(desk.role);
  const canExecute = canExecuteErasure(desk.role);

  function perform(
    work: () => Promise<{ ok: boolean; error?: string; message?: string }>,
    fallback: string
  ) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (result.ok) {
          setDone(result.message ?? fallback);
          router.refresh();
        } else {
          setError(result.error ?? "The write did not land.");
        }
      } catch {
        setError("The portal did not answer, so nothing was saved.");
      }
    });
  }

  function act(row: PrivacyRequestRow, action: PrivacyRequestAction) {
    const label =
      action === "verify"
        ? "Verified. The owner can now approve or decline it."
        : action === "approve"
          ? "Approved. Running it is the next step."
          : action === "decline"
            ? "Declined. Nothing on the record was changed."
            : "Done.";
    perform(() => actOnPrivacyRequest({ requestId: row.id, action }), label);
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

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
        <Badge tone={desk.settings.enabled ? "success" : "neutral"}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {desk.settings.enabled ? "Sweep on" : "Sweep off"}
        </Badge>
        <p className="text-xs text-brand-ink/55">
          Ordinary window <strong className="font-semibold text-brand-ink/75">{desk.settings.months} months</strong>{" "}
          after the last activity · talent pool{" "}
          <strong className="font-semibold text-brand-ink/75">{desk.settings.talentPoolMonths} months</strong>{" "}
          from the grant ·{" "}
          <strong className="font-semibold text-brand-ink/75">{desk.settings.warningDays} days</strong>{" "}
          between the warning and an erasure
        </p>
        <Link
          href="/settings?area=privacy"
          className="ml-auto text-xs font-semibold text-brand-gold-dark"
        >
          Change in Settings
        </Link>
      </Card>

      {!desk.settings.enabled && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-gold/30 bg-brand-gold/10 px-4 py-3 text-sm text-brand-ink/70">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
          <p>
            The sweep is off, so nothing on this page will be erased on a timer. The records below
            are still weighed and printed, and the request book still works — only the nightly
            removal is waiting for the switch in Settings → Privacy &amp; retention.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Received"
          value={desk.requests.counts.RECEIVED}
          hint="waiting to be verified"
          icon={<Inbox className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Verified"
          value={desk.requests.counts.VERIFIED}
          hint="waiting on the owner's decision"
        />
        <StatTile
          label="Approved"
          value={desk.requests.counts.APPROVED}
          hint="approved, not yet run"
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Executed"
          value={desk.requests.counts.EXECUTED}
          hint="the work has run"
        />
        <StatTile
          label="Declined"
          value={desk.requests.counts.DECLINED}
          hint="nothing was changed"
        />
        <StatTile
          label="Due"
          value={desk.counts.due}
          hint="inside the sweep's reach"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="In warning"
          value={desk.counts.warning}
          hint="inside the warning window, not necessarily mailed yet"
        />
        <StatTile
          label="Held"
          value={desk.counts.held}
          hint="hired, open work, or undated"
          icon={<Lock className="h-5 w-5" aria-hidden />}
        />
      </div>

      {!desk.requests.available && desk.requests.note && (
        <Card className="flex items-start gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-base font-bold">The request book cannot be read yet</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">{desk.requests.note}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/60">
              This is not an empty desk: it means the database cannot record a request yet. An
              applicant is never refused because of it — consent is enforced in code, so the apply
              form still works.
            </p>
          </div>
        </Card>
      )}

      {desk.requests.available && (
        <Card>
          <CardHeader
            title="The request book"
            meta={
              desk.requests.capped
                ? `newest ${desk.requests.limit} shown`
                : `${desk.requests.rows.length} request${desk.requests.rows.length === 1 ? "" : "s"}`
            }
          />
          {desk.requests.note && (
            <p className="border-b border-brand-line bg-brand-sand/30 px-5 py-2.5 text-xs text-brand-ink/55">
              {desk.requests.note}
            </p>
          )}
          {desk.requests.rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6" aria-hidden />}
              title="Nobody has asked yet"
              description="Requests arrive through the link mailed from the public privacy page. A filed request appears here with the one next step it allows."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-brand-line text-left text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                    <th className="px-5 py-3">Person</th>
                    <th className="px-3 py-3">Standing</th>
                    <th className="px-5 py-3">Next step</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-line">
                  {desk.requests.rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={row.kind === "erasure" ? "danger" : "info"}>
                            {kindLabel(row.kind)}
                          </Badge>
                          <span className="font-semibold">{row.email}</span>
                        </div>
                        {row.note && (
                          <p className="mt-1.5 max-w-[26rem] whitespace-pre-wrap text-xs leading-relaxed text-brand-ink/55">
                            {row.note}
                          </p>
                        )}
                        <p className="mt-1.5 text-[11px] text-brand-ink/35">
                          filed {when(row.createdAt)}
                          {row.applicationId ? " · matched to an application" : " · no application matched yet"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <Badge tone={STATE_TONE[row.state]}>{privacyStateLabel(row.state)}</Badge>
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-brand-ink/45">
                          {row.verifiedAt && (
                            <p>
                              verified by {row.verifiedByName ?? "a member of staff"} ·{" "}
                              {when(row.verifiedAt)}
                            </p>
                          )}
                          {(row.decidedByName || row.decidedAt) && (
                            <p>
                              decided by {row.decidedByName ?? "a member of staff"} ·{" "}
                              {when(row.decidedAt)}
                            </p>
                          )}
                          {row.executedAt && <p>ran {when(row.executedAt)}</p>}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <RequestActions
                          row={row}
                          canVerify={canVerify}
                          canDecide={canDecide}
                          canExecute={canExecute}
                          pending={pending}
                          onAct={(action) => act(row, action)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Records inside a window"
          meta={
            desk.retentionCapped
              ? `oldest ${desk.retentionLimit} shown`
              : `${desk.retention.length} record${desk.retention.length === 1 ? "" : "s"}`
          }
        />
        {desk.retentionNote && (
          <p className="border-b border-brand-line bg-brand-sand/30 px-5 py-2.5 text-xs text-brand-ink/55">
            {desk.retentionNote}
          </p>
        )}
        {desk.retention.length === 0 ? (
          <EmptyState
            icon={<Eraser className="h-6 w-6" aria-hidden />}
            title="Nothing is inside a window"
            description="The view lists the oldest records first. When one enters its ordinary or talent-pool window it appears here, with the reason it is held if it cannot be erased."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-brand-line text-left text-[11px] font-bold uppercase tracking-[0.12em] text-brand-ink/40">
                  <th className="px-5 py-3">Person</th>
                  <th className="px-3 py-3">Last activity</th>
                  <th className="px-3 py-3">Window ends</th>
                  <th className="px-3 py-3">Standing</th>
                  <th className="px-3 py-3">Warning</th>
                  <th className="px-5 py-3">Hold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {desk.retention.map((row) => (
                  <RetentionRow key={`${row.applicationId}:${row.dueAt}:${row.warnedAt ?? ""}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function RequestActions({
  row,
  canVerify,
  canDecide,
  canExecute,
  pending,
  onAct,
}: {
  row: PrivacyRequestRow;
  canVerify: boolean;
  canDecide: boolean;
  canExecute: boolean;
  pending: boolean;
  onAct: (action: PrivacyRequestAction) => void;
}) {
  const [armed, setArmed] = useState(false);

  if (row.state === "RECEIVED") {
    return (
      <div className="flex flex-wrap gap-2">
        {canVerify ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onAct("verify")}>
            Verify
          </Button>
        ) : null}
        {canDecide ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onAct("decline")}>
            Decline
          </Button>
        ) : null}
        {!canVerify && !canDecide && <p className="text-xs text-brand-ink/45">Waiting on a recruiter.</p>}
      </div>
    );
  }

  if (row.state === "VERIFIED") {
    return (
      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <>
            <Button type="button" size="sm" disabled={pending} onClick={() => onAct("approve")}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onAct("decline")}>
              Decline
            </Button>
          </>
        ) : (
          <p className="text-xs text-brand-ink/45">Waiting on the owner to approve or decline.</p>
        )}
      </div>
    );
  }

  if (row.state === "APPROVED") {
    const erasure = row.kind === "erasure";
    if (!canExecute) {
      return <p className="text-xs text-brand-ink/45">Waiting on the owner to run it.</p>;
    }
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={armed ? "primary" : "outline"}
            disabled={pending}
            onClick={() => (armed ? onAct("execute") : setArmed(true))}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {armed
              ? erasure
                ? "Press again to erase"
                : "Press again to send"
              : erasure
                ? "Erase…"
                : "Send copy…"}
          </Button>
          {armed && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          )}
        </div>
        <p className="max-w-[15rem] text-[11px] leading-relaxed text-brand-ink/45">
          {erasure
            ? "Erasing removes the stored files and blanks the person's data. The application row, its stage, its scores and its dates stay."
            : "Sending mails a bounded copy of what is held to the address on the request."}
        </p>
      </div>
    );
  }

  return (
    <p className="text-xs text-brand-ink/40">
      {row.state === "EXECUTED" ? "Done. The trail keeps what ran, without the person." : "Declined. Nothing changed."}
    </p>
  );
}

function RetentionRow({ row }: { row: RetentionReview }) {
  const held = Boolean(row.blockedBy);
  const tone = held ? "neutral" : row.status === "due" ? "danger" : row.status === "warning" ? "gold" : "neutral";
  const standing = held ? "Held" : row.status === "due" ? "Due" : row.status === "warning" ? "In warning" : "Held";

  return (
    <tr className="align-top">
      <td className="px-5 py-4">
        <p className="font-semibold">{row.fullName}</p>
        <p className="text-xs text-brand-ink/45">{row.email ?? "no address on file"}</p>
        <Link
          href={`/candidates/${row.applicationId}`}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-gold-dark"
        >
          <FileSearch className="h-3 w-3" aria-hidden />
          Open the record
        </Link>
      </td>
      <td className="px-3 py-4 text-xs text-brand-ink/60">
        {when(row.lastActivityAt) ?? "unreadable"}
        <p className="mt-0.5 text-[11px] text-brand-ink/40">{row.stage.toLowerCase()}</p>
      </td>
      <td className="px-3 py-4 text-xs text-brand-ink/60">
        {when(row.dueAt) ?? "no date"}
        {row.poolGrantedAt && (
          <p className="mt-0.5 text-[11px] text-brand-ink/40">
            pool granted {when(row.poolGrantedAt)}
          </p>
        )}
      </td>
      <td className="px-3 py-4">
        <Badge tone={tone}>{standing}</Badge>
        {row.archived && <p className="mt-1 text-[11px] text-brand-ink/40">archived</p>}
      </td>
      <td className="px-3 py-4 text-xs text-brand-ink/60">
        {row.warnedAt ? when(row.warnedAt) : <span className="text-brand-ink/35">not warned</span>}
      </td>
      <td className="px-5 py-4 text-xs leading-relaxed text-brand-ink/55">
        {row.blockedBy ?? <span className="text-brand-ink/35">Nothing</span>}
      </td>
    </tr>
  );
}
