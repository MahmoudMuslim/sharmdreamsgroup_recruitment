// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool } from "./shared";
import {
  readWebPage,
  searchWeb,
  str,
} from "./shared";

/* Web tools. */

export const web: readonly AssistantTool[] = [
  {
    name: "search_web",
    label: "Searching the public web",
    web: true,
    description:
      "Search the public internet for anything this portal's records cannot answer — a pay band, a tax rule, a framework's release notes, a company, a competitor's own ad, a visa requirement. Subject is unrestricted. Returns the pages that were found, each with its host and the words the page itself carried at the moment of the lookup, so a figure can only be quoted with its source named. It reads nothing in this portal and changes nothing. When it comes back with no sources, say so and give no number: a remembered figure is not a search result.",
    args: {
      query: "string — the words to search for, in any subject",
      max_results: "number — optional, how many pages to bring back (up to 6)",
    },
    run: async (args) => {
      const wanted = Number(args.max_results);
      return searchWeb(str(args, "query"), Number.isFinite(wanted) && wanted > 0 ? wanted : undefined);
    },
  },
  {
    name: "read_web_page",
    label: "Reading a web page",
    web: true,
    description:
      "Fetch one public page and return its own text, so a figure can be read from the source rather than from a search snippet. Use the URL search_web returned. Private, loopback and link-local addresses are refused, as is anything that is not an http or https page, and a long page is cut with the cut named. Nothing is sent to the host but the request for the page.",
    args: { url: "string — the page to read, from search_web" },
    run: async (args) => readWebPage(str(args, "url")),
  },

];
