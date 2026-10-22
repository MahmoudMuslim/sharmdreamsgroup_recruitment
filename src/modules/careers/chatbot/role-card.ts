/**
 * The facts the careers assistant is allowed to repeat.
 *
 * A chatbot on a hiring page does damage in one direction only: it says
 * something about pay, hours or a decision that the employer never said. So the
 * assistant gets no knowledge of its own — it gets this card, built from the
 * same rows the page printed, and an instruction to answer from nothing else.
 * Anything the card does not carry, the candidate is told the page does not
 * state it.
 *
 * The card is a rendering, not a query: whoever calls it already has the
 * opening and the company in hand, because the page did. That keeps the answer
 * and the page unable to disagree.
 */

import {
  employmentLabel,
  experienceLabel,
  sectorLabel,
  type PublicJob,
} from "@/modules/careers/job-board";
import type { PublicCompany } from "@/modules/careers/company-profile";
import { formatSalaryRange } from "@/lib/currency";

/** Long enough for a real job ad, short enough that the card is not the prompt. */
const DESCRIPTION_CHARS = 1500;
const REQUIREMENT_LINES = 15;
const BOARD_ROLES = 25;

/** Title plus its sentence, so the bot can say what a benefit actually is. */
function benefitList(benefits: PublicCompany["benefits"]): string {
  return benefits
    .map((benefit) =>
      benefit.text?.trim()
        ? `${benefit.title} — ${benefit.text.trim().slice(0, 160)}`
        : benefit.title
    )
    .join("; ");
}

function line(label: string, value: string | null | undefined): string[] {
  const text = value?.trim();
  return text ? [`${label}: ${text}`] : [];
}

/** Stated as absent, because a missing salary is a fact the bot must not guess. */
function salaryLine(job: PublicJob): string {
  const range = formatSalaryRange({
    min: job.min_salary_usd,
    max: job.max_salary_usd,
    currency: job.salary_currency,
  });
  return range ? `Salary range: ${range}` : "Salary range: not stated on this page";
}

function companyBlock(company: PublicCompany | null): string[] {
  if (!company) return [];
  return [
    `COMPANY — ${company.name}`,
    ...line("Tagline", company.tagline),
    ...line("What it does", company.description),
    ...line("Why work here", company.careers_pitch),
    ...line("Headquarters", company.headquarters),
    ...line("Sector", sectorLabel(company.sector)),
    ...(company.benefits.length ? [`Benefits listed: ${benefitList(company.benefits)}`] : []),
  ];
}

function groupBlock(group: PublicCompany | null): string[] {
  if (!group) return [];
  return [
    `GROUP — ${group.name}`,
    ...line("Tagline", group.tagline),
    ...line("Story", group.history),
    ...line("Why work here", group.careers_pitch),
    ...(group.benefits.length
      ? [`What the group offers its people: ${group.benefits.map((b) => b.title).join("; ")}`]
      : []),
  ];
}

function roleBlock(job: PublicJob, company: PublicCompany | null): string[] {
  return [
    `ROLE ON SCREEN — ${job.title}`,
    ...line("Company", company?.name ?? job.company_name),
    ...line("Department", job.department),
    ...line("Sector", sectorLabel(job.sector)),
    ...line("Location", job.location),
    ...line("Employment type", employmentLabel(job.employment_type)),
    ...line(
      "Experience level",
      job.experience_level ? experienceLabel(job.experience_level) : null
    ),
    salaryLine(job),
    ...(job.requirements.length
      ? [
          `What we are looking for:\n${job.requirements
            .slice(0, REQUIREMENT_LINES)
            .map((each) => `- ${each}`)
            .join("\n")}`,
        ]
      : ["Requirements: not listed on this page"]),
    job.description.trim()
      ? `The role as advertised:\n${job.description.trim().slice(0, DESCRIPTION_CHARS)}`
      : "Description: none published for this role",
  ];
}

/** One line per opening, so a question about a different role has an answer. */
function roster(jobs: PublicJob[], companies: PublicCompany[]): string[] {
  const named = new Map(companies.map((company) => [company.id, company.name]));

  return jobs.slice(0, BOARD_ROLES).map((job) => {
    const companyName = job.company_id ? named.get(job.company_id) : undefined;
    const range = formatSalaryRange({
      min: job.min_salary_usd,
      max: job.max_salary_usd,
      currency: job.salary_currency,
    });
    return [
      `- ${job.title}`,
      companyName ?? job.company_name ?? "the group",
      job.location,
      employmentLabel(job.employment_type),
      job.experience_level ? experienceLabel(job.experience_level) : null,
      range || "salary not stated",
    ]
      .filter((part): part is string => Boolean(part))
      .join(" | ");
  });
}

/**
 * The card for a single role page: this opening, its company, the group behind
 * it, and the rest of the board so "do you have anything closer to Cairo?" has
 * something true to answer with.
 */
export function roleCard(input: {
  job: PublicJob;
  company: PublicCompany | null;
  group: PublicCompany | null;
  otherJobs: PublicJob[];
  companies: PublicCompany[];
}): string {
  return [
    ...groupBlock(input.group),
    "",
    ...roleBlock(input.job, input.company),
    "",
    ...companyBlock(input.company),
    "",
    input.otherJobs.length
      ? `OTHER ROLES OPEN TODAY — ${input.otherJobs.length}\n${roster(input.otherJobs, input.companies).join("\n")}`
      : "OTHER ROLES OPEN TODAY: none besides this one",
  ]
    .join("\n")
    .trim();
}

/** The card for the board: the group and everything it is hiring for. */
export function boardCard(input: {
  jobs: PublicJob[];
  companies: PublicCompany[];
  group: PublicCompany | null;
}): string {
  return [
    ...groupBlock(input.group),
    "",
    `ROLES OPEN TODAY — ${input.jobs.length}\n${
      input.jobs.length ? roster(input.jobs, input.companies).join("\n") : "- none published"
    }`,
    "",
    `COMPANIES IN THE GROUP\n${
      input.companies.length
        ? input.companies.map((company) => `- ${company.name}`).join("\n")
        : "- none listed"
    }`,
  ]
    .join("\n")
    .trim();
}

/**
 * The suggestions printed under the greeting.
 *
 * Keys, not sentences, so they arrive in the language the visitor chose. And a
 * suggestion is only offered when the card actually holds the answer: asking
 * "What is the pay?" about a role that states no range would set up the one
 * reply that makes the assistant look useless.
 */
export function starterKeys(input: {
  job: PublicJob | null;
  company: PublicCompany | null;
  group: PublicCompany | null;
  otherRoleCount: number;
}): string[] {
  const { job, company, group } = input;
  const keys: string[] = [];

  if (job) {
    if (job.min_salary_usd !== null || job.max_salary_usd !== null) keys.push("chat.askSalary");
    if (job.description.trim()) keys.push("chat.askDuties");
    if (job.requirements.length) keys.push("chat.askLooking");
    keys.push("chat.askLocation");
  }

  const benefits = group?.benefits.length ? group : company?.benefits.length ? company : null;
  if (benefits) keys.push("chat.askBenefits");
  if (job && input.otherRoleCount > 0) keys.push("chat.askOther");
  if (!job) keys.push("chat.askRoles");

  keys.push("chat.askProcess");

  return [...new Set(keys)].slice(0, 4);
}
