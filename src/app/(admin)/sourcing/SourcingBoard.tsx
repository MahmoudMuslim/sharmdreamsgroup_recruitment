"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  UserPlus
} from "lucide-react";
import {
  FormMessage
} from "@/modules/analytics/presentation/Form";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterRail,
  StatTile
} from "@/modules/analytics/presentation/ui";
import {
  POOL_LIMIT,
  PROSPECT_STAGES,
  prospectSearchWords,
  stageWord,
  searchPool,
  type ProspectPoolTotals,
  type ProspectStage
} from "./pool-model";
import {
  deleteProspect,
  setProspectStage,
  type JobOption,
  type OutreachChannel,
  type ProspectRow
} from "./actions";
import { ComposerDrawer } from "./ComposerDrawer";
import { ImportDrawer } from "./ImportDrawer";
import { ProspectFormDrawer } from "./ProspectFormDrawer";
import { ProfileDrawer } from "./ProspectProfileDrawer";
import { type ContactField, initials, reachDoor, stageTone } from "./SourcingBits";

/* -------------------------------------------------------------------------- */

export function SourcingBoard({
  prospects,
  totals,
  stage,
  jobs,
  jobsTotal,
  copy,
  canWrite,
  canDelete,
  canSend,
}: {
  prospects: ProspectRow[];
  totals: ProspectPoolTotals;
  stage: ProspectStage | null;
  jobs: JobOption[];
  jobsTotal: number;
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  canWrite: boolean;
  canDelete: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // `?q=` seeds the search the way the candidates table does, so an assistant
  // answer that ran a text search can link to a board showing the same rows.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  // Which record the editor holds, and the contact field a reach door sent the
  // recruiter to fill in.
  const [editing, setEditing] = useState<{ prospect: ProspectRow | "new"; focus: ContactField | null } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(params.get("prospect"));
  const [composerIds, setComposerIds] = useState<string[] | null>(null);
  // What the last import or send actually did. The drawer that reported it is
  // closed by the time the board refreshes, so the summary lives here.
  const [notice, setNotice] = useState<string | null>(null);

  // `?prospect=` is where the assistant's "View the prospect" link lands. Same
  // route with a new query re-renders rather than remounts, so the incoming id
  // is tracked and applied here as well as in the initial state above.
  const incomingProspect = params.get("prospect");
  const [lastAppliedProspect, setLastAppliedProspect] = useState(incomingProspect);
  if (incomingProspect && incomingProspect !== lastAppliedProspect) {
    setLastAppliedProspect(incomingProspect);
    setProfileId(incomingProspect);
  }

  const liveProfile = profileId ? prospects.find((p) => p.id === profileId) ?? null : null;
  const composerRows = composerIds
    ? prospects.filter((p) => composerIds.includes(p.id))
    : [];

  /**
   * Move a rail and let the server answer for the rows.
   *
   * The stage goes in the URL, not in local state, so the chip, the table and the
   * count above it all describe the same query — and a rail with nine hundred
   * prospects is a rail the page can walk rather than one it quietly truncates.
   * `?prospect=` is dropped: a rail is a question about the pool, not about one
   * record, and the selection goes with it, because the rows under the next chip
   * are not the rows that were ticked.
   */
  function openRail(next: ProspectStage | null) {
    setSelected(new Set());
    setProfileId(null);
    setLastAppliedProspect(null);
    router.push(next ? `/sourcing?stage=${next}` : "/sourcing");
  }

  const filtered = useMemo(() => searchPool(prospects, query), [prospects, query]);

  /**
   * What this page was asked for, against what it can carry.
   *
   * Every figure on the board is counted by the database, so a tile or a chip
   * describes the whole pool while the list below holds the newest `POOL_LIMIT`
   * rows of the scope it was queried for — the stage under a rail, or everything.
   * A search narrows those rows further by text, so its count belongs to no chip
   * alone. The gap between the scope's count and the loaded rows is what the
   * sentence under the rails says out loud.
   */
  const stageCount = (s: string) => totals.byStage[s as ProspectStage] ?? 0;
  const scopeTotal = stage ? stageCount(stage) : totals.total;
  const rowsNotLoaded = Math.max(0, scopeTotal - prospects.length);

  const clearNotice = () => setNotice(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  function remove(prospect: ProspectRow) {
    if (
      !window.confirm(
        `Remove ${prospect.full_name} from the pool? Their outreach history goes with the record.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteProspect(prospect.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(prospect.id);
        return next;
      });
      if (profileId === prospect.id) setProfileId(null);
      router.refresh();
    });
  }

  function moveStage(prospect: ProspectRow, stage: string) {
    startTransition(async () => {
      await setProspectStage(prospect.id, stage);
      router.refresh();
    });
  }

  if (totals.total === 0) {
    return (
      <>
        <Card className="mb-4">
          <EmptyState
            icon={<UserPlus className="h-7 w-7" aria-hidden />}
            title="The pool is empty"
            description="Paste the LinkedIn profile links you collected, or a CSV export, and they load here as prospects you can work and message."
          />
          <div className="flex justify-center pb-8">
            <Button onClick={() => { setNotice(null); setImportOpen(true); }}>
              <Upload className="h-4 w-4" aria-hidden />
              Import prospects
            </Button>
          </div>
        </Card>
        <ImportDrawer
          open={importOpen}
          jobs={jobs}
          jobsTotal={jobsTotal}
          onClose={() => setImportOpen(false)}
          onDone={(summary) => {
            setImportOpen(false);
            setNotice(summary);
            router.refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="In the pool" value={totals.total} hint="Counted across the whole pool" />
        <StatTile
          label="Not contacted"
          value={stageCount("NEW")}
          hint="Waiting for a first touch"
        />
        <StatTile
          label="Talking"
          value={stageCount("CONTACTED") + stageCount("REPLIED")}
          hint="Contacted or replied"
        />
        <StatTile
          label="Converted"
          value={stageCount("CONVERTED")}
          hint="Now on the Candidates board"
        />
      </div>

      <div className="sticky top-[57px] z-20 -mx-4 mb-4 space-y-2.5 border-b border-brand-line bg-brand-ivory/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${prospectSearchWords()}`}
              aria-label="Search prospects"
              className="w-full rounded-xl border border-brand-line bg-white py-2.5 pl-10 pr-3 text-sm focus:border-brand-gold focus:outline-none"
            />
          </div>

          {canSend && selected.size > 0 && (
            <Button size="sm" onClick={() => { clearNotice(); setComposerIds([...selected]); }}>
              <Send className="h-4 w-4" aria-hidden />
              Message {selected.size}
            </Button>
          )}
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => { clearNotice(); setEditing({ prospect: "new", focus: null }); }}>
                <Plus className="h-4 w-4" aria-hidden />
                Add one
              </Button>
              <Button variant="outline" size="sm" onClick={() => { clearNotice(); setImportOpen(true); }}>
                <Upload className="h-4 w-4" aria-hidden />
                Import
              </Button>
            </>
          )}
        </div>

        <div className="rail-scroll flex gap-2 overflow-x-auto pb-1">
          <FilterRail
            label="All"
            count={totals.total}
            active={stage === null}
            onClick={() => openRail(null)}
          />
          {PROSPECT_STAGES.map((s) => (
            <FilterRail
              key={s}
              label={stageWord(s)}
              count={stageCount(s)}
              active={stage === s}
              onClick={() => openRail(stage === s ? null : s)}
            />
          ))}
        </div>
      </div>

      {/* A chip counts the whole stage; this table lists the newest rows the query
          returns — the stage is filtered in the database now, so the rows a rail
          promises are the rows it loads, up to one render's bound. When the two
          numbers still differ, the page says which one it is showing rather than
          letting a recruiter count rows against a chip that promised more. */}
      {rowsNotLoaded > 0 && (
        <p className="mb-4 max-w-3xl text-[11px] leading-relaxed text-brand-ink/60">
          This table lists the newest {prospects.length.toLocaleString()} of the{" "}
          {scopeTotal.toLocaleString()} prospects{" "}
          {stage ? `the ${stageWord(stage)} rail counts` : "in the pool"} — one render carries{" "}
          {POOL_LIMIT.toLocaleString()} rows, so {rowsNotLoaded.toLocaleString()}{" "}
          {rowsNotLoaded === 1 ? "prospect is" : "prospects are"} counted above but not shown below.
        </p>
      )}

      {notice && (
        <div className="mb-4">
          <FormMessage success={notice} />
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches that"
            description={
              query.trim()
                ? "Clear the search to see the rows this page lists again."
                : stage
                  ? scopeTotal === 0
                    ? `No prospect sits at the ${stageWord(stage)} stage. Open “All” to leave the rail.`
                    : `This render asked the database for the ${stageWord(
                        stage
                      )} rows and none came back, though the chip counts ${scopeTotal.toLocaleString()}. Reload the page, or open “All” to leave the rail.`
                  : "No prospect rows arrived in this render, though the pool counts them above."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-brand-line text-left text-[11px] uppercase tracking-wider text-brand-ink/45">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((p) => p.id)))
                      }
                      aria-label="Select every prospect shown"
                      className="h-4 w-4 accent-brand-ink"
                    />
                  </th>
                  <th className="px-2 py-3">Prospect</th>
                  <th className="px-2 py-3">Reach</th>
                  <th className="px-2 py-3">Stage</th>
                  <th className="px-2 py-3">Last touch</th>
                  <th className="px-2 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((prospect) => (
                  <tr
                    key={prospect.id}
                    className="border-b border-brand-line/60 last:border-0 hover:bg-brand-sand/40"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(prospect.id)}
                        onChange={() => toggle(prospect.id)}
                        aria-label={`Select ${prospect.full_name}`}
                        className="h-4 w-4 accent-brand-ink"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-xs font-bold text-brand-gold-dark">
                          {initials(prospect.full_name)}
                        </span>
                        <span className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setProfileId(prospect.id)}
                            className="block max-w-[240px] truncate text-left font-semibold hover:text-brand-gold-dark"
                          >
                            {prospect.full_name}
                          </button>
                          <span className="block max-w-[240px] truncate text-xs text-brand-ink/50">
                            {[prospect.headline, prospect.company, prospect.location]
                              .filter(Boolean)
                              .join(" · ") || "No headline on file"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-1.5 text-brand-ink/55">
                        {(["EMAIL", "WHATSAPP"] as const).map((channel) => {
                          const door = reachDoor(prospect, channel, copy);
                          const Icon = channel === "EMAIL" ? Mail : MessageCircle;
                          const label = channel === "EMAIL" ? "email" : "WhatsApp";

                          if (door.href) {
                            return (
                              <a
                                key={channel}
                                href={door.href}
                                title={`Reach ${prospect.full_name} by ${label} — ${door.address}`}
                                target={channel === "WHATSAPP" ? "_blank" : undefined}
                                rel={channel === "WHATSAPP" ? "noopener noreferrer" : undefined}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-brand-sand"
                              >
                                <Icon className="h-4 w-4 hover:text-brand-gold-dark" aria-hidden />
                              </a>
                            );
                          }

                          const hint = `No ${door.field} on file for ${prospect.full_name}`;
                          if (!canWrite) {
                            return (
                              <span
                                key={channel}
                                title={`${hint}, and this account cannot add one`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
                              >
                                <Icon className="h-4 w-4 opacity-25" aria-hidden />
                              </span>
                            );
                          }

                          return (
                            <button
                              key={channel}
                              type="button"
                              onClick={() => { clearNotice(); setEditing({ prospect, focus: door.field }); }}
                              title={`${hint} — click to add it and reach them by ${label}`}
                              aria-label={`Add ${prospect.full_name}'s ${door.field} to reach them by ${label}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-brand-sand"
                            >
                              <Icon className="h-4 w-4 opacity-30 hover:opacity-70" aria-hidden />
                            </button>
                          );
                        })}
                        {prospect.linkedin_url && (
                          <a
                            href={prospect.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the profile on LinkedIn"
                          >
                            <ExternalLink className="h-4 w-4 hover:text-brand-gold-dark" aria-hidden />
                          </a>
                        )}
                        {prospect.messages > 0 && (
                          <span className="text-[11px] text-brand-ink/45">
                            {prospect.messages} sent
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {canWrite ? (
                        <select
                          value={prospect.stage}
                          onChange={(event) => moveStage(prospect, event.target.value)}
                          aria-label={`Sourcing stage for ${prospect.full_name}`}
                          className="rounded-lg border border-brand-line bg-white px-2 py-1 text-xs font-semibold"
                        >
                          {PROSPECT_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                              {stageWord(stage)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={stageTone(prospect.stage)}>{stageWord(prospect.stage)}</Badge>
                      )}
                    </td>
                    <td className="px-2 py-3 text-xs text-brand-ink/55">
                      {prospect.last_contacted_at
                        ? new Date(prospect.last_contacted_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setProfileId(prospect.id)}>
                          View
                        </Button>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ prospect, focus: null })}
                            aria-label={`Edit ${prospect.full_name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => remove(prospect)}
                            aria-label={`Remove ${prospect.full_name}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs leading-relaxed text-brand-ink/45">
        LinkedIn has no API for searching people, so nothing here arrives on its own: these are the
        profile links and exports you collected and pasted in. Outreach leaves through the email and
        WhatsApp integrations configured in Settings → API keys. A faded email or WhatsApp icon means
        no address is on file yet — click it to add one, then the same door opens the letter.
      </p>

      <ImportDrawer
        open={importOpen}
        jobs={jobs}
        jobsTotal={jobsTotal}
        onClose={() => setImportOpen(false)}
        onDone={(summary) => {
          setImportOpen(false);
          setNotice(summary);
          router.refresh();
        }}
      />

      {editing && (
        <ProspectFormDrawer
          prospect={editing.prospect === "new" ? null : editing.prospect}
          focus={editing.focus}
          jobs={jobs}
          jobsTotal={jobsTotal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {liveProfile && (
        <ProfileDrawer
          prospect={liveProfile}
          jobs={jobs}
          jobsTotal={jobsTotal}
          copy={copy}
          canWrite={canWrite}
          canSend={canSend}
          onClose={() => setProfileId(null)}
          onChanged={() => router.refresh()}
          onCompose={() => setComposerIds([liveProfile.id])}
          onEdit={(field) => setEditing({ prospect: liveProfile, focus: field ?? null })}
        />
      )}

      {composerRows.length > 0 && (
        <ComposerDrawer
          rows={composerRows}
          copy={copy}
          onClose={() => setComposerIds(null)}
          onSent={(summary) => {
            setComposerIds(null);
            setSelected(new Set());
            setNotice(summary);
            router.refresh();
          }}
        />
      )}

      {pending && (
        <p className="mt-3 flex items-center gap-2 text-xs text-brand-ink/45">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Working…
        </p>
      )}
    </>
  );
}
