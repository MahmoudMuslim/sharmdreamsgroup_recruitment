"use client";

import Link from "next/link";
import {
  Badge,
  Meter
} from "@/modules/analytics/presentation/ui";
import type {
  DashboardCandidate
} from "@/types";
import { prettyStage, shortDate, stageTone } from "./DashboardBits";

export function CandidateRow({ candidate, masked }: { candidate: DashboardCandidate; masked: boolean }) {
  return (
    <tr className="transition hover:bg-brand-cream">
      <td className="py-3.5 pl-6 pr-4">
        <Link
          href={`/candidates/${candidate.application_id}`}
          className="font-semibold hover:text-brand-gold-dark hover:underline"
        >
          {candidate.full_name}
        </Link>
        <p className="text-[11px] uppercase tracking-wide text-brand-ink/40">
          {prettyStage(candidate.source)} · {shortDate(candidate.applied_at)}
        </p>
      </td>
      <td className="px-4 py-3.5 text-brand-ink/60">
        <p>{candidate.job_title || "—"}</p>
        {candidate.department && (
          <p className="text-[11px] text-brand-ink/40">{candidate.department}</p>
        )}
      </td>
      <td className="px-4 py-3.5">
        <Badge tone={stageTone(candidate.stage)}>{prettyStage(candidate.stage)}</Badge>
      </td>
      <td className="px-4 py-3.5 text-xs text-brand-ink/55">{shortDate(candidate.applied_at)}</td>
      <td className="px-4 py-3.5">
        {masked ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
            Hidden
          </span>
        ) : (
          <div className="flex w-28 items-center gap-2">
            <span className="w-9 text-right font-display font-bold text-brand-gold-dark">
              {candidate.match_score === null ? "0" : `${candidate.match_score}%`}
            </span>
            <Meter value={candidate.match_score ?? 0} className="flex-1" />
          </div>
        )}
      </td>
      <td className="py-3.5 pl-4 pr-6">
        {masked ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink/35">
            Hidden
          </span>
        ) : candidate.has_assessment ? (
          <span className="font-display font-bold">{candidate.assessment_score ?? "—"}</span>
        ) : (
          <span className="text-xs text-brand-ink/35">Pending</span>
        )}
      </td>
    </tr>
  );
}
