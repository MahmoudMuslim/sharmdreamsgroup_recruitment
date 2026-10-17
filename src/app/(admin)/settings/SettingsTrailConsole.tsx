"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  listSettingsTrail,
  type SettingsTrailEntryView,
  type SettingsTrailRead,
} from "@/modules/settings/application/settings-trail-actions";
import {
  settingsTrailNote,
  trailGroup,
  trailGroupById,
} from "@/modules/settings/domain/settingsTrail";

/**
 * Everything the section shows comes from one read of `settings_audit_log`, so the
 * counts under the heading and the rows beneath them are taken from the same query
 * with the same predicate. A list that said "152 recorded" beside 15 rows invited
 * the reader to divide one by the other.
 *
 * A refused read arrives as `read` rather than as an empty trail, because "nobody
 * has changed anything" and "you are not shown what people changed" are different
 * sentences — and only one of them is a fact about the reader's permissions.
 */
export function SettingsTrailConsole({
  read,
  scope,
}: {
  /** The page's own read, so the first paint costs no round trip. */
  read: SettingsTrailRead;
  /** The group `?trail=` asked for, already validated by the page. */
  scope: string | null;
}) {
  const params = useSearchParams();
  const pathname = usePathname();

  /**
   * `?trail=` narrows the trail to one part of the console. Two things write it: a
   * chat link, and a group chip in a row. Because the same route reached again
   * re-renders rather than remounts, the value last taken from the address bar is
   * tracked and applied, so a link that arrives while the section is already open
   * still moves the listing — exactly how the keys console scopes its own trail.
   */
  const incoming = trailGroup(params.get("trail"));
  const [group, setGroup] = useState<string | null>(scope);
  const [lastApplied, setLastApplied] = useState<string | null>(incoming);
  if (incoming !== lastApplied) {
    setLastApplied(incoming);
    setGroup(incoming);
  }

  const [rows, setRows] = useState<SettingsTrailEntryView[]>(read.ok ? read.entries : []);
  const [count, setCount] = useState(read.ok ? read.total : 0);
  const [withActor, setWithActor] = useState(read.ok ? read.named : 0);
  const [failure, setFailure] = useState<string | null>(read.ok ? null : read.error);
  const [pending, setPending] = useState(false);
  const readGroup = useRef(group);

  useEffect(() => {
    if (readGroup.current === group) return;
    readGroup.current = group;
    let live = true;
    setPending(true);
    listSettingsTrail({ group })
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setRows(result.entries);
          setCount(result.total);
          setWithActor(result.named);
          setFailure(null);
        } else {
          // A refused read has no rows, so the listing is cleared rather than left
          // showing an unscoped page under a scoped heading.
          setRows([]);
          setCount(0);
          setWithActor(0);
          setFailure(result.error);
        }
      })
      .catch(() => {
        if (!live) return;
        setRows([]);
        setCount(0);
        setWithActor(0);
        setFailure("The change trail could not be read.");
      })
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
  }, [group]);

  function openScope(next: string | null) {
    setGroup(next);
    const search = new URLSearchParams(window.location.search);
    if (next === null) search.delete("trail");
    else search.set("trail", next);
    window.history.replaceState(null, "", `${pathname}?${search.toString()}`);
  }

  const definition = trailGroupById(group);
  const label = definition?.label ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-base font-bold">
          {label ? `Recent changes — ${label}` : "Recent changes"}
        </h3>
        {group !== null && (
          <button
            type="button"
            onClick={() => openScope(null)}
            className="text-xs font-semibold text-brand-gold-dark underline underline-offset-2"
          >
            Show every change
          </button>
        )}
        {pending && (
          <span className="text-xs text-brand-ink/40" role="status">
            Loading…
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-brand-ink/55">
        {failure
          ? failure
          : settingsTrailNote({
              groupId: group,
              total: count,
              loaded: rows.length,
              named: withActor,
            })}
        {!failure && rows.length > 0 && (
          <span className="text-brand-ink/40">
            {" "}
            Pick a part of the console in a row to read only its changes.
          </span>
        )}
      </p>

      {!failure && rows.length > 0 && (
        <ul className="divide-y divide-brand-line rounded-2xl border border-brand-line bg-white">
          {rows.map((entry) => {
            const entryGroup = trailGroupById(entry.group);
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                {entryGroup ? (
                  <button
                    type="button"
                    onClick={() => openScope(entryGroup.id)}
                    title={`Show only ${entryGroup.label} changes`}
                    className="rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/60 underline underline-offset-2 hover:text-brand-gold-dark"
                  >
                    {entryGroup.label}
                  </button>
                ) : (
                  <span
                    title="No control in this console is keyed that way, so nothing here can scope to it"
                    className="rounded-full bg-brand-cream px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-ink/45"
                  >
                    Unfiled
                  </span>
                )}
                <span className="min-w-[14rem] flex-1">
                  <span className="block text-sm font-semibold text-brand-ink/80" title={entry.key}>
                    {entry.label ?? entry.key}
                  </span>
                  <span className="block text-xs text-brand-ink/55">
                    {entry.from} <span aria-hidden>→</span> {entry.to}
                  </span>
                  {entry.label && (
                    <span className="block text-[11px] text-brand-ink/35">{entry.key}</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-brand-ink/40">
                  {entry.actor ?? "no actor recorded"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
