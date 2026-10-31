/**
 * Reading a paper before knowing whose it is.
 *
 * A mark is meant to measure the work, and a name sitting above the answers
 * changes what a person hears in them. This module holds the one rule that says
 * when a reviewer reads a paper by its handle instead of by who sat it, plus the
 * words every surface prints so the withheld name is a stated state rather than
 * a silently missing field.
 *
 * Pure, like the benchmark beside it: the reads decide *which* paper this is, this
 * file decides what a reviewer may see of the person behind it, and a screen and a
 * chat answer say the same thing about the same status.
 */

/**
 * A paper is read blind while its marks can still change.
 *
 * `GRADED` is where the marks stop — `resyncAttemptTotals` is the single rule both
 * graders go through, so the name returns the moment the last answer is scored,
 * whether the AI or a person put it there. `EXPIRED` is exempt on purpose: a
 * closed link will never be marked again, so blinding it would hide an identity
 * that no longer protects anything, and a recruiter following up on a candidate
 * who never finished would be left with a code and no way to ask who it was.
 *
 * Anything else — not started, sitting now, answered — is a paper in play. An
 * unknown future status is treated as in play too, which fails toward hiding.
 */
export function isIdentityBlind(status: string, blindMarking: boolean): boolean {
  if (!blindMarking) return false;
  return status !== "GRADED" && status !== "EXPIRED";
}

/**
 * What a blind paper is called instead: its tracking code.
 *
 * The application's own `SDG-…` handle, which is already on the record, already
 * unique, and already what a candidate quotes when they call about their
 * application — so a reviewer can say "paper SDG-K7M2XQ4B scored 31 of 40" in a
 * conversation that survives after the name comes back. Initials were the other
 * option and are not good enough: two candidates called "Ahmed Hassan" and "Amany
 * Hamdi" would collapse into the same label, and a label that cannot tell two
 * papers apart cannot be quoted.
 */
export function blindHandle(trackingCode: string | null | undefined): string {
  const code = (trackingCode ?? "").trim();
  return code ? `Candidate ${code}` : "Candidate — name withheld";
}

/**
 * Why the name is missing, in one line, on screen.
 *
 * Same discipline as the benchmark note: a recruiter must be able to tell that
 * this is a rule being applied, not data that went missing. It also states the
 * limit rather than over-claiming — blinding the *label* is not the same as
 * anonymising the *work*, and a video pitch or a first-person answer says who
 * sat the paper far more convincingly than a name ever did.
 */
export function blindMarkingNote(): string {
  return "Blind marking is on, so this paper is carried by its tracking code while its marks can still change; the name returns when the last mark is saved. The answers themselves are not anonymised — a typed answer or a recording can still say or show who sat it — and opening their record names them whenever you need it.";
}
