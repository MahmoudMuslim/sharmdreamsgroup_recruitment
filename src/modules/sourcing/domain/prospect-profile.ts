/**
 * A sourced prospect's professional profile.
 *
 * This is the shape every reader produces and every writer stores: a page
 * fetched from a URL, text a recruiter pasted out of a profile they can see, or
 * a PDF/Word export they downloaded — all of them end up here.
 *
 * Deliberately pure (no "server-only", no database) so the sourcing drawer can
 * import the types to render a stored profile, and so the validator that guards
 * model output is the same code the browser reads.
 *
 * Nothing in here invents content. A section an author did not fill stays an
 * empty array, and the UI shows only what has entries, so a profile never looks
 * complete because the reader returned blanks.
 */

export interface ProfileRole {
  title: string;
  company: string | null;
  location: string | null;
  /** Free-text start as the page wrote it ("2019", "Mar 2021"). */
  start: string | null;
  end: string | null;
  /** True when the page marked the role as current. */
  present: boolean;
  detail: string | null;
}

export interface ProfileEducation {
  school: string;
  degree: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
  detail: string | null;
}

export interface ProfileCertification {
  name: string;
  issuer: string | null;
  issued_at: string | null;
}

export interface ProfileProject {
  name: string;
  description: string | null;
  url: string | null;
}

export interface ProfileLink {
  label: string;
  url: string;
}

export interface ProspectProfile {
  headline: string | null;
  location: string | null;
  summary: string | null;
  experience: ProfileRole[];
  education: ProfileEducation[];
  certifications: ProfileCertification[];
  projects: ProfileProject[];
  skills: string[];
  languages: string[];
  links: ProfileLink[];
  /** The model that structured this, so the drawer can name it. */
  model: string | null;
}

export type ProfileSource = "URL" | "PASTE" | "FILE";

/**
 * Ceilings on one profile.
 *
 * A reader hands whatever it found to a language model, and a model asked for
 * "every role" will happily return two hundred. These caps bound the stored
 * jsonb, the drawer, and the prompt the profile later goes into.
 */
const LIMITS = {
  roles: 40,
  education: 20,
  certifications: 30,
  projects: 30,
  skills: 80,
  languages: 20,
  links: 20,
  title: 160,
  company: 160,
  place: 160,
  date: 40,
  school: 200,
  degree: 160,
  detail: 1_200,
  summary: 2_000,
  name: 200,
  url: 400,
} as const;

export function emptyProfile(): ProspectProfile {
  return {
    headline: null,
    location: null,
    summary: null,
    experience: [],
    education: [],
    certifications: [],
    projects: [],
    skills: [],
    languages: [],
    links: [],
    model: null,
  };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function block(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function strings(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    // A skill list is the one place a model returns bare strings beside objects,
    // so both arrive here and only clean entries survive.
    const bare = typeof item === "string" || typeof item === "number" ? text(item, max) : null;
    const named =
      bare ??
      (item && typeof item === "object"
        ? text((item as Record<string, unknown>).name ?? (item as Record<string, unknown>).title, max)
        : null);
    if (named && !out.some((kept) => kept.toLowerCase() === named.toLowerCase())) out.push(named);
    if (out.length >= cap) break;
  }
  return out;
}

function url(value: unknown): string | null {
  const raw = text(value, LIMITS.url);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Turns whatever a model returned into a profile, dropping what is unusable.
 *
 * Model output is an untrusted boundary: it can be an object where an array
 * belongs, a number where a year should be, or a URL field holding prose. Every
 * field is read defensively and re-clipped, because a stored profile is rendered
 * straight back into the browser and into the screening prompt later.
 */
export function normalizeProspectProfile(raw: unknown): ProspectProfile {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const roles: ProfileRole[] = list(source.experience)
    .map((item) => ({
      title: text(item.title ?? item.role ?? item.position, LIMITS.title) ?? "",
      company: text(item.company ?? item.organization ?? item.employer, LIMITS.company),
      location: text(item.location ?? item.place, LIMITS.place),
      start: text(item.start ?? item.start_date ?? item.from, LIMITS.date),
      end: text(item.end ?? item.end_date ?? item.to ?? item.until, LIMITS.date),
      present:
        item.present === true ||
        item.current === true ||
        /^(present|current|now|ongoing)$/i.test(String(item.end ?? "")),
      detail: block(item.detail ?? item.description ?? item.summary, LIMITS.detail),
    }))
    // A page that only states an affiliation echoes it into both halves of the
    // role. That is a company, not a job, and "Linux Foundation — Linux
    // Foundation" in the CV text would mislead the screening step that follows.
    .filter((role) => role.title.length > 1 && role.title.toLowerCase() !== (role.company ?? "").toLowerCase())
    .slice(0, LIMITS.roles);

  const education: ProfileEducation[] = list(source.education)
    .map((item) => ({
      school: text(item.school ?? item.institution ?? item.university, LIMITS.school) ?? "",
      degree: text(item.degree ?? item.qualification, LIMITS.degree),
      field: text(item.field ?? item.major ?? item.subject, LIMITS.degree),
      start: text(item.start ?? item.from ?? item.start_date, LIMITS.date),
      end: text(item.end ?? item.to ?? item.graduation ?? item.end_date, LIMITS.date),
      detail: block(item.detail ?? item.description, LIMITS.detail),
    }))
    .filter((entry) => entry.school.length > 1)
    .slice(0, LIMITS.education);

  const certifications: ProfileCertification[] = list(source.certifications)
    .map((item) => ({
      name: text(item.name ?? item.title ?? item.certification, LIMITS.name) ?? "",
      issuer: text(item.issuer ?? item.organization ?? item.issued_by, LIMITS.company),
      issued_at: text(item.issued_at ?? item.date ?? item.issued, LIMITS.date),
    }))
    .filter((item) => item.name.length > 1)
    .slice(0, LIMITS.certifications);

  const projects: ProfileProject[] = list(source.projects)
    .map((item) => ({
      name: text(item.name ?? item.title, LIMITS.name) ?? "",
      description: block(item.description ?? item.detail ?? item.summary, LIMITS.detail),
      url: url(item.url ?? item.link),
    }))
    .filter((item) => item.name.length > 1)
    .slice(0, LIMITS.projects);

  const links: ProfileLink[] = list(source.links)
    .map((item) => ({
      label: text(item.label ?? item.name ?? item.title, LIMITS.name) ?? "",
      url: url(item.url ?? item.link) ?? "",
    }))
    .filter((item) => item.url.length > 0)
    .slice(0, LIMITS.links);

  const profile: ProspectProfile = {
    headline: text(source.headline ?? source.title ?? source.position, LIMITS.title),
    location: text(source.location, LIMITS.place),
    summary: block(source.summary ?? source.bio, LIMITS.summary),
    experience: roles,
    education,
    certifications,
    projects,
    skills: strings(source.skills, LIMITS.name, LIMITS.skills),
    languages: strings(source.languages, LIMITS.name, LIMITS.languages),
    links,
    model: text(source.model, LIMITS.name),
  };

  return profile;
}

export function profileIsEmpty(profile: ProspectProfile): boolean {
  return (
    !profile.headline &&
    !profile.location &&
    !profile.summary &&
    profile.experience.length === 0 &&
    profile.education.length === 0 &&
    profile.certifications.length === 0 &&
    profile.projects.length === 0 &&
    profile.skills.length === 0 &&
    profile.languages.length === 0 &&
    profile.links.length === 0
  );
}

export interface ProfileSectionCount {
  key: string;
  label: string;
  count: number;
}

/** Only the sections that hold something, in display order. */
export function profileSections(profile: ProspectProfile): ProfileSectionCount[] {
  return [
    { key: "experience", label: "Experience", count: profile.experience.length },
    { key: "education", label: "Education", count: profile.education.length },
    { key: "certifications", label: "Licenses & certifications", count: profile.certifications.length },
    { key: "projects", label: "Projects", count: profile.projects.length },
    { key: "skills", label: "Skills", count: profile.skills.length },
    { key: "languages", label: "Languages", count: profile.languages.length },
    { key: "links", label: "Links", count: profile.links.length },
  ].filter((section) => section.count > 0);
}

function dates(role: { start: string | null; end: string | null; present: boolean }): string {
  const start = role.start ?? "";
  const end = role.present ? "Present" : role.end ?? "";
  return [start, end].filter(Boolean).join(" – ");
}

/**
 * The profile written out as a CV.
 *
 * A converted prospect never uploaded a CV, so this is what the screening step
 * reads instead of an empty record. Section order matches a document a recruiter
 * would recognise, and a missing section is skipped rather than announced — the
 * screening prompt asks about a CV, not about a database row.
 */
export function renderProfileText(profile: ProspectProfile): string {
  const parts: string[] = [];

  if (profile.headline) parts.push(`HEADLINE: ${profile.headline}`);
  if (profile.location) parts.push(`LOCATION: ${profile.location}`);
  if (profile.summary) parts.push(`SUMMARY:\n${profile.summary}`);

  if (profile.experience.length) {
    parts.push(
      "EXPERIENCE:",
      ...profile.experience.map((role) => {
        const head = [role.title, role.company].filter(Boolean).join(" — ");
        const span = dates(role);
        const line = `- ${head}${span ? ` (${span})` : ""}${role.location ? ` — ${role.location}` : ""}`;
        return role.detail ? `${line}\n${role.detail}` : line;
      })
    );
  }

  if (profile.education.length) {
    parts.push(
      "EDUCATION:",
      ...profile.education.map((entry) => {
        const study = [entry.degree, entry.field].filter(Boolean).join(", ");
        const span = [entry.start, entry.end].filter(Boolean).join(" – ");
        return `- ${entry.school}${study ? ` — ${study}` : ""}${span ? ` (${span})` : ""}${
          entry.detail ? `\n${entry.detail}` : ""
        }`;
      })
    );
  }

  if (profile.certifications.length) {
    parts.push(
      "LICENSES & CERTIFICATIONS:",
      ...profile.certifications.map((item) =>
        `- ${item.name}${item.issuer ? ` — ${item.issuer}` : ""}${item.issued_at ? ` (${item.issued_at})` : ""}`
      )
    );
  }

  if (profile.projects.length) {
    parts.push(
      "PROJECTS:",
      ...profile.projects.map((item) =>
        `- ${item.name}${item.url ? ` — ${item.url}` : ""}${item.description ? `\n${item.description}` : ""}`
      )
    );
  }

  if (profile.skills.length) parts.push(`SKILLS: ${profile.skills.join(", ")}`);
  if (profile.languages.length) parts.push(`LANGUAGES: ${profile.languages.join(", ")}`);
  if (profile.links.length) {
    parts.push("LINKS:", ...profile.links.map((item) => `- ${item.label || item.url} — ${item.url}`));
  }

  return parts.join("\n").trim();
}

/**
 * Which of a profile's skills exist in the platform's skill catalogue.
 *
 * `candidate_skills.skill_id` is a foreign key to the seeded `skills` table, so
 * only a catalogue name can be stored. Matching is on the normalised label, in
 * both directions, because a profile says "Excel (advanced)" and the catalogue
 * says "Excel", or the reverse. Anything unmatched stays in the profile jsonb —
 * it is real data about the person, just not a row anyone can filter on yet.
 */
export function matchCatalogueSkills(
  profile: ProspectProfile,
  catalogue: { id: string; name: string }[]
): { id: string; name: string }[] {
  const given = profile.skills.map((skill) => skill.toLowerCase().trim());
  const matched: { id: string; name: string }[] = [];

  for (const skill of catalogue) {
    const name = skill.name.toLowerCase().trim();
    if (!name) continue;
    const hit = given.some(
      (skill_text) =>
        skill_text === name ||
        (skill_text.length >= 4 && name.startsWith(skill_text)) ||
        (name.length >= 4 && skill_text.startsWith(name))
    );
    if (hit && !matched.some((kept) => kept.id === skill.id)) matched.push({ id: skill.id, name: skill.name });
  }

  return matched;
}
