"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Clock,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Scale,
  Search,
  Send,
  Table2,
  Video,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import { TextInput } from "@/modules/analytics/presentation/Form";
import { Badge, Card, EmptyState, FilterRail } from "@/modules/analytics/presentation/ui";
import { formatInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { getAttemptAnswers, type IssuedLinksRead } from "./actions";
import {
  LINK_RAILS,
  linkHasAnswers,
  linkProgressWord,
  linkSearchWords,
  linkStatusWord,
  searchLinks,
  linksReadNote,
  type IssuedLink,
  type LinkRail,
} from "@/modules/assessment/domain/issuedLinks";
import {
  answerStateWord,
  answersScopeNote,
  durationWord,
  type AttemptAnswer,
  type AttemptAnswers,
} from "@/modules/assessment/domain/attemptAnswers";
import { blindMarkingNote } from "@/modules/assessment/domain/blindMarking";

const TYPE_META: Record<string, { word: string; icon: LucideIcon }> = {
  MULTIPLE_CHOICE: { word: "Quiz", icon: Check },
  CASE_STUDY: { word: "Case study", icon: FileText },
  EXCEL_MODEL: { word: "Spreadsheet model", icon: Table2 },
  VIDEO_PITCH: { word: "Video pitch", icon: Video },
  SITUATIONAL_JUDGMENT: { word: "Judgment scene", icon: Scale },
};

function statusTone(status: string): "neutral" | "gold" | "success" | "danger" | "info" {
  switch (status) {
    case "GRADED":
      return "success";
    case "SUBMITTED":
      return "info";
    case "IN_PROGRESS":
      return "gold";
    case "EXPIRED":
      return "danger";
    default:
      return "neutral";
  }
}

const DAY_AND_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DAY_ONLY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/* -------------------------------------------------------------------------- */
/* The board                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every link the pipeline holds, newest first.
 *
 * The rails count the rows this render carries and the note under the table says
 * how many that is, so a chip never counts a link the board below it cannot show.
 * A filed-away candidate's links are left out by the read — this is the same rule
 * every other staff surface follows.
 */
export function IssuedLinksBoard({
  read,
  timeZone,
}: {
  read: IssuedLinksRead;
  /** `organisation.timezone`, so a deadline reads on the group's clock. */
  timeZone: string;
}) {
  const [rail, setRail] = useState<LinkRail>("ALL");
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState<IssuedLink | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>([["ALL", read.rows.length]]);
    for (const row of read.rows) map.set(row.status, (map.get(row.status) ?? 0) + 1);
    return map;
  }, [read.rows]);

  const filtered = useMemo(() => {
    // Widened to `readonly string[]` because the rails are a const tuple — the
    // `All links` entry holds no statuses at all, so its element type on its own
    // is `never` and a row could never be tested against it.
    const statuses: readonly string[] =
      LINK_RAILS.find((entry) => entry.key === rail)?.statuses ?? [];
    const inRail =
      statuses.length === 0 ? read.rows : read.rows.filter((row) => statuses.includes(row.status));
    return searchLinks(inRail, query);
  }, [read.rows, rail, query]);

  const answered = read.rows.filter((row) => linkHasAnswers(row)).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-brand-line px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="inline-flex items-center gap-2 font-display text-lg font-bold">
              <Send className="h-4 w-4 text-brand-gold-dark" aria-hidden />
              Issued links
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">
              {read.total === 0
                ? "No candidate holds a test link yet."
                : `${read.total.toLocaleString()} link${
                    read.total === 1 ? "" : "s"
                  } on file · ${answered.toLocaleString()} with answers to read`}
              {read.scores_masked && " · marks are hidden for your role"}
              {read.blind_marking && " · blind marking is on, so an ungraded paper carries its tracking code"}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/35"
              aria-hidden
            />
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search by ${linkSearchWords()}…`}
              aria-label="Search issued links"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {LINK_RAILS.map((entry) => (
            <FilterRail
              key={entry.key}
              label={entry.label}
              count={counts.get(entry.key) ?? 0}
              active={rail === entry.key}
              onClick={() => setRail(entry.key)}
            />
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={read.rows.length === 0 ? "No links issued" : "No links match"}
          description={
            read.rows.length === 0
              ? "Assign a suite from one of the cards above; each candidate gets a private link and lands here."
              : `Nothing on this board matches the ${
                  rail === "ALL"
                    ? "search"
                    : `“${LINK_RAILS.find((entry) => entry.key === rail)?.label ?? rail}” rail`
                }${query.trim() ? ` and “${query.trim()}”` : ""}.`
          }
          icon={<Send className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-12 gap-x-4 border-b border-brand-line bg-brand-cream px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-brand-ink/45 sm:px-6">
              <span className="col-span-3">Candidate</span>
              <span className="col-span-3">Suite</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-2">Answers</span>
              <span className="col-span-1">Score</span>
              <span className="col-span-1 text-right">Read</span>
            </div>

            <ul className="divide-y divide-brand-line">
              {filtered.map((link) => (
                <li
                  key={link.id}
                  className="grid grid-cols-12 items-center gap-x-4 px-5 py-3 text-sm transition hover:bg-brand-cream sm:px-6"
                >
                  <div className="col-span-3 min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/candidates/${link.application_id}`}
                        className="truncate font-semibold text-brand-ink underline-offset-2 hover:underline"
                      >
                        {link.candidate_name}
                      </Link>
                      {link.identity_blind && <Badge tone="neutral">Blind</Badge>}
                    </span>
                    <p className="truncate text-[11px] text-brand-ink/50">
                      {link.job_title ?? "No role named"} · sent{" "}
                      {formatInZone(link.issued_at, timeZone, DAY_ONLY)}
                    </p>
                  </div>

                  <div className="col-span-3 min-w-0">
                    <p className="truncate font-semibold">{link.template_name}</p>
                    <p className="truncate text-[11px] text-brand-ink/50">
                      {link.time_limit_minutes > 0
                        ? `${link.time_limit_minutes} min · `
                        : ""}
                      {link.expires_at
                        ? `closes ${formatInZone(link.expires_at, timeZone, DAY_AND_TIME)}`
                        : "no deadline recorded"}
                    </p>
                  </div>

                  <div className="col-span-2">
                    <Badge tone={statusTone(link.status)}>{linkStatusWord(link.status)}</Badge>
                    {link.status === "EXPIRED" && (
                      <p className="mt-1 text-[10px] text-brand-ink/45">
                        A deadline that ran out and a revoked link look the same here.
                      </p>
                    )}
                  </div>

                  <div className="col-span-2 min-w-0">
                    <p className="text-xs font-semibold text-brand-ink/70">
                      {linkProgressWord(link)}
                    </p>
                    {link.integrity_flags > 0 && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-800">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {link.integrity_flags} signal{link.integrity_flags === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>

                  <div className="col-span-1 text-xs font-bold tabular-nums">
                    {read.scores_masked
                      ? "Hidden"
                      : link.score === null
                        ? "—"
                        : `${link.score}${link.max_score ? `/${link.max_score}` : ""}`}
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setReading(link)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      {linkHasAnswers(link) ? "Answers" : "Paper"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className="border-t border-brand-line bg-brand-cream px-5 py-3 text-[11px] leading-relaxed text-brand-ink/60 sm:px-6">
        {linksReadNote(read.total, read.rows.length, query.trim() || null)}
      </p>

      {reading && (
        <AnswersDrawer link={reading} timeZone={timeZone} onClose={() => setReading(null)} />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* The answers desk                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Read one paper, turning both failure kinds into a sentence.
 *
 * A missing attempt and a refused call both leave the drawer with nothing to
 * show, but only one of them is the recruiter's problem to solve, so the two
 * say different things rather than the same "could not load".
 */
async function readAnswers(
  attemptId: string
): Promise<{ paper: AttemptAnswers | null; note: string | null }> {
  try {
    const paper = await getAttemptAnswers(attemptId);
    return paper
      ? { paper, note: null }
      : { paper: null, note: "That link is no longer on file." };
  } catch {
    return { paper: null, note: "The answers could not be read." };
  }
}

/**
 * One candidate's paper, question by question and answer by answer.
 *
 * Read on open rather than shipped with the page: a paper is a suite's worth of
 * full answers, transcripts and signed recordings, and 300 rows of the board do
 * not need any of that to be listed. `candidate_responses` is not on the live
 * channel, so the re-read button is what makes a fresh submission visible without
 * reloading the whole page.
 */
export function AnswersDrawer({
  link,
  timeZone,
  onClose,
}: {
  link: IssuedLink;
  timeZone: string;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<AttemptAnswers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Re-read: the answers live in a table the live channel does not
  // watch, so a second read is the only way to see work done after the open.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void readAnswers(link.id).then((outcome) => {
      if (!active) return;
      // A failed re-read keeps the paper already on screen — the recruiter was
      // reading real answers, and a lost connection should not erase them.
      if (outcome.paper) setPaper(outcome.paper);
      setError(outcome.note);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [link.id, reloadKey]);

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      eyebrow={link.template_name}
      title={`${link.candidate_name} — question by question`}
      subtitle={
        link.job_title
          ? `${link.job_title} · ${linkStatusWord(link.status)}`
          : linkStatusWord(link.status)
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-brand-ink/55">
            {paper?.scores_masked
              ? "Marks are hidden for your role; the answers are still here."
              : "Marks shown as they stand on the record."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setReloadKey((key) => key + 1);
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                aria-hidden
              />
              Re-read
            </button>
            <Link
              href={`/candidates?application=${link.application_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-xs font-semibold text-brand-cream shadow-soft transition hover:bg-brand-ink/90"
            >
              Award marks on their report
            </Link>
          </div>
        </div>
      }
    >
      {loading && !paper && (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-ink/50">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Reading the paper…
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {paper && (
        <div className="space-y-4">
          {/* The withheld name is stated, not left as a code-shaped gap: a
              recruiter must be able to tell a rule being applied from data that
              went missing. */}
          {paper.identity_blind && (
            <p className="rounded-xl border border-brand-line px-4 py-3 text-xs leading-relaxed text-brand-ink/65">
              {blindMarkingNote()}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-brand-cream px-4 py-3 sm:grid-cols-4">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                Status
              </dt>
              <dd className="mt-0.5 text-sm font-bold">{linkStatusWord(paper.status)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                Answers
              </dt>
              <dd className="mt-0.5 text-sm font-bold">
                {paper.answered} of {paper.questions}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                Score
              </dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums">
                {paper.scores_masked
                  ? "Hidden"
                  : paper.score === null
                    ? "Not marked"
                    : `${paper.score}${paper.max_score ? ` / ${paper.max_score}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                {paper.submitted_at ? "Submitted" : paper.expires_at ? "Closes" : "Sent"}
              </dt>
              <dd className="mt-0.5 text-sm font-bold">
                {formatInZone(
                  paper.submitted_at ?? paper.expires_at ?? paper.started_at ?? link.issued_at,
                  timeZone,
                  DAY_AND_TIME
                )}
              </dd>
            </div>
          </dl>

          {/* The rank and the count it came from, always together — the note is
              written from the three figures, so a small population prints the
              number found and no percentile rather than an em dash. */}
          {paper.benchmark && (
            <p className="rounded-xl bg-brand-cream px-4 py-3 text-xs leading-relaxed text-brand-ink/65">
              {paper.benchmark.note}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-brand-ink/60">{answersScopeNote(paper)}</p>

          {paper.answers.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              The suite this link was issued from has no questions, so the candidate was sent an
              empty test.
            </p>
          ) : (
            <ol className="space-y-3">
              {paper.answers.map((answer, index) => (
                <AnswerCard
                  key={answer.question_id}
                  answer={answer}
                  index={index}
                  masked={paper.scores_masked}
                  savedAt={
                    answer.saved_at ? formatInZone(answer.saved_at, timeZone, DAY_AND_TIME) : null
                  }
                />
              ))}
            </ol>
          )}

          <p className="rounded-xl border border-brand-line px-4 py-3 text-[11px] leading-relaxed text-brand-ink/55">
            Handing back a sheet unchanged and leaving a field empty are listed apart from each
            other, and a quiz answer is shown as the wording this candidate saw rather than the
            handle the database keeps. Recordings play through a link that expires in an hour.
          </p>
        </div>
      )}
    </Drawer>
  );
}

function AnswerCard({
  answer,
  index,
  masked,
  savedAt,
}: {
  answer: AttemptAnswer;
  index: number;
  masked: boolean;
  savedAt: string | null;
}) {
  const meta = TYPE_META[answer.question_type];
  const Icon = meta?.icon ?? FileText;

  // A judgment scene is ranked by effectiveness, not decided by one key, so the
  // desk marks its strongest response rather than a "correct" one.
  const bestJudgment =
    answer.question_type === "SITUATIONAL_JUDGMENT"
      ? answer.options.reduce<number | null>(
          (top, option) => (option.score === null ? top : Math.max(top ?? 0, option.score)),
          null
        )
      : null;

  return (
    <li
      className={cn(
        "rounded-xl border p-4",
        answer.answered ? "border-brand-line bg-white" : "border-brand-line bg-brand-cream/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
            Question {index + 1}
            {meta ? ` · ${meta.word}` : ` · ${answer.question_type}`}
          </p>
          <h3 className="mt-0.5 text-sm font-bold leading-snug">{answer.title}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            tone={
              masked || answer.score === null || !answer.max_score
                ? "neutral"
                : answer.score >= answer.max_score
                  ? "success"
                  : answer.score === 0
                    ? "danger"
                    : "gold"
            }
          >
            {masked
              ? "Hidden"
              : answer.score === null
                ? "Not marked"
                : `${answer.score}/${answer.max_score ?? answer.points}`}
          </Badge>
          <span className="text-[10px] text-brand-ink/45">
            {answer.points} point{answer.points === 1 ? "" : "s"} this paper carries
          </span>
        </div>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/75">
        {answer.prompt}
      </p>
      {answer.instructions && (
        <p className="mt-1.5 text-xs italic leading-relaxed text-brand-ink/55">
          {answer.instructions}
        </p>
      )}
      {answer.context && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink/60">
            The case they were given
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-brand-cream p-3 text-xs leading-relaxed text-brand-ink/65">
            {answer.context}
          </p>
        </details>
      )}

      <div className="mt-3 border-t border-brand-line pt-3">
        <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          What {answer.answered ? "they put in it" : "is on file"} — {answerStateWord(answer)}
          {savedAt && <span className="font-normal normal-case tracking-normal">· {savedAt}</span>}
        </p>

        {answer.question_type === "MULTIPLE_CHOICE" && answer.options.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {answer.options.map((option) => (
              <li
                key={option.label}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                  option.chosen && option.correct && "border-emerald-300 bg-emerald-50",
                  option.chosen && !option.correct && "border-rose-300 bg-rose-50",
                  !option.chosen && option.correct && "border-brand-line bg-brand-cream",
                  !option.chosen && !option.correct && "border-brand-line bg-white"
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {option.chosen ? (
                    <CircleDot
                      className={cn("h-4 w-4", option.correct ? "text-emerald-700" : "text-rose-700")}
                      aria-hidden
                    />
                  ) : option.correct ? (
                    <Check className="h-4 w-4 text-emerald-700" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-brand-ink/25" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug">{option.text}</span>
                  <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                    {option.chosen && option.correct
                      ? "Their pick — and the key"
                      : option.chosen
                        ? "Their pick — not the key"
                        : option.correct
                          ? "The key, unpicked"
                          : "Not chosen"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {answer.question_type === "MULTIPLE_CHOICE" && answer.options.length === 0 && (
          <p className="mt-2 text-xs text-brand-ink/55">
            This quiz question holds no options, so the runner could not mark it either.
          </p>
        )}

        {answer.question_type === "SITUATIONAL_JUDGMENT" && answer.options.length > 0 && (
          <div className="mt-2 space-y-2">
            <ul className="space-y-1.5">
              {answer.options.map((option) => {
                const isBest = bestJudgment !== null && option.score === bestJudgment;
                return (
                  <li
                    key={option.label}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      option.chosen && isBest && "border-emerald-300 bg-emerald-50",
                      option.chosen && !isBest && "border-amber-300 bg-amber-50",
                      !option.chosen && isBest && "border-brand-line bg-brand-cream",
                      !option.chosen && !isBest && "border-brand-line bg-white"
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      {option.chosen ? (
                        <CircleDot
                          className={cn(
                            "h-4 w-4",
                            isBest ? "text-emerald-700" : "text-amber-700"
                          )}
                          aria-hidden
                        />
                      ) : isBest ? (
                        <Check className="h-4 w-4 text-emerald-700" aria-hidden />
                      ) : (
                        <span className="block h-4 w-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block leading-snug">{option.text}</span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums text-[11px] font-semibold",
                            isBest ? "text-emerald-700" : "text-brand-ink/45"
                          )}
                        >
                          {option.score === null ? "not scored" : `${option.score}%`}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                        {option.chosen && isBest
                          ? "Their pick — the strongest response"
                          : option.chosen
                            ? "Their pick"
                            : isBest
                              ? "Most effective response, unpicked"
                              : "Not chosen"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] leading-relaxed text-brand-ink/45">
              No response is simply right or wrong: each earns its percentage of the marks, and
              the strongest response is marked.
            </p>
          </div>
        )}

        {answer.question_type === "SITUATIONAL_JUDGMENT" && answer.options.length === 0 && (
          <p className="mt-2 text-xs text-brand-ink/55">
            This judgment scene holds no responses, so there was nothing for the candidate to
            pick.
          </p>
        )}

        {answer.answer_text && (
          <div className="mt-2 rounded-lg border border-brand-line bg-white p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-ink/80">
              {answer.answer_text}
            </p>
            {answer.words !== null && (
              <p className="mt-2 text-[11px] text-brand-ink/45">
                {answer.words} word{answer.words === 1 ? "" : "s"}
                {answer.min_words ? ` — the question asked for at least ${answer.min_words}` : ""}
              </p>
            )}
          </div>
        )}

        {answer.question_type === "EXCEL_MODEL" && (
          <div className="mt-2 space-y-2">
            {answer.cells.length > 0 ? (
              <ul className="divide-y divide-brand-line overflow-hidden rounded-lg border border-brand-line">
                {answer.cells.map((cell) => (
                  <li key={cell.ref} className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
                    <span className="w-12 shrink-0 font-mono font-bold text-brand-ink/60">
                      {cell.ref}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{cell.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-brand-ink/55">
                Every cell they were handed is still as it was given.
              </p>
            )}
            {answer.expected.length > 0 && (
              <div className="rounded-lg bg-brand-cream p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
                  What the model was asked to produce
                </p>
                <ul className="mt-1.5 space-y-1">
                  {answer.expected.map((output) => (
                    <li key={output.ref} className="text-xs leading-relaxed text-brand-ink/65">
                      <span className="font-mono font-bold">{output.ref}</span> —{" "}
                      {output.description}
                      {output.formula_hint && (
                        <span className="text-brand-ink/45"> (hint: {output.formula_hint})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {answer.video_url && (
          <div className="mt-2 space-y-2">
            <video
              src={answer.video_url}
              controls
              preload="none"
              className="aspect-video w-full rounded-lg bg-black"
            />
            <p className="inline-flex items-center gap-1.5 text-[11px] text-brand-ink/55">
              <Play className="h-3 w-3" aria-hidden />
              {durationWord(answer.duration_seconds)
                ? `Recorded length ${durationWord(answer.duration_seconds)}`
                : "A recording is on file; its length was not stored."}
            </p>
          </div>
        )}

        {answer.transcript ? (
          <details className="mt-2" open={!answer.video_url}>
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-brand-ink/40 hover:text-brand-ink/60">
              Transcript in full
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-brand-cream p-3 text-xs leading-relaxed text-brand-ink/70">
              {answer.transcript}
            </p>
          </details>
        ) : answer.video_url ? (
          <p className="mt-2 text-[11px] text-brand-ink/45">
            Nothing has been transcribed from this recording yet.
          </p>
        ) : null}

        {!answer.answered && answer.question_type !== "EXCEL_MODEL" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-ink/55">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            No answer of any kind is recorded against this question.
          </p>
        )}
      </div>

      {(answer.rationale || answer.strengths.length > 0 || answer.improvements.length > 0) && (
        <div className="mt-3 border-t border-brand-line pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-ink/45">
            {answer.awarded_by === "STAFF"
              ? "Verdict — awarded by a person"
              : answer.awarded_by === "AI"
                ? "Verdict — awarded by the AI"
                : "Feedback on file"}
          </p>
          {answer.rationale && (
            <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/70">{answer.rationale}</p>
          )}
          {answer.strengths.length > 0 && (
            <ul className="mt-2 space-y-1">
              {answer.strengths.map((strength) => (
                <li key={strength} className="flex items-start gap-1.5 text-xs text-emerald-800">
                  <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  {strength}
                </li>
              ))}
            </ul>
          )}
          {answer.improvements.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {answer.improvements.map((improvement) => (
                <li key={improvement} className="flex items-start gap-1.5 text-xs text-amber-800">
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500"
                    aria-hidden
                  />
                  {improvement}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
