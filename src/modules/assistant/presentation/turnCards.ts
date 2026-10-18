/**
 * Which cards a turn owes the recruiter, and what its bubble says.
 *
 * The chat used to show one card per turn — the last one — so a Qoder agent that
 * asked a question and then held a change in the same turn had its question
 * erased from the screen, which read as a control that failed to load. Both
 * engines raise cards differently: the gateway stops at the first, the agent can
 * raise several and keep talking, so the rule lives in one place and is applied
 * to whatever the turn actually contains.
 */
import type { AssistantQuestion } from "../domain/tools";
import type { AssistantStep } from "../infrastructure/agent";

/**
 * The line the server prints between a question and the numbered list it feeds
 * the model back — see `questionAsReply` in `domain/tools`. Matching on it tells
 * the chat whether the reply on screen is a card's own print, in which case the
 * card carries the question and the list stays out of the bubble, or prose the
 * agent wrote beside a card, which has to survive next to the buttons.
 *
 * A copy of the server's wording rather than an import: that module is the tool
 * registry and must not ride to the browser for one string. If the format ever
 * changes, the worst outcome here is a numbered list printed above its own
 * buttons — not a lost answer.
 */
const CHOICES_IN_REPLY = "Choose one:";

export interface TurnCards {
  /** Every card this turn raised, in the order it raised them. */
  cards: AssistantStep[];
  /** A question already printed in the bubble, so its card does not repeat it. */
  bubbleAsk: AssistantQuestion | null;
  /** The choices this turn put on offer, for marking which one was picked. */
  asks: AssistantQuestion[];
  /** A live turn that asked a question and has nothing to click. */
  needsTypedAnswer: boolean;
}

export function cardsOfTurn(
  text: string,
  steps: AssistantStep[] | undefined,
  live: boolean
): TurnCards {
  const all = steps ?? [];
  const cards = all.filter((step) => step.ask !== undefined || step.approval !== undefined);
  const asks = cards
    .map((step) => step.ask)
    .filter((ask): ask is AssistantQuestion => ask !== undefined);

  const printedChoices = text.includes(CHOICES_IN_REPLY);
  const bubbleAsk = printedChoices ? (asks[asks.length - 1] ?? null) : null;

  // Two ways a question reaches the screen without buttons: the tool refused the
  // choices it was handed, or the model wrote the question into its prose instead
  // of calling the tool. Either way the panel says so rather than looking broken.
  const refused = all.some((step) => step.tool === "ask_question" && !step.ask && !step.ok);

  return {
    cards,
    bubbleAsk,
    asks,
    needsTypedAnswer: live && asks.length === 0 && (printedChoices || refused),
  };
}
