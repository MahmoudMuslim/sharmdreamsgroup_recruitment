// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  GENERATED_FORMATS,
  GENERATED_FORMAT_LABEL,
  MAX_FILE_COLUMNS,
  MAX_FILE_LINES_PER_SECTION,
  MAX_FILE_ROWS_PER_SHEET,
  MAX_FILE_SECTIONS,
  MAX_FILE_SHEETS,
  formatBytes,
  parseFileSpec,
  writeAssistantFile,
} from "./shared";

/* Files tools. */

export const files: readonly AssistantTool[] = [
  {
    name: "create_file",
    label: "Building a file",
    description:
      `Write a file the recruiter can download from your answer: ${GENERATED_FORMAT_LABEL}. A table of figures is sent as "sheets" (${GENERATED_FORMATS.filter((entry) => entry.shape === "table")
        .map((entry) => entry.format)
        .join(", ")}); prose is sent as "sections" (${GENERATED_FORMATS.filter((entry) => entry.shape === "sections")
        .map((entry) => entry.format)
        .join(", ")}). Every cell must be a figure a tool in this conversation returned or a line from a file the recruiter attached — the file is made of reads, not of anything you remember, and a row you did not read does not belong in it. It changes no record, so no approval card waits. The download button appears on your answer and the file lives there: never invent a link, a stored path or an expiry date, and say out loud anything a ceiling cut (\`notes\` says what was left out).`,
    args: {
      format: `string — one of ${GENERATED_FORMATS.map((entry) => entry.format).join(", ")}`,
      title: "string — the heading printed at the top of the file",
      description: "string — one line: what the file is and which read its figures came from",
      filename: "string — optional, the name without an extension; the title is used when it is left out",
      meta: "object[] — optional [{label, value}] lines above the contents: the window, the filter, who asked for it",
      limitations: "string[] — optional, what the file does not cover, printed inside it",
      sheets: `object[] — for a table: [{name, columns: [labels], rows: [[cells]]}] — up to ${MAX_FILE_SHEETS} sheets, ${MAX_FILE_ROWS_PER_SHEET} rows a sheet, ${MAX_FILE_COLUMNS} columns`,
      sections: `object[] — for prose: [{heading, lines: [sentences]}] — up to ${MAX_FILE_SECTIONS} sections, ${MAX_FILE_LINES_PER_SECTION} lines each`,
    },
    run: async (args) => {
      const file = await writeAssistantFile(parseFileSpec(args));
      return {
        ok: true,
        file_name: file.fileName,
        label: file.label,
        size: formatBytes(file.bytes),
        contents: file.contents,
        notes: file.notes,
        // The bytes ride on the recruiter's card, never in this answer: a
        // megabyte of base64 in the transcript would be read back into the
        // model's context on the next turn and buy nothing.
        file,
        instruction:
          "Tell the recruiter the file is built and what is in it. The download is the button on this answer — there is no link to quote and nothing was stored.",
      };
    },
  },

];
