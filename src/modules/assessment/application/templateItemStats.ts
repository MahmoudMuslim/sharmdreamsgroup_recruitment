import "server-only";

import { createServerRestClient } from "@/lib/data-api/server";
import {
  itemStatisticsOf,
  type ItemResponseRow,
  type ItemStatistics,
} from "@/modules/assessment/domain/itemStats";

/** The server client every read in this module is handed, rather than built twice. */
type ServerClient = Awaited<ReturnType<typeof createServerRestClient>>;

/**
 * The most papers and answers one suite read will rank.
 *
 * Both figures are per suite, so a busy test is a few hundred papers and a few
 * thousand answers — well inside these. They exist because the read pulls rows
 * rather than counts (a percentage needs the marks themselves, not a head), and an
 * unbounded pull is the mistake the paged console reads were made to stop. When a
 * ceiling is hit the read says so on screen instead of describing a slice of the
 * suite as if it were the whole thing.
 */
const PAPER_CEILING = 1000;
const ANSWER_CEILING = 5000;

/** One question's figures, with the title the suite already stores for it. */
export type TemplateItemStat = ItemStatistics & { title: string };

export interface TemplateItemStats {
  /** Every question in the suite, in suite order — including one nobody answered. */
  items: TemplateItemStat[];
  /** Graded papers the two halves were cut from, as the statistics module saw them. */
  papers: number;
  /** Graded answers the read pulled, and the number the suite actually holds. */
  answers: { read: number; on_file: number };
  /** True when a ceiling stopped the read, so the figures cover part of the suite. */
  partial: boolean;
}

/**
 * Per-question difficulty and discrimination for one suite.
 *
 * Three bounded reads, joined in memory: the suite's questions (so an item nobody
 * answered still appears), its papers (so each answer's author can be placed
 * against the rest), and its graded answers. The answers are filtered by question
 * rather than by paper, which keeps the request a short list of this suite's ids
 * instead of a URL holding every attempt id the suite ever produced.
 *
 * Returns null for a suite that does not exist or that this caller cannot see —
 * RLS answers both with no rows, and an empty table drawn as "no data" would be a
 * claim about a suite the reviewer was never allowed to open.
 *
 * The caller skips this entirely under `security.mask_scores_for_reviewers`: an
 * item's difficulty and its top-versus-bottom gap are both statements about other
 * candidates' marks, which is exactly what that setting withholds.
 */
export async function readTemplateItemStats(
  restClient: ServerClient,
  templateId: string
): Promise<TemplateItemStats | null> {
  const { data: questionRows, error: questionError } = await restClient
    .from("assessment_questions")
    .select("id, title, position")
    .eq("template_id", templateId)
    .order("position");

  if (questionError) throw questionError;

  const questions = (questionRows ?? []) as unknown as {
    id: string;
    title: string | null;
    position: number | null;
  }[];
  if (questions.length === 0) {
    // Nothing to group answers under. An empty suite is reported as such by the
    // drawer, and running two more reads to prove it would be two reads for nothing.
    return null;
  }

  const [{ data: paperRows, count: paperCount }, { data: answerRows, count: answerCount }] =
    await Promise.all([
      restClient
        .from("candidate_attempts")
        .select("id, total_score, max_score", { count: "exact" })
        .eq("template_id", templateId)
        .eq("status", "GRADED")
        .limit(PAPER_CEILING),
      restClient
        .from("candidate_responses")
        .select("question_id, attempt_id, score, max_score", { count: "exact" })
        .in(
          "question_id",
          questions.map((question) => question.id)
        )
        .not("score", "is", null)
        .limit(ANSWER_CEILING),
    ]);

  const papers = new Map(
    ((paperRows ?? []) as unknown as {
      id: string;
      total_score: number | string | null;
      max_score: number | string | null;
    }[]).map((row) => [
      row.id,
      {
        total: row.total_score === null ? null : Number(row.total_score),
        max: row.max_score === null ? null : Number(row.max_score),
      },
    ])
  );

  const rows: ItemResponseRow[] = ((answerRows ?? []) as unknown as {
    question_id: string;
    attempt_id: string;
    score: number | string | null;
    max_score: number | string | null;
  }[]).map((row) => {
    // An answer on a paper this read did not receive keeps its own marks (they are
    // still a graded answer) but no placement: inventing a paper total would put a
    // candidate in a half they were never ranked into.
    const paper = papers.get(row.attempt_id);
    return {
      question_id: row.question_id,
      attempt_id: row.attempt_id,
      score: row.score === null ? null : Number(row.score),
      max_score: row.max_score === null ? null : Number(row.max_score),
      attempt_total: paper?.total ?? null,
      attempt_max: paper?.max ?? null,
    };
  });

  const titles = new Map(questions.map((question) => [question.id, question.title]));
  const items = itemStatisticsOf(
    questions.map((question) => question.id),
    rows
  ).map((item) => ({ ...item, title: titles.get(item.question_id) ?? "Untitled question" }));

  const answersRead = rows.length;
  const papersRead = papers.size;
  return {
    items,
    papers: items[0]?.papers ?? 0,
    answers: { read: answersRead, on_file: answerCount ?? answersRead },
    // A ceiling that stopped either read means these figures describe part of the
    // suite, and the drawer has to say so rather than imply the whole thing.
    partial: (answerCount ?? answersRead) > answersRead || (paperCount ?? papersRead) > papersRead,
  };
}
