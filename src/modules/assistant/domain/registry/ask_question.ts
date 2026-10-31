// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  MAX_OPTIONS,
  MAX_OPTION_CHARS,
  questionFrom,
} from "./shared";

/* Questions tools. */

export const ask_question: readonly AssistantTool[] = [
  {
    name: "ask_question",
    label: "Asking you to choose",
    description:
      "Stop and ask the recruiter to pick between 2 to 6 short answers, shown as buttons under your question. Use it when a request could mean several records — the real names from a read tool, never invented ones. This ends the turn: their choice arrives as the next message, so do not answer it yourself.",
    args: {
      question: "string — what you need decided, one line",
      options: `string[] — 2 to ${MAX_OPTIONS} short answers (under ${MAX_OPTION_CHARS} characters each) drawn from a tool result`,
      context: "string — optional, why you are asking",
    },
    run: async (args) => ({ ok: true, ...questionFrom(args) }),
  },

];
