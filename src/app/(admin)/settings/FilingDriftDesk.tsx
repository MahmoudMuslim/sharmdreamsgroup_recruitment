"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Badge, Button } from "@/modules/analytics/presentation/ui";
import { Select } from "@/modules/analytics/presentation/Form";
import { refileFiling } from "@/app/(admin)/jobs/job-actions";
import { MASTER_ONE_WORDS } from "@/modules/settings/domain/masterDataLists";
import { noDriftSentence, type FiledEntity } from "@/modules/settings/domain/masterDataFiling";
import type { DriftCard } from "@/modules/jobs/application/filingVocabularies";

const STATE_WORDS: Record<DriftCard["state"], string> = {
  spelling: "different spelling",
  retired: "retired row",
  off_list: "not in the list",
};

const STATE_TONE: Record<DriftCard["state"], "neutral" | "gold" | "danger"> = {
  spelling: "neutral",
  retired: "gold",
  off_list: "danger",
};

/** One group: the value, the roles carrying it, and the row to move them onto. */
function DriftRow({
  card,
  index,
  choices,
  onDone,
}: {
  card: DriftCard;
  index: number;
  choices: { value: string; label: string }[];
  onDone: (message: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const entity = card.entity;
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();

  // The row a refile would move *onto* is never the value being moved off, so the
  // desk leaves it out rather than offering a move that the action refuses.
  const offered = choices.filter((choice) => choice.value !== card.source);

  function refile() {
    if (!target) return;
    startTransition(async () => {
      const result = await refileFiling(entity, card.source, target);
      if (result.ok) {
        onDone(result.note ?? "Moved.", true);
        router.refresh();
      } else {
        onDone(result.error ?? "Nothing was moved.", false);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {card.count} {card.count === 1 ? "opening" : "openings"}
          <Badge tone={STATE_TONE[card.state]}>{STATE_WORDS[card.state]}</Badge>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">{card.line}</p>
        <p className="mt-1 text-xs text-brand-ink/50">
          {card.openings.map((job) => `${job.title} (${job.status})`).join(", ")}
          {card.hidden > 0 ? `, … and ${card.hidden} more` : ""}
        </p>
      </div>

      {offered.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          <Select
            id={`refile-${entity}-${index}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="max-w-[15rem]"
          >
            <option value="">File them under…</option>
            {offered.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={refile} disabled={!target || pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Refile
          </Button>
        </div>
      ) : (
        <p className="shrink-0 text-xs text-brand-ink/50">
          The list holds no row in use to move them onto — add one above first.
        </p>
      )}
    </li>
  );
}

/**
 * The openings this vocabulary does not speak.
 *
 * `job_openings` stores a department, a location and a currency as free text, so
 * the seeds filed roles under "Finance" while the list spelled the row "Finance &
 * Investment". #287 closed that door for new writes; this is what is already
 * behind it — including the values an applicant reads as two departments on the
 * public board. Nothing here guesses which row a stranger was meant to be: the
 * desk names the roles, and the recruiter chooses where they go.
 *
 * The cards come from `readFilingDrift`, the same read the assistant answers from,
 * so the figure on this screen and the one in a chat reply cannot drift apart.
 */
export function FilingDriftDesk({
  entity,
  cards,
  choices,
  openings,
  note,
  warning,
  error,
}: {
  entity: FiledEntity;
  cards: DriftCard[];
  /** The live rows of this list — one copy for every card, as the read sends them. */
  choices: { value: string; label: string }[];
  openings: number;
  note: string;
  warning: string | null;
  error: string | null;
}) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const one = MASTER_ONE_WORDS[entity];
  const counted = !error && !warning;

  return (
    <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
      <header className="mb-3 flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
        <div>
          <p className="font-display text-base font-bold">
            {counted && cards.length === 0
              ? `Every opening files a real ${one}`
              : `Openings filed against the ${one} list`}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-ink/50">
            Every opening this account can see was checked against the {one} list below this
            screen, as written. A value listed here is why the careers board offers applicants a
            choice the list does not hold, and why the openings grid prints one on a role.
            Refiling moves the named openings in one write and records it in the change trail.
          </p>
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </p>
      )}
      {!error && warning && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {warning}
        </p>
      )}
      {message && (
        <p
          className={
            message.ok
              ? "mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
              : "mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
          }
        >
          {message.text}
        </p>
      )}

      {counted && cards.length === 0 && (
        <p className="rounded-xl border border-dashed border-brand-line bg-brand-cream px-4 py-6 text-center text-sm text-brand-ink/50">
          {noDriftSentence(openings)}
        </p>
      )}

      {counted && cards.length > 0 && (
        <>
          <p className="mb-2 text-xs text-brand-ink/50">{note}</p>
          <ul className="divide-y divide-brand-line rounded-xl border border-brand-line">
            {cards.map((card, index) => (
              <DriftRow
                key={`${card.state}\u0000${card.source}`}
                card={card}
                index={index}
                choices={choices}
                onDone={(text, ok) => setMessage({ text, ok })}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
