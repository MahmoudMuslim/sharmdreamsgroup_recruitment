"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Meter } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";

/**
 * Replies rendered as documents instead of paragraphs.
 *
 * Asked "how is the pipeline?", a model answers with a table; asked about one
 * candidate, it answers with a list of labelled facts. `whitespace-pre-wrap`
 * turns both into alignment noise, so this renders the markdown subset those
 * answers actually use — headings, lists, tables, quotes, code and inline
 * emphasis — in the same vocabulary the rest of the portal uses.
 *
 * It is a parser, not a library, and it emits React nodes rather than HTML:
 * text produced by a model (or by a file it just read) can never become markup.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^[-*]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
const RULE = /^(-{3,}|\*{3,})$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The `|---|---|` line that tells a pair of pipe rows apart from prose. */
function isTableDivider(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    RULE.test(line) ||
    line.startsWith(">") ||
    line.startsWith("```") ||
    (line.startsWith("|") && line.endsWith("|"))
  );
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    index += 1;
    if (!line) continue;

    if (line.startsWith("```")) {
      const body: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // the closing fence, whether or not the model remembered it
      blocks.push({ kind: "code", text: body.join("\n").trim() });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(3, Math.max(1, heading[1].length)) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2].trim() });
      continue;
    }

    if (line.startsWith("|") && index < lines.length && isTableDivider(lines[index])) {
      const head = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitRow(lines[index].trim()));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (line.startsWith(">")) {
      const body: string[] = [line.replace(/^>\s?/, "")];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        body.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const firstItem = bullet ?? numbered;
    if (firstItem) {
      const pattern = bullet === null ? NUMBERED : BULLET;
      const items = [firstItem[1].trim()];
      while (index < lines.length) {
        const next = pattern.exec(lines[index].trim());
        if (!next) break;
        items.push(next[1].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered: numbered !== null, items });
      continue;
    }

    const paragraph = [line];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || startsBlock(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

/** Only same-origin portal paths and http(s) links are ever made clickable. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

const INLINE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function renderInline(
  text: string,
  onNavigate: (href: string) => void
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    if (match[1]) nodes.push(<strong key={match.index}>{match[1]}</strong>);
    else if (match[2] || match[3]) nodes.push(<em key={match.index}>{match[2] ?? match[3]}</em>);
    else if (match[4]) {
      nodes.push(
        <code
          key={match.index}
          className="rounded-md bg-brand-sand px-1.5 py-0.5 font-mono text-[12px]"
        >
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      const href = safeHref(match[6]);
      if (!href) nodes.push(match[5]);
      else if (href.startsWith("/")) {
        nodes.push(
          <button
            key={match.index}
            type="button"
            onClick={() => onNavigate(href)}
            className="font-semibold text-brand-gold-dark underline underline-offset-2 transition hover:text-brand-ink"
          >
            {match[5]}
          </button>
        );
      } else {
        nodes.push(
          <a
            key={match.index}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-semibold text-brand-gold-dark underline underline-offset-2 transition hover:text-brand-ink"
          >
            {match[5]}
          </a>
        );
      }
    }

    cursor = INLINE.lastIndex;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** "62%" in a table cell reads better as a bar than as a number. */
function asPercentage(cell: string): number | null {
  const match = /^(-?\d{1,3}(?:\.\d+)?)%$/.exec(cell.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

const DEFINITION_ITEM = /^\*\*([^*\n]+)\*\*\s*[:—–-]?\s*(.+)$/;

/**
 * A short list where every item leads with a bold label is a set of facts about
 * one record, not a sequence of steps, so it reads better as tiles.
 */
function isDefinitionList(items: string[]): boolean {
  if (items.length === 0 || items.length > 8) return false;
  return items.every((item) => item.length <= 120 && DEFINITION_ITEM.test(item));
}

export function RichReply({ text }: { text: string }) {
  const router = useRouter();
  const navigate = (href: string) => router.push(href);
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, blockIndex) => {
        const key = `${block.kind}-${blockIndex}`;

        if (block.kind === "heading") {
          return (
            <p
              key={key}
              className={cn(
                "font-display font-bold",
                block.level === 1 && "text-[15px]",
                block.level === 2 && "text-sm",
                block.level === 3 && "text-xs uppercase tracking-wide text-brand-ink/55"
              )}
            >
              {renderInline(block.text, navigate)}
            </p>
          );
        }

        if (block.kind === "rule") {
          return <hr key={key} className="border-brand-line" />;
        }

        if (block.kind === "code") {
          return (
            <pre
              key={key}
              className="rail-scroll overflow-x-auto rounded-lg bg-brand-ink/95 p-2.5 font-mono text-[11px] leading-relaxed text-brand-cream"
            >
              {block.text}
            </pre>
          );
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="rounded-r-lg border-l-2 border-brand-gold bg-brand-sand px-3 py-2 text-[13px] leading-relaxed"
            >
              {renderInline(block.text, navigate)}
            </blockquote>
          );
        }

        if (block.kind === "table") {
          return (
            <div key={key} className="overflow-x-auto rounded-xl border border-brand-line bg-white">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr className="bg-brand-cream">
                    {block.head.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        className="border-b border-brand-line px-2.5 py-2 font-display text-[10px] font-bold uppercase tracking-wide text-brand-ink/60"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="align-middle">
                      {row.map((cell, cellIndex) => {
                        const pct = asPercentage(cell);
                        return (
                          <td
                            key={cellIndex}
                            className={cn(
                              "border-b border-brand-line/60 px-2.5 py-2 last:border-r-0",
                              cellIndex === 0 && "font-semibold text-brand-ink"
                            )}
                          >
                            {pct === null ? (
                              renderInline(cell, navigate)
                            ) : (
                              <span className="flex items-center gap-2">
                                <Meter value={Math.max(0, Math.min(100, pct))} className="w-12" />
                                <span className="font-mono text-[11px]">{cell}</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.kind === "list") {
          if (!block.ordered && isDefinitionList(block.items)) {
            return (
              <ul key={key} className="grid grid-cols-2 gap-1.5">
                {block.items.map((item, itemIndex) => {
                  const parts = DEFINITION_ITEM.exec(item);
                  return (
                    <li
                      key={itemIndex}
                      className="rounded-xl border border-brand-line bg-white px-2.5 py-2 shadow-soft"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wide text-brand-ink/45">
                        {parts ? parts[1] : renderInline(item, navigate)}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-snug text-brand-ink">
                        {parts ? renderInline(parts[2], navigate) : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            );
          }

          return block.ordered ? (
            <ol key={key} className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-0.5">
                  {renderInline(item, navigate)}
                </li>
              ))}
            </ol>
          ) : (
            <ul key={key} className="space-y-1 text-[13px] leading-relaxed">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
                  <span>{renderInline(item, navigate)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="whitespace-pre-line text-[13px] leading-relaxed">
            {renderInline(block.text, navigate)}
          </p>
        );
      })}
    </div>
  );
}
