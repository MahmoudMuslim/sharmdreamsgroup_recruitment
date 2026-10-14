"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { Drawer } from "@/modules/analytics/presentation/Drawer";
import {
  DrawerActions,
  Field,
  FormMessage,
  Select,
  TextArea,
  TextInput,
} from "@/modules/analytics/presentation/Form";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterRail,
  StatTile,
} from "@/modules/analytics/presentation/ui";
import { renderTemplate } from "@/modules/settings/domain/templates";
import { parseProspectImport } from "@/modules/sourcing/domain/prospect-import";
import {
  profileSections,
  type ProfileSectionCount,
  type ProspectProfile,
} from "@/modules/sourcing/domain/prospect-profile";
import {
  getProspectProfile,
  pasteProspectProfile,
  readProspectProfile,
  uploadProspectProfile,
  type StoredProspectProfile,
} from "./profile-actions";
import { cn } from "@/lib/utils";
import {
  convertProspect,
  deleteProspect,
  getProspectHistory,
  importProspects,
  saveProspect,
  sendProspectOutreach,
  setProspectStage,
  type JobOption,
  type OutreachChannel,
  type ProspectHistoryRow,
  type ProspectRow,
} from "./actions";

const STAGE_LABEL: Record<string, string> = {
  NEW: "Not contacted",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  INTERVIEW: "Interview",
  CONVERTED: "Applied",
  PASSED: "Passed",
};

const STAGE_ORDER = ["NEW", "CONTACTED", "REPLIED", "INTERVIEW", "CONVERTED", "PASSED"];

function stageTone(stage: string) {
  if (stage === "CONVERTED" || stage === "REPLIED") return "success" as const;
  if (stage === "CONTACTED" || stage === "INTERVIEW") return "gold" as const;
  if (stage === "PASSED") return "danger" as const;
  return "info" as const;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** What a message can still be edited with before it goes out. */
function varsFor(prospect: ProspectRow, companyName = "Sharm Dreams Group") {
  return {
    candidate_name: prospect.full_name,
    job_title: prospect.job_title ?? "one of our roles",
    company_name: companyName,
  };
}

function mailtoLink(prospect: ProspectRow, subject: string, body: string) {
  if (!prospect.email) return null;
  const vars = varsFor(prospect);
  return `mailto:${prospect.email}?subject=${encodeURIComponent(
    renderTemplate(subject, vars)
  )}&body=${encodeURIComponent(renderTemplate(body, vars))}`;
}

function waLink(prospect: ProspectRow, body: string) {
  const digits = prospect.phone?.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(renderTemplate(body, varsFor(prospect)))}`;
}

/* -------------------------------------------------------------------------- */

export function SourcingBoard({
  prospects,
  jobs,
  copy,
  canWrite,
  canDelete,
  canSend,
}: {
  prospects: ProspectRow[];
  jobs: JobOption[];
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  canWrite: boolean;
  canDelete: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ProspectRow | "new" | null>(null);
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

  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prospects) counts.set(p.stage, (counts.get(p.stage) ?? 0) + 1);
    return counts;
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prospects.filter((p) => {
      if (stageFilter && p.stage !== stageFilter) return false;
      if (!q) return true;
      return [p.full_name, p.email, p.phone, p.company, p.headline, p.location, p.linkedin_url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [prospects, query, stageFilter]);

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

  if (prospects.length === 0) {
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
        <StatTile label="In the pool" value={prospects.length} hint="Loaded prospects" />
        <StatTile
          label="Not contacted"
          value={stageCounts.get("NEW") ?? 0}
          hint="Waiting for a first touch"
        />
        <StatTile
          label="Talking"
          value={(stageCounts.get("CONTACTED") ?? 0) + (stageCounts.get("REPLIED") ?? 0)}
          hint="Contacted or replied"
        />
        <StatTile
          label="Converted"
          value={stageCounts.get("CONVERTED") ?? 0}
          hint="Now on the Candidates board"
        />
      </div>

      <div className="sticky top-[57px] z-20 -mx-4 mb-4 space-y-2.5 border-b border-brand-line bg-brand-ivory/95 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10">
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
              placeholder="Search name, role, company, email or profile link"
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
              <Button variant="outline" size="sm" onClick={() => { clearNotice(); setEditing("new"); }}>
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
            count={prospects.length}
            active={stageFilter === ""}
            onClick={() => setStageFilter("")}
          />
          {STAGE_ORDER.map((stage) => (
            <FilterRail
              key={stage}
              label={STAGE_LABEL[stage]}
              count={stageCounts.get(stage) ?? 0}
              active={stageFilter === stage}
              onClick={() => setStageFilter(stageFilter === stage ? "" : stage)}
            />
          ))}
        </div>
      </div>

      {notice && (
        <div className="mb-4">
          <FormMessage success={notice} />
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches that"
            description="Clear the search or pick another stage to see the rest of the pool."
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
                      <div className="flex items-center gap-2 text-brand-ink/55">
                        {prospect.email ? (
                          <a href={`mailto:${prospect.email}`} title={prospect.email}>
                            <Mail className="h-4 w-4 hover:text-brand-gold-dark" aria-hidden />
                          </a>
                        ) : (
                          <Mail className="h-4 w-4 opacity-25" aria-hidden />
                        )}
                        {prospect.phone ? (
                          <a href={`tel:${prospect.phone}`} title={prospect.phone}>
                            <MessageCircle className="h-4 w-4 hover:text-brand-gold-dark" aria-hidden />
                          </a>
                        ) : (
                          <MessageCircle className="h-4 w-4 opacity-25" aria-hidden />
                        )}
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
                          {STAGE_ORDER.map((stage) => (
                            <option key={stage} value={stage}>
                              {STAGE_LABEL[stage]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={stageTone(prospect.stage)}>{STAGE_LABEL[prospect.stage]}</Badge>
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
                            onClick={() => setEditing(prospect)}
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
        WhatsApp integrations configured in Settings → API keys.
      </p>

      <ImportDrawer
        open={importOpen}
        jobs={jobs}
        onClose={() => setImportOpen(false)}
        onDone={(summary) => {
          setImportOpen(false);
          setNotice(summary);
          router.refresh();
        }}
      />

      {editing && (
        <ProspectFormDrawer
          prospect={editing === "new" ? null : editing}
          jobs={jobs}
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
          copy={copy}
          canWrite={canWrite}
          canSend={canSend}
          onClose={() => setProfileId(null)}
          onChanged={() => router.refresh()}
          onCompose={() => setComposerIds([liveProfile.id])}
          onEdit={() => setEditing(liveProfile)}
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

/* -------------------------------------------------------------------------- */

function ImportDrawer({
  open,
  jobs,
  onClose,
  onDone,
}: {
  open: boolean;
  jobs: JobOption[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [origin, setOrigin] = useState<"LINKEDIN" | "CSV">("LINKEDIN");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Parsed live in the browser with the same pure function the server uses, so
  // the count shown before importing is the count that will be written.
  const preview = useMemo(() => (raw.trim() ? parseProspectImport(raw) : null), [raw]);

  function submit() {
    if (!raw.trim()) {
      setError("Paste at least one profile link or one CSV row.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await importProspects({
        raw,
        origin,
        job_id: jobId || null,
      });
      if (!result.ok) {
        setError(result.error ?? "The import failed.");
        return;
      }
      const skipped = result.existing ?? 0;
      const unusable = result.problems?.length ?? 0;
      const summary = `${result.imported ?? 0} loaded into the pool${
        skipped ? `, ${skipped} already there by profile link or email` : ""
      }${unusable ? `, ${unusable} line${unusable > 1 ? "s" : ""} unreadable` : ""}.`;
      setRaw("");
      onDone(summary);
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Load a list"
      title="Import prospects"
      subtitle="One LinkedIn profile URL per line, or a CSV/TSV export with a header row."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Importing…" : "Import"}
          pending={pending}
          note="Anything already in the pool by profile link or email is skipped, not duplicated."
        />
      }
      onSubmit={submit}
    >
      <Field label="Where the list came from" htmlFor="prospect-origin">
        <Select
          id="prospect-origin"
          value={origin}
          onChange={(event) => setOrigin(event.target.value as "LINKEDIN" | "CSV")}
        >
          <option value="LINKEDIN">LinkedIn profile links I collected</option>
          <option value="CSV">A CSV / TSV export</option>
        </Select>
      </Field>

      <Field
        label="Link to an opening"
        htmlFor="prospect-job"
        hint="Optional. Names the role in the outreach copy instead of “one of our roles”."
        className="mt-4"
      >
        <Select id="prospect-job" value={jobId} onChange={(event) => setJobId(event.target.value)}>
          <option value="">No opening yet</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Paste the list"
        htmlFor="prospect-raw"
        hint="A row with only a profile link is enough — the name is read from the link."
        className="mt-4"
      >
        <TextArea
          id="prospect-raw"
          rows={9}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={"https://www.linkedin.com/in/ahmed-fouad-9a2b3c\nFull Name,Headline,Email,LinkedIn"}
        />
      </Field>

      {preview && (
        <div className="mt-4 rounded-xl border border-brand-line bg-brand-cream/60 p-3.5 text-xs">
          <p className="font-semibold">
            {preview.drafts.length} ready to import
            {preview.duplicates > 0 && ` · ${preview.duplicates} repeated line${preview.duplicates > 1 ? "s" : ""} in this paste`}
          </p>
          {preview.problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-brand-ink/60">
              {preview.problems.slice(0, 6).map((problem) => (
                <li key={problem.line}>
                  Line {problem.line}: {problem.reason}
                </li>
              ))}
              {preview.problems.length > 6 && <li>…and {preview.problems.length - 6} more.</li>}
            </ul>
          )}
        </div>
      )}

      <FormMessage error={error} />
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function ProspectFormDrawer({
  prospect,
  jobs,
  onClose,
  onSaved,
}: {
  prospect: ProspectRow | null;
  jobs: JobOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: prospect?.full_name ?? "",
    headline: prospect?.headline ?? "",
    company: prospect?.company ?? "",
    location: prospect?.location ?? "",
    email: prospect?.email ?? "",
    phone: prospect?.phone ?? "",
    linkedin_url: prospect?.linkedin_url ?? "",
    notes: prospect?.notes ?? "",
    job_id: prospect?.job_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveProspect({
        id: prospect?.id,
        origin: prospect?.origin === "LINKEDIN" || prospect?.origin === "CSV" ? prospect?.origin : "MANUAL",
        full_name: form.full_name,
        headline: form.headline || null,
        company: form.company || null,
        location: form.location || null,
        email: form.email || null,
        phone: form.phone || null,
        linkedin_url: form.linkedin_url || null,
        notes: form.notes || null,
        job_id: form.job_id || null,
      });
      if (!result.ok) {
        setError(result.error ?? "That could not be saved.");
        return;
      }
      onSaved();
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={prospect ? "Edit record" : "Add by hand"}
      title={prospect ? prospect.full_name : "New prospect"}
      subtitle="Only the name is required — but without an email, phone or profile link there is no way to reach them."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Saving…" : prospect ? "Save changes" : "Add to pool"}
          pending={pending}
        />
      }
      onSubmit={submit}
    >
      <div className="space-y-4">
        <Field label="Full name" htmlFor="field-name" required>
          <TextInput id="field-name" value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Headline" htmlFor="field-headline" hint="Their own words, straight off the profile.">
          <TextInput id="field-headline" value={form.headline} onChange={set("headline")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" htmlFor="field-company">
            <TextInput id="field-company" value={form.company} onChange={set("company")} />
          </Field>
          <Field label="Location" htmlFor="field-location">
            <TextInput id="field-location" value={form.location} onChange={set("location")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" htmlFor="field-email">
            <TextInput id="field-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone" htmlFor="field-phone" hint="Include the country code for WhatsApp.">
            <TextInput id="field-phone" value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <Field label="LinkedIn profile" htmlFor="field-linkedin">
          <TextInput
            id="field-linkedin"
            value={form.linkedin_url}
            onChange={set("linkedin_url")}
            placeholder="linkedin.com/in/…"
          />
        </Field>
        <Field label="Linked opening" htmlFor="field-job">
          <Select id="field-job" value={form.job_id} onChange={set("job_id")}>
            <option value="">None</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="field-notes">
          <TextArea id="field-notes" rows={4} value={form.notes} onChange={set("notes")} />
        </Field>
      </div>

      <FormMessage error={error} />
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function ProfileDrawer({
  prospect,
  jobs,
  copy,
  canWrite,
  canSend,
  onClose,
  onChanged,
  onCompose,
  onEdit,
}: {
  prospect: ProspectRow;
  jobs: JobOption[];
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  canWrite: boolean;
  canSend: boolean;
  onClose: () => void;
  onChanged: () => void;
  onCompose: () => void;
  onEdit: () => void;
}) {
  const [history, setHistory] = useState<ProspectHistoryRow[] | null>(null);
  const [jobId, setJobId] = useState(prospect.job_id ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    getProspectHistory(prospect.id).then((rows) => {
      if (active) setHistory(rows);
    });
    return () => {
      active = false;
    };
  }, [prospect.id, prospect.last_contacted_at]);

  function convert() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await convertProspect({ id: prospect.id, job_id: jobId });
      if (!result.ok) {
        setError(result.error ?? "That could not be converted.");
        return;
      }
      setNotice("They are on the Candidates board now, sourced as LinkedIn.");
      onChanged();
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={STAGE_LABEL[prospect.stage]}
      title={prospect.full_name}
      subtitle={[prospect.headline, prospect.company, prospect.location].filter(Boolean).join(" · ")}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {prospect.linkedin_url && (
            <a
              href={prospect.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3.5 py-2 text-sm font-semibold hover:bg-brand-sand"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Open on LinkedIn
            </a>
          )}
          {mailtoLink(prospect, copy.EMAIL.subject, copy.EMAIL.body) && (
            <a
              href={mailtoLink(prospect, copy.EMAIL.subject, copy.EMAIL.body)!}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3.5 py-2 text-sm font-semibold hover:bg-brand-sand"
            >
              <Mail className="h-4 w-4" aria-hidden />
              Email client
            </a>
          )}
          {waLink(prospect, copy.WHATSAPP.body) && (
            <a
              href={waLink(prospect, copy.WHATSAPP.body)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3.5 py-2 text-sm font-semibold hover:bg-brand-sand"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              WhatsApp app
            </a>
          )}
          {canSend && (
            <Button size="sm" className="ml-auto" onClick={onCompose}>
              <Send className="h-4 w-4" aria-hidden />
              Message from here
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Detail label="Email" value={prospect.email} href={prospect.email ? `mailto:${prospect.email}` : undefined} />
        <Detail label="Phone" value={prospect.phone} href={prospect.phone ? `tel:${prospect.phone}` : undefined} />
        <Detail label="Linked opening" value={prospect.job_title} />
        <Detail label="Loaded" value={new Date(prospect.created_at).toLocaleDateString()} />
        <Detail label="Source of the record" value={prospect.origin} />
        <Detail
          label="Last touch"
          value={
            prospect.last_contacted_at
              ? new Date(prospect.last_contacted_at).toLocaleString()
              : "Never contacted"
          }
        />
      </dl>

      {prospect.notes && (
        <p className="mt-4 whitespace-pre-line rounded-xl border border-brand-line bg-brand-cream/60 p-3.5 text-sm leading-relaxed text-brand-ink/70">
          {prospect.notes}
        </p>
      )}

      <ProfilePanel prospect={prospect} canWrite={canWrite} />

      {canWrite && (
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-brand-line pt-4">
          <Field label="Convert to an application" htmlFor="convert-job" className="min-w-[200px] flex-1">
            <Select id="convert-job" value={jobId} onChange={(event) => setJobId(event.target.value)}>
              <option value="">Choose an opening…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="outline"
            size="sm"
            onClick={convert}
            disabled={!jobId || pending || Boolean(prospect.application_id) || !prospect.email}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            {prospect.application_id ? "Already converted" : "Convert"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </Button>
        </div>
      )}

      {prospect.email === null && !prospect.application_id && (
        <p className="mt-2 text-[11px] text-brand-ink/45">
          Conversion needs an email address — an application cannot exist without one.
        </p>
      )}

      <FormMessage error={error} success={notice} />

      <section className="mt-5 border-t border-brand-line pt-4">
        <h3 className="font-display text-sm font-bold">What we have sent</h3>
        {!history ? (
          <p className="mt-2 text-xs text-brand-ink/45">Loading…</p>
        ) : history.length === 0 ? (
          <p className="mt-2 text-xs text-brand-ink/55">
            Nothing yet. Every message you send from here is recorded, delivered or refused.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.map((row) => (
              <li key={row.id} className="rounded-xl border border-brand-line bg-white p-3.5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-brand-ink/45">
                  <Badge tone={row.channel === "EMAIL" ? "info" : "success"}>{row.channel}</Badge>
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                  <span className="ml-auto">
                    {row.delivered ? "Delivered" : "Refused"}
                  </span>
                </div>
                {row.subject && <p className="mt-2 text-sm font-semibold">{row.subject}</p>}
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-brand-ink/65">
                  {row.body}
                </p>
                {row.error_message && (
                  <p className="mt-2 text-[11px] text-rose-700">{row.error_message}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}

function Detail({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-brand-ink/40">{label}</dt>
      <dd className="truncate text-sm">
        {value ? (
          href ? (
            <a href={href} className="text-brand-gold-dark hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-brand-ink/35">—</span>
        )}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const CAPTURE_DOORS = [
  { key: "URL", label: "From a link", icon: Link2 },
  { key: "PASTE", label: "Pasted text", icon: FileText },
  { key: "FILE", label: "Upload export", icon: Upload },
] as const;

type CaptureDoor = (typeof CAPTURE_DOORS)[number]["key"];

/** How the stored profile got here, in the recruiter's words. */
const SOURCE_NOTE: Record<string, string> = {
  URL: "fetched from the link",
  PASTE: "pasted off the page",
  FILE: "read from an uploaded export",
};

/**
 * Everything the reader knows about one prospect.
 *
 * The profile loads when the drawer opens rather than with the board: a stored
 * profile is a few kilobytes of jsonb and most rows in the pool do not have one.
 *
 * Three doors feed it because only some pages can be read. A public site or a
 * GitHub profile is fetched here; a LinkedIn page is behind a login for any
 * automated request, so the recruiter pastes it or uploads “Save to PDF”. All
 * three end in the same structured profile, and the panel says which door
 * produced it, since that is the difference between current data and a snapshot.
 */
function ProfilePanel({
  prospect,
  canWrite,
}: {
  prospect: ProspectRow;
  canWrite: boolean;
}) {
  const [stored, setStored] = useState<StoredProspectProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [door, setDoor] = useState<CaptureDoor>("URL");
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    getProspectProfile(prospect.id).then((row) => {
      if (!active) return;
      setStored(row);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [prospect.id]);

  /** A stored profile is re-read from the row, not taken from the reply. */
  function refresh() {
    getProspectProfile(prospect.id).then((row) => {
      setStored(row);
      setLoading(false);
    });
  }

  function report(
    outcome: { ok: boolean; error?: string; hint?: string; detail?: string },
    fallback: string
  ) {
    if (outcome.ok) {
      setError(null);
      setHint(null);
      setMessage(outcome.detail ? `Captured from ${outcome.detail}.` : fallback);
      refresh();
      return;
    }
    setMessage(null);
    setError(outcome.error ?? "That could not be read.");
    setHint(outcome.hint ?? null);
  }

  function readFromLink() {
    setError(null);
    setHint(null);
    setMessage(null);
    startTransition(async () => {
      const outcome = await readProspectProfile({
        id: prospect.id,
        url: url.trim() || undefined,
      });
      report(outcome, "Profile captured.");
    });
  }

  function readFromPaste() {
    setError(null);
    setHint(null);
    setMessage(null);
    if (pasted.trim().length < 120) {
      setError("That is too little text to read a profile out of — select the whole page and paste it.");
      return;
    }
    startTransition(async () => {
      const outcome = await pasteProspectProfile({ id: prospect.id, text: pasted });
      if (outcome.ok) setPasted("");
      report(outcome, "Profile captured from the pasted page.");
    });
  }

  function uploadExport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setHint(null);
    setMessage(null);

    const form = new FormData();
    form.set("id", prospect.id);
    form.set("file", file);

    startTransition(async () => {
      report(await uploadProspectProfile(form), "");
    });
  }

  const profile = stored?.profile ?? null;
  const sections = profile ? profileSections(profile) : [];

  return (
    <section className="mt-5 border-t border-brand-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-sm font-bold">Full profile</h3>
        {profile && <Badge tone="info">{sections.reduce((sum, s) => sum + s.count, 0)} entries</Badge>}
        {stored?.captured_at && (
          <span className="ml-auto text-[11px] text-brand-ink/45">
            {new Date(stored.captured_at).toLocaleString()}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-brand-ink/45">Loading…</p>
      ) : (
        <>
          {profile ? (
            <div className="mt-3 space-y-3">
              {profile.summary && (
                <p className="whitespace-pre-line rounded-xl border border-brand-line bg-brand-cream/60 p-3.5 text-sm leading-relaxed text-brand-ink/70">
                  {profile.summary}
                </p>
              )}
              {sections.map((section) => (
                <SectionBlock key={section.key} profile={profile} section={section} />
              ))}
              <p className="text-[11px] leading-relaxed text-brand-ink/45">
                {stored?.source ? SOURCE_NOTE[stored.source] : "Captured"}
                {profile.model ? ` · structured by ${profile.model}` : ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
              Nothing captured yet. A public page — GitHub, a personal site, an online CV — is read
              from the link. LinkedIn refuses automated reads, so open the profile in your browser
              and paste the page, or upload it through “… → Save to PDF”.
            </p>
          )}

          {!profile && stored?.error && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">
              Last read: {stored.error}
            </p>
          )}

          {canWrite && (
            <div className="mt-4 rounded-xl border border-brand-line bg-white p-3">
              <div className="flex gap-2">
                {CAPTURE_DOORS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setDoor(option.key);
                      setError(null);
                      setHint(null);
                      setMessage(null);
                    }}
                    aria-pressed={door === option.key}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                      door === option.key
                        ? "border-brand-ink bg-brand-ink text-brand-cream"
                        : "border-brand-line bg-brand-ivory text-brand-ink/65 hover:bg-brand-sand"
                    )}
                  >
                    <option.icon className="h-3.5 w-3.5" aria-hidden />
                    {option.label}
                  </button>
                ))}
              </div>

              {door === "URL" && (
                <div className="mt-3 space-y-2">
                  <TextInput
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={prospect.linkedin_url ?? "https://github.com/username"}
                    aria-label="Profile link to read"
                  />
                  <p className="text-[11px] leading-relaxed text-brand-ink/45">
                    {prospect.linkedin_url
                      ? "Leave empty to read the link already on this record. Any other public page is remembered here once read."
                      : "GitHub, a personal site, an online CV — anything that answers a plain request."}
                  </p>
                  <Button variant="outline" size="sm" onClick={readFromLink} disabled={pending}>
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden />
                    )}
                    {profile ? "Read again" : "Read profile"}
                  </Button>
                </div>
              )}

              {door === "PASTE" && (
                <div className="mt-3 space-y-2">
                  <TextArea
                    rows={7}
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value)}
                    placeholder="Select all on the profile page and paste — headline, about, experience, education, certifications, projects, skills."
                    aria-label="Profile text copied from the page"
                  />
                  <Button variant="outline" size="sm" onClick={readFromPaste} disabled={pending}>
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                    Structure the pasted page
                  </Button>
                </div>
              )}

              {door === "FILE" && (
                <div className="mt-3 space-y-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,application/pdf"
                    onChange={uploadExport}
                    className="hidden"
                    aria-label="Profile export to upload"
                  />
                  <p className="text-[11px] leading-relaxed text-brand-ink/45">
                    A LinkedIn “Save to PDF”, a downloaded CV, or any Word/plain-text export. The
                    file is read, not stored.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInput.current?.click()}
                    disabled={pending}
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="h-4 w-4" aria-hidden />
                    )}
                    Choose a file
                  </Button>
                </div>
              )}

              <FormMessage error={error} success={message} />
              {hint && (
                <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">{hint}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SectionBlock({
  profile,
  section,
}: {
  profile: ProspectProfile;
  section: ProfileSectionCount;
}) {
  const openByDefault = section.key === "experience" || section.key === "skills";

  return (
    <details
      className="rounded-xl border border-brand-line bg-white"
      open={openByDefault || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold">
        {section.label}
        <span className="text-[11px] font-normal text-brand-ink/45">
          {section.count} item{section.count > 1 ? "s" : ""}
        </span>
      </summary>

      {section.key === "experience" && (
        <ul className="space-y-3 border-t border-brand-line px-3.5 py-3">
          {profile.experience.map((role, index) => (
            <li key={`${role.title}-${index}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-semibold">{role.title}</span>
                {role.company && <span className="text-sm text-brand-ink/65">· {role.company}</span>}
                <span className="text-[11px] text-brand-ink/45">
                  {[role.start, role.present ? "Present" : role.end].filter(Boolean).join(" – ")}
                  {role.location ? ` · ${role.location}` : ""}
                </span>
              </div>
              {role.detail && (
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-brand-ink/65">
                  {role.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {section.key === "education" && (
        <ul className="space-y-2.5 border-t border-brand-line px-3.5 py-3">
          {profile.education.map((entry, index) => (
            <li key={`${entry.school}-${index}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">{entry.school}</span>
                <span className="text-sm text-brand-ink/65">
                  {[entry.degree, entry.field].filter(Boolean).join(" · ")}
                </span>
                <span className="text-[11px] text-brand-ink/45">
                  {[entry.start, entry.end].filter(Boolean).join(" – ")}
                </span>
              </div>
              {entry.detail && (
                <p className="mt-1 text-xs leading-relaxed text-brand-ink/65">{entry.detail}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {section.key === "certifications" && (
        <ul className="space-y-2 border-t border-brand-line px-3.5 py-3">
          {profile.certifications.map((cert, index) => (
            <li key={`${cert.name}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold">{cert.name}</span>
              {cert.issuer && <span className="text-xs text-brand-ink/60">{cert.issuer}</span>}
              {cert.issued_at && (
                <span className="text-[11px] text-brand-ink/45">{cert.issued_at}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {section.key === "projects" && (
        <ul className="space-y-2.5 border-t border-brand-line px-3.5 py-3">
          {profile.projects.map((project, index) => (
            <li key={`${project.name}-${index}`}>
              <span className="text-sm font-semibold">{project.name}</span>
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-[11px] text-brand-gold-dark hover:underline"
                >
                  open
                </a>
              )}
              {project.description && (
                <p className="mt-1 text-xs leading-relaxed text-brand-ink/65">
                  {project.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {(section.key === "skills" || section.key === "languages") && (
        <ul className="flex flex-wrap gap-1.5 border-t border-brand-line px-3.5 py-3">
          {(section.key === "skills" ? profile.skills : profile.languages).map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="rounded-lg bg-brand-sand px-2.5 py-1 text-xs font-semibold text-brand-ink/75"
            >
              {item}
            </li>
          ))}
        </ul>
      )}

      {section.key === "links" && (
        <ul className="space-y-1.5 border-t border-brand-line px-3.5 py-3 text-sm">
          {profile.links.map((link, index) => (
            <li key={`${link.url}-${index}`}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-gold-dark hover:underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/* -------------------------------------------------------------------------- */

function ComposerDrawer({
  rows,
  copy,
  onClose,
  onSent,
}: {
  rows: ProspectRow[];
  copy: Record<OutreachChannel, { subject: string; body: string }>;
  onClose: () => void;
  onSent: (summary: string) => void;
}) {
  const [channel, setChannel] = useState<OutreachChannel>(rows.some((r) => r.email) ? "EMAIL" : "WHATSAPP");
  const [subject, setSubject] = useState(copy.EMAIL.subject);
  const [body, setBody] = useState(copy[channel].body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reachable = rows.filter((row) => (channel === "EMAIL" ? row.email : row.phone)).length;

  function pickChannel(next: OutreachChannel) {
    setChannel(next);
    setBody(next === "EMAIL" ? copy.EMAIL.body : copy.WHATSAPP.body);
    setError(null);
  }

  function send() {
    if (!body.trim()) {
      setError("The message cannot be empty.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const outcome = await sendProspectOutreach({
        ids: rows.map((row) => row.id),
        channel,
        subject: channel === "EMAIL" ? subject : undefined,
        body,
      });
      if (!outcome.ok) {
        setError(outcome.error ?? "Nothing was sent.");
        return;
      }
      const summary = `Sent to ${outcome.sent}${outcome.failed ? `, refused by the relay for ${outcome.failed}` : ""}${
        outcome.skipped ? `, ${outcome.skipped} without a ${channel === "EMAIL" ? "email" : "phone"} on file` : ""
      }.`;
      onSent(summary);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow="First touch"
      title={`Message ${rows.length} prospect${rows.length > 1 ? "s" : ""}`}
      subtitle="Placeholders are replaced per person, so each message names them and the role."
      footer={
        <DrawerActions
          onCancel={onClose}
          submitLabel={pending ? "Sending…" : `Send on ${channel === "EMAIL" ? "email" : "WhatsApp"}`}
          pending={pending}
          disabled={reachable === 0}
          note={`${reachable} of ${rows.length} can be reached on this channel.`}
        />
      }
      onSubmit={send}
    >
      <div className="flex gap-2">
        {(["EMAIL", "WHATSAPP"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => pickChannel(option)}
            aria-pressed={channel === option}
            className={cn(
              "flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition",
              channel === option
                ? "border-brand-ink bg-brand-ink text-brand-cream"
                : "border-brand-line bg-white text-brand-ink/65 hover:bg-brand-sand"
            )}
          >
            {option === "EMAIL" ? "Email" : "WhatsApp"}
          </button>
        ))}
      </div>

      {channel === "EMAIL" && (
        <Field label="Subject" htmlFor="composer-subject" className="mt-4">
          <TextInput id="composer-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
      )}

      <Field
        label="Message"
        htmlFor="composer-body"
        hint="{{candidate_name}} · {{job_title}} · {{company_name}} — edit freely, what you see is what is sent."
        className="mt-4"
      >
        <TextArea
          id="composer-body"
          rows={channel === "EMAIL" ? 10 : 6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>

      <p className="mt-3 text-[11px] leading-relaxed text-brand-ink/45">
        The copy starts from Settings → Access &amp; comms → Templates, so a recruiter can change the
        first-touch letter once and have it apply to every import.
      </p>

      <FormMessage error={error} />
    </Drawer>
  );
}
