"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload
} from "lucide-react";
import {
  FormMessage,
  TextArea,
  TextInput
} from "@/modules/analytics/presentation/Form";
import {
  Badge,
  Button
} from "@/modules/analytics/presentation/ui";
import {
  profileSections,
  type ProfileSectionCount,
  type ProspectProfile
} from "@/modules/sourcing/domain/prospect-profile";
import {
  getProspectProfile,
  pasteProspectProfile,
  readProspectProfile,
  uploadProspectProfile,
  type StoredProspectProfile
} from "./profile-actions";
import { cn } from "@/lib/utils";
import {
  type ProspectRow
} from "./actions";

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
export function ProfilePanel({
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
