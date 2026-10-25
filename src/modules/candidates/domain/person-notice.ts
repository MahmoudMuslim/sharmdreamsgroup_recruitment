/**
 * One consent notice paragraph per group (spec §3.2). `person-notice.ts` is
 * the wording a candidate is shown when they are asked to agree to a
 * `person_consents` purpose, and `NOTICE_VERSION` is the label a consent row
 * is stamped with so a later desk can name exactly which paragraph someone
 * agreed to (the newest-row-wins + versioned rule copied from
 * `db/migrations/041_privacy.sql`).
 *
 * Not legal advice. This file is the owner's draft for their own review, and
 * the spec's rule (§3.2) is that the notice ships beside the store rather
 * than in a database comment, so the wording and the store cannot drift.
 *
 * Each paragraph carries the four things §3.2 names, in this order:
 *   1. why the group is asked,
 *   2. who reads it (staff generally; for the Tier-3 groups only the holder
 *      of the named grant, with every open logged — spec §3.5 / §1.11),
 *   3. that it is not used to score (spec "Not in this slice" excludes every
 *      background field from scoring; `marital_status` and the housing counts
 *      stay readable during human screening, and the copy says so rather than
 *      claiming a purity the design does not have),
 *   4. how to withdraw — by asking a staff member at the recruitment desk to
 *      record the withdrawal, never a self-serve URL: this slice builds no
 *      candidate-portal door and no self-service correction door, so naming a
 *      link would be a fiction. Withdrawal is a later `granted = false` row,
 *      not a delete; the stored value is then withheld by the reader.
 *
 * The `extraction` entry gates an AI action, not a stored column — no registry
 * field carries it (see person-fields.ts) — so its paragraph describes the act
 * of handing a CV to a model and what is refused and checked before it becomes
 * a profile fact (spec §5).
 *
 * Pure module — no imports from `app`, nothing async, no database.
 */
import type { PersonFieldGroup } from "./person-fields";

/** The version every consent row is stamped against while this wording is in force. */
export const NOTICE_VERSION = "2026-10-25";

export interface PersonNotice {
  title: string;
  body: string;
  withdraw: string;
}

const NOTICE: Record<PersonFieldGroup, PersonNotice> = {
  identity: {
    title: "Your basic identity",
    body:
      "We keep your legal name, the name and pronouns you prefer, your gender as you wrote it, your date of birth, birthplace, nationality and national ID so there is one clear record of who you are and so we can confirm the CV belongs to you. Your age is never stored — it is worked out from your date of birth when a screen shows it. Staff who can open a candidate record read these fields. None of them is entered into an automatic score or used by an AI to rank you: your gender, birthplace and nationality are recorded, not weighed. On the national ID specifically: it sits in a plain, unencrypted column on the server we run, because a job record is expected to carry it and not because that location is safe — we are telling you that exposure rather than hiding it.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record a withdrawal for you against notice version 2026-10-25. There is no self-serve switch, and withdrawing does not delete what we already hold — it is marked withdrawn and then withheld from view.",
  },

  contact: {
    title: "How we reach you",
    body:
      "We keep a phone number, a mailing address and the city you are currently in so we can contact you about an application and know roughly where you are based. Staff working on your application read these fields. They are not used to score or rank you; your location may open a plain conversation about commuting or relocation, but it never feeds a number attached to your name.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. There is no self-serve switch.",
  },

  work_history: {
    title: "Your jobs and experience",
    body:
      "We keep each role as a dated line — employer, title and the years (and, where the CV gives them, the months) you held it — so we can add up your total experience and see continuity from real dates instead of guessing from a paragraph. This may be built from your CV. Recruiters reviewing you read it. The years and gaps we show are plain numbers that state how precise they are; they are deliberately not combined into an automatic score, and no AI ranks you with them.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. There is no self-serve switch.",
  },

  education: {
    title: "Your education",
    body:
      "We keep each stage of your schooling as a dated line — institution, level, field and the years — so \"highest education\" is a figure derived from real records rather than a phrase in a CV. This may be built from your CV. Recruiters reviewing you read it. It is not used to score or rank you automatically.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. There is no self-serve switch.",
  },

  languages: {
    title: "The languages you speak",
    body:
      "We keep the languages you list and, where you gave it, how well you speak each, so a person reviewing you can see your languages as separate facts rather than rereading a paragraph. This may be built from your CV. Recruiters read it. It is not used to score or rank you automatically.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. There is no self-serve switch.",
  },

  skills: {
    title: "Your skills and certifications",
    body:
      "We keep the skills you claim — in your own words, and the level only if you stated one — and any courses or certificates you hold, so a person reviewing you can see what you say you can do. This may be built from your CV. Recruiters read it. Comparing your claims against a job's required skills is a separate, later step and, when it exists, is a human comparison; nothing here turns into an automatic score, and we never invent a skill level your CV did not state.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. There is no self-serve switch.",
  },

  photo: {
    title: "Your photograph",
    body:
      "We keep a photo of you so the people handling your record can recognise you. Staff viewing the candidate record can see it. It is deliberately kept out of every AI prompt, out of screening, and out of any blind-graded assessment: a model never sees your photo, and it is never used to score you.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. Withdrawing hides it from view; the photo is removed from the disk only when your record is erased.",
  },

  marital_status: {
    title: "Marital status and number of children",
    body:
      "We keep your marital status and how many children you have because our field list asked us to record them. Being honest about the use: a recruiter may read these when shaping an initial view of you, which is a screening use, not a scoring one — they are never entered into an automatic score or used by an AI to rank you, and no verdict about your work is attached to them. You are free to decline the whole group; declining hides both answers and is itself a valid record.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25, after which the answers are withheld from view. There is no self-serve switch.",
  },

  family_details: {
    title: "Family details",
    body:
      "This group holds information about other people that you chose to share: a partner's name, work and contact, your wedding date, who lives in your house, and your family-planning answers. We are not pretending these help us judge your work — they are recorded because our field list asked for them. Only staff who hold the dedicated family-data permission can read them, and every time one of those records is opened the access is logged. These details are not used to screen or score you.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. Withdrawing hides the answers; the rows themselves are deleted only when your person record is erased.",
  },

  dependants: {
    title: "Your dependants",
    body:
      "We keep the names and dates of birth of the children or other dependants you volunteer. This is other people's personal data, held only because you shared it. Only staff who hold the family-data permission can read these rows, and each open is logged. They are not used to screen or score you. When your record is erased, a dependant's row is deleted outright — we do not rewrite a real child's name into an anonymous placeholder, because that would invent a record of someone who never existed.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25, after which the rows are hidden from view.",
  },

  emergency_contacts: {
    title: "Emergency contacts",
    body:
      "We keep up to two people to call if you are hurt or in trouble at work. This is a safety purpose, not a hiring purpose. Only staff who hold the separate emergency-contacts permission can read them, and that permission gives them nothing used for screening. Emergency contacts are never used to score you.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. We will ask you to keep at least one reachable contact for your own safety, but withdrawing your consent to store them is yours to make.",
  },

  health: {
    title: "Health and disability",
    body:
      "This is the special-category group: your disability status, any accommodations you need, chronic conditions, allergies, dietary needs, blood type and health-insurance status. We ask so that we can arrange access, adjustments and a safe working environment, and because our field list asked us to record it — we are not going to pretend that a blood type or a dietary note makes you a better candidate. Only staff who hold the dedicated health-data permission can read this table, and every time it is opened the access is logged. Your health answers are never handed to a model, never used to screen, and never used to score you. Each question is optional: you can decline and leave the whole group unanswered, and that is kept apart from never having been asked.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. Withdrawing hides the answers from everyone; the health rows themselves are deleted when your person record is erased.",
  },

  housing: {
    title: "Housing and commute",
    body:
      "We keep your household size, your housing situation, how you commute and for how long, whether you are willing to relocate, and any travel restrictions. These help with the practical side of a role and, where relevant, with adjustments. Staff who can open your record read them. They are not used to score or rank you; a willingness to relocate is a thing to discuss with you, not a number attached to your name.",
    withdraw:
      "To withdraw your agreement to this group, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25, after which the answers are withheld from view. There is no self-serve switch.",
  },

  extraction: {
    title: "Turning your CV into structured facts",
    body:
      "This agreement is about an action, not a field: it is your permission for us to hand your CV to a model to be read and turned into dated job, education, language, skill and certificate lines. The model is instructed to report only those operational facts and to say nothing about marriage, children, health, disability, religion, nationality, blood type, housing or your address; anything it returns outside the allowed operational list is dropped and named to a human before anything is saved. We do not trust the model's reading on its own: a recruiter previews what it found and confirms it, and a person may check it, before any of it becomes a profile fact. A value taken from the CV may fill a field that was empty, but it may never overwrite something a person set by hand. Nothing extracted is used to score you, and structuring your CV is a deliberate click, never an automatic side effect of filing a name.",
    withdraw:
      "To withdraw your agreement to this action, ask a staff member at the recruitment desk to record the withdrawal for you against notice version 2026-10-25. Withdrawing stops any future structuring of your CV; lines a recruiter already confirmed stay in your record until you ask for them to be removed.",
  },
};

/**
 * The notice shown for a consent purpose. Exhaustive by construction: the
 * `Record<PersonFieldGroup, …>` type means the compiler rejects this module if
 * any of the fourteen groups is missing an entry, so there is no `undefined`
 * branch and no group can ship without its wording.
 */
export function noticeFor(group: PersonFieldGroup): PersonNotice {
  return NOTICE[group];
}
