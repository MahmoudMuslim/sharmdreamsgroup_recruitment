import { STAFF_ROUTES, type StaffRoute } from "@/lib/auth/staffRoutes";

/**
 * The page-by-page half of the app bar's Guide panel.
 *
 * Written as a `Record<StaffRoute, PageGuide>` rather than a list, on purpose:
 * a page added to `STAFF_ROUTES` without a guide stops compiling, which is the
 * same trick that made the rail's links, the alert destinations and the live
 * watch list un-forgettable. A guide that quietly falls behind the portal is
 * worse than no guide, because it is read as the manual.
 *
 * Every bullet here was read out of the page's own render and action modules —
 * the caps, the refusal sentences, the permission strings and the controls by
 * the label on screen. Where a page's header overstates what its query does,
 * the guide describes the query.
 */
export interface PageGuide {
  /** One sentence: what this screen is for. */
  purpose: string;
  /** What it reads and puts on screen. */
  shows: string[];
  /** What a person can actually do here, by the label on the control. */
  use: string[];
  /** Refusals, caps, permissions and the things this page cannot claim. */
  edges: string[];
}

export const PAGE_GUIDE: Record<StaffRoute, PageGuide> = {
  "/dashboard": {
    purpose: "The live shape of the pipeline: what is in it now, and where each application is waiting.",
    shows: [
      "Six tiles, a daily application-flow chart, a time-to-hire strip, the stage funnel, the strongest roles, the longest-waiting applications, channel effectiveness, AI fit bands and a candidate board.",
      "Every figure is read from applications, test attempts and openings with no date window, and archived candidates are left out of all of them.",
    ],
    use: [
      "Click a tile, a funnel row, a channel, a fit band or a day bar: a drawer lists the rows behind that exact number and links each one to its candidate record.",
      "Press Filter inside a drawer to make the board below show the same rows; the chip in the board header clears it again.",
      "Switch 7d / 14d for the trend, sort the board by any column, and search it by name, role or department.",
      "Open on candidates board hands the filter over to the full pipeline list.",
    ],
    edges: [
      "The board is the newest 200 live applications. When a tile counts more than that, the header says how many are missing and — for one active filter — links to the rail that reaches them.",
      "Stage figures are populations: who sits where now, never who moved. Nothing here is a conversion rate.",
      "Fit bands, average score and the scored list are withheld without the View unmasked scores permission.",
      "A staff session is the only gate — this screen asks for no separate reporting permission.",
    ],
  },

  "/analytics": {
    purpose: "What the tests, the outreach and the interview panels produced, over a window you choose.",
    shows: [
      "Cards for assessments, test scores, sourcing, candidate messages by channel and interview panels, each with its own trend strip, read from attempts, prospects, the message log and the interview calendar.",
    ],
    use: [
      "Pick 30 days / 90 days / 12 months / All time, then Recount to re-read every figure from the database.",
      "Click a figure, a funnel row, a channel name, a chip or a trend bar to list the rows behind it; each row links out to the candidate, the prospect or the profile it came from.",
      "CSV / Excel / PDF download the whole report at the window on screen.",
    ],
    edges: [
      "Needs the View analytics permission to open and the Export analytics permission to download.",
      "Each card is read newest-first under a fixed cap. When a cap is met the page says its figures are a floor, not a total.",
      "A portal notice is written, not delivered, so it never counts as a delivery; WhatsApp reports no read signal, which is why that row prints a dash.",
      "How long anyone sits inside a stage cannot be measured — the portal keeps the current stage, not the date each one began.",
      "The window is not in the address bar, so a bookmark or a shared link always opens on 90 days.",
    ],
  },

  "/reports": {
    purpose: "The row-level lists behind the numbers, in the same window vocabulary, as a table or a file.",
    shows: [
      "Five tabs — every application, every issued test, every sourced prospect, every candidate message, every interview panel — each one table, with a panel saying what that list can and cannot claim.",
    ],
    use: ["Switch the tab, switch the window, then take CSV, Excel or PDF. That is the whole screen."],
    edges: [
      "The screen draws the newest 150 rows and a download carries everything the read reached — which is itself capped, so a file is all that was read, not all that exists.",
      "No search, sorting, pagination or row links here; the console each report is about has those.",
      "Interview rows are windowed on their scheduled time. Every other tab windows on the record's created date.",
      "Archived candidates stay in the applications list, so its row count is not the dashboard's.",
      "Without unmasked scores the score columns are removed from the table and from the file.",
    ],
  },

  "/time": {
    purpose: "Hours the team logs, cut by person, by role and by candidate.",
    shows: [
      "Tiles for hours logged, per day, busiest day and what is running now, four breakdown cards, and the entries grouped by day.",
    ],
    use: [
      "Start a timer with what the time went on, a category and optionally an opening or a candidate. Stop and log writes the span; Discard throws it away.",
      "Add a span that already happened with its own start and end.",
      "Stop, Edit or Delete any entry you logged.",
      "Cut the view by Today / 7 / 14 / 30 days and My hours / The company, click a bar in a breakdown to show only that slice, then export CSV, Excel or PDF.",
    ],
    edges: [
      "The ledger table is not on the database yet. Until supabase/migrations/025_time_entries.sql is applied, this page reads its own empty state and every write is refused.",
      "Everything here, including the read, needs the Track time permission.",
      "Only the person who logged a span can change it, and one timer runs at a time per person.",
      "The read is the newest 1,000 entries in the cut you picked.",
    ],
  },

  "/activity": {
    purpose: "Every change the portal recorded: who — or what — made it, when, and which fields moved.",
    shows: [
      "Counts by actor kind, then the trail rows with the before and after of each field a change touched.",
    ],
    use: [
      "Filter by Person / AI / Candidate / Scheduler, by window from 24 hours to Everything, by the area it touched and by the surface it came through.",
      "Search a key, a value or a name, then Search to run it against the server.",
      "Click a row to see only that record's history, and Fields to expand what was written.",
      "Export the filtered set as CSV, Excel or PDF.",
    ],
    edges: [
      "The trail table is not on the database yet — supabase/migrations/024_activity_log.sql. Until it is applied the page says so and reads nothing.",
      "Needs the Manage platform settings permission.",
      "The screen draws the newest 120 matching rows and a download carries up to 2,000; narrow the window for the rest.",
      "Values under a secret, token, password, CV or answer key print as [withheld].",
      "A row exists only where a writer was wired to the trail, so an older change may simply not be here.",
    ],
  },

  "/candidates": {
    purpose: "The pipeline itself — every applicant, their AI score, their stage and their whole record.",
    shows: [
      "Stage, source and company rails counted in the database, the list behind them, and a profile drawer holding the submitted application, the files, the gate answers, the tests, the alerts sent, the onboarding plan and the person's other applications.",
      "A candidate's name opens their own profile page: every application they hold across every opening, with the test links, interviews, files, messages and record changes from all of them.",
    ],
    use: [
      "Click a rail to query the database for that stage rather than filter what is loaded. Search by name, email, role, company or tracking code; sort by newest, AI fit or name.",
      "Click a name for the person's profile page; the Desk button opens this application's drawer, where the buttons that write live.",
      "Advance moves someone to the next stage. Reject asks for the reason the candidate will be shown.",
      "Screen with AI runs the whole engine — score, strengths, gaps, feedback — and Re-screen runs it again. Draft feedback writes the letter and Email this to the candidate sends it.",
      "Award marks by hand on any answer the AI left for review, in the grading desk.",
      "Record a candidate files a walk-in who never applied; nothing is sent to them.",
      "Open the profile to edit contact details, read a stored CV into the record, revoke / extend / re-issue a test link, move stages, or archive and restore.",
      "Bulk message emails everyone the current filters select. Download this list exports the same set.",
    ],
    edges: [
      "The list is the newest 200 records; the rails count up to the newest 2,000 and the page says when even that stops being exact.",
      "Archiving is refused while an assessment link is open or an interview is on the calendar. Nothing is deleted — a filed-away candidate keeps their own tracking page.",
      "One live application per person per role is what refuses a duplicate. One person may hold several live applications on different roles, and the profile page says so rather than splitting them into two candidates.",
      "A profile page is addressed by the person's oldest live record: a link naming a newer application is moved onto that address.",
      "Hand-marking needs Grade assessments, edits need Edit candidates, sending needs Send messages.",
      "A bulk send stops at 200 recipients, and the panel names the mail provider's own daily ceiling.",
    ],
  },

  "/sourcing": {
    purpose: "The outbound pool: people you found, what you sent them, and whether they became an application.",
    shows: [
      "Rails for All, Not contacted, Contacted, Replied, Interview, Applied and Passed, counted in the database, the pool table, and a profile drawer holding the stored profile and everything sent to that person.",
    ],
    use: [
      "Add one by hand, or Import a paste of LinkedIn profile links or a CSV/TSV export, onto an opening.",
      "Reach by email or WhatsApp from the row or the drawer; each send writes a delivery record and stamps the prospect.",
      "Read a profile from a link, a pasted page or an uploaded export, then Structure the pasted page into fields.",
      "Convert to an application files the person on the pipeline under a role you choose.",
      "Select rows and Message to send one text to the whole selection.",
      "Visitors who leave their details to the assistant on the public careers pages arrive here as new prospects, sourced by \"Careers assistant\", with the conversation in the notes — that is a lead, not an application, so the person is still yours to reach.",
    ],
    edges: [
      "One render carries 500 prospects. The rails still count the whole pool, and the page names what is counted above but not shown below.",
      "LinkedIn has no people-search API, so nothing arrives on its own — you collect the links or the export and the portal parses them.",
      "A repeated profile link is refused by the database. An email match is only skipped when it sits among the newest 5,000 records.",
      "Setting a stage of Applied or Passed by hand is a label: no application backs it until you convert.",
      "A paste is capped at 200,000 characters and a bulk message at 200 recipients.",
    ],
  },

  "/jobs": {
    purpose: "The openings, who applied to each, and what they submitted.",
    shows: [
      "A summary strip, status rails and a Still hiring rail, a company rail, and one card per opening carrying its live applicant count.",
    ],
    use: [
      "New opening, then Edit, Publish, Pause or Close. Close is how you stop a role that already has applicants.",
      "Open the applicants drawer to expand a row into their submission, open or download the CV, and move them through the stages without leaving the role.",
      "Full profile in Candidates hands the person over to the pipeline screen.",
      "Filter by status or company, search by title, department, location or company, and sort by newest, most applicants or title.",
    ],
    edges: [
      "Delete is refused once anyone has applied — the opening is closed instead so its records stay reachable.",
      "A closed opening cannot be filed onto: linking, importing, converting or recording someone under it is refused until it reopens.",
      "Departments and locations come from Settings → Organisation. A retired or misspelt value is refused on a new write, and the drift desk there names the openings already carrying one.",
      "A card's count is live; the drawer lists the newest 200 applicants.",
      "Writes need Manage jobs; a stage move inside the drawer needs Edit candidates.",
    ],
  },

  "/questions": {
    purpose:
      "The question bank — every question the portal stores, in one list or on a board of the places that ask it, with the writing that used to sit in two separate consoles.",
    shows: [
      "Two tabs over one set: the no-points questions a candidate answers on the apply form, and the marked ones inside an assessment suite. Nothing else is here — interview questions are never stored, and a CV screening prompt is not asked of a candidate.",
      "A toolbar: a search over the question, its guidance, its answers and the role or suite it belongs to; rails by the kind of answer and by whether anything asks it now; a Where picker listing only the places that actually hold a question; and a group-by control — by place, surface, kind, live state, or one list. Beside it, List and Board.",
      "Each row carries its surface, its kind, its marks when it has them, and whether anything asks it right now; then the wording, the guidance, and every answer with what that answer does — keeps them in the running or rules them out, right answer or wrong.",
      "The board is one tab's places: a column per open role, or per switched-on suite, with a shared-scoped column beside the roles. Its cards are the same questions, shown small.",
      "The count beside every tab, rail and place is the whole bank, not what the current view left standing, so a chip never promises rows the list below cannot show.",
    ],
    use: [
      "Ask a question on a form writes a real apply-form row: the question, its guidance, whether it is asked of every open role or one, and two to twelve answers each marked Accepts or Rules out — at least one answer has to keep an application in the running.",
      "Edit, Stop asking and Delete act on the row a question is. A test question's Edit opens that suite's own editor, because its answer set, its marks, its brief or its spreadsheet grid are columns only that editor writes.",
      "Move up / down sets the order applicants see the form questions. The arrows are held while the list is filtered or grouped another way, because a move swaps a question with the one the form asks next in its own scope, which that view may be hiding.",
      "On the apply-form tab, dropping a card into another column moves it — the same row, now asked by that role. Use it here does the same for one row from the list, and offers only destinations that will accept the question.",
      "On the suite tab, a drop copies. A test question cannot change which paper it belongs to, because every link already issued re-reads its suite live, so the board writes a new row in the destination suite and leaves the original where it was.",
      "Use it here also crosses between the two stores where the answer set allows it: a form question turns into a quiz question only when exactly one of its answers is accepted, because that is the answer the quiz marks correct — and it arrives worth 10 marks. A quiz question turns into a form question when it has one right option, which becomes the answer that keeps an application in the running.",
      "Where a destination is missing, the row or the column says why: the account cannot write there, the place is no longer on file, the kind has no answer to gate with, or nothing else is open to receive it.",
      "Group by the live state, or light the Nothing asks it now rail, to find the wording worth keeping but asked by nobody: a switched-off form question, a role no longer published, a paused suite.",
    ],
    edges: [
      "This page owns no table. Every control writes a row in one of the two stores that hold questions, through the action that owns that store, so the validation, the permission and the change trail are the same whichever door was used — and there is no third copy to keep in step by hand.",
      "Changing one question changes every role or suite that asks it, because it is the same row. To ask the same words somewhere else without sharing them, copy: the copy is a new row that can be reworded, switched off and deleted on its own.",
      "For the apply-form questions: an unanswered or unoffered answer stops the submission, and one failing answer files the application as Rejected with a reason only recruiters read. The applicant sees a plain not-accepted message and never reaches AI screening, and is never told which answer passed or failed.",
      "Deleting a form question leaves the answers already submitted on applications — those are stored as text on the application, not as a link to the question.",
      "Only four ids travel to the server for a copy or a move; every word of what is written is re-read from the database there, so a board left open since a colleague edited the question cannot write stale text.",
      "Reading needs a staff session and nothing more — both question tables are readable by every staff role. Writing follows the permission that owns the store: Manage jobs for an apply form, Create assessments for a suite.",
      "A question placed onto a role that is not published, or copied into a suite that is paused, is refused: nobody would be asked it. A destination that already asks the question is refused too.",
      "A row the readers cannot make a question out of — fewer than two answers a candidate could pick, or a suite that has since been deleted — is left off the list rather than shown broken.",
      "The whole bank is read in one pass, with no page limit; it is authored text, so it stays small while a candidate list would not.",
      "The board's own reordering is not offered: a form question's place on its form is set from the list's arrows, and a suite's order belongs to its editor. The board changes where a question is asked, never where it sits in the paper.",
      "The Live badge on this page refreshes on the apply-form half only: the channel watches application_gate_questions, and assessment_questions carries no created or updated stamp to watch, so a suite's questions arrive on reload.",
    ],
  },

  "/assessments": {
    purpose: "The test library: suites, their questions, the links candidates sit, and the answers those links brought back.",
    shows: [
      "Tiles for suites, questions, assigned links and average duration, a searchable grid of suite cards, and three drawers — the suite, its questions, and the desk that drafts a whole suite from an opening.",
      "The drafting desk shows one reviewed suite shell beside its drafted questions, with the notes the review raised and the drafts it threw out.",
      "Below the suites, an Issued links board: one row per link a still-held candidate holds, with the suite, status, how many answers it carries, and the score when your role may see marks.",
      "A link's Answers or Paper button opens that candidate's whole paper — every question in the order they were dealt it, with the full typed answer, the changed spreadsheet cells, the pitch video and its transcript.",
    ],
    use: [
      "New template names the suite, its role family, duration and company; Add question builds it.",
      "Four question types: Multiple choice with one correct option, Case study, Spreadsheet model and Video pitch, each with its own fields.",
      "Set the integrity options — shuffled question order, shuffled options, copy and paste blocked.",
      "Assign sends a per-candidate link. Pause stops new assignments while issued tests stay open; Resume reopens it.",
      "Search by the columns the box names, and filter by role family or status.",
      "On the links board, the rails split it into Not started, Sitting now, Answered, Graded and Closed; the box searches candidate, suite and role.",
      "A link still being sat shows what the candidate has saved so far. Re-read pulls the answers in again — a candidate working the test does not push this page by itself.",
      "Draft with AI, at the foot of a suite's question list, writes drafts from a topic, the kinds you tick, a count, a level and a mark per question.",
      "Read each draft — the answer key, the required cells, the scenario — then add the ones you want to the suite.",
      "Draft a suite, beside New template, builds a whole test from a job opening: pick the opening or name the subject, tick the kinds, set a count, a level and marks per question.",
      "That desk shows the suite shell — name, description, role family, duration, copy-and-paste — next to its drafted questions, with a keep box on each. Create suite with N question(s) is the click that writes.",
    ],
    edges: [
      "A suite someone already holds a link for cannot be deleted — pause it instead.",
      "A question a candidate has answered cannot be deleted either; set its points to 0 or retire the suite.",
      "Nothing the model drafts enters the suite until you add it, and a draft the review rules refuse stays on the desk with the reason why.",
      "One run drafts at most 8 questions, needs an AI provider key in Settings, and is told the suite's existing titles so it does not write a second copy of one.",
      "A drafted suite goes through the same writer as a hand-built one, so nothing about it is a softer record: a question the review rules refuse is named on the desk and left out of the create.",
      "The model's role family is used only when it copies one of your master families exactly; otherwise the desk says so and files the suite under the family you picked, or the first one in Settings.",
      "A drafted suite is created with no question or option shuffling on, whatever the model proposed.",
      "The opening dropdown holds the newest 200 roles you can still hire for, and says so when older ones fall outside it. A closed opening is refused as a seed until it reopens.",
      "An opening is not required — name a subject in the box instead and the desk writes from your words alone. With an opening chosen, that same box becomes extra guidance on what the paper must cover.",
      "A drafted quiz arrives unshuffled: turn option shuffling on only after you have read the key, because a shuffled \"all of the above\" makes the question unanswerable.",
      "Link expiry, autosave and focus tracking are enforced in the candidate's runner from Settings, not from this page — the duration field here is the test's own time limit.",
      "Revoke, extend, re-issue and delete a link live on the candidate's record.",
      "Marks are read here, never set: the desk that awards them is the candidate's assessment report.",
      "The board lists the newest 300 links and says how many more are on file. Assigned links on the tiles counts every link ever issued, including a filed-away candidate's, so the two figures can differ.",
      "Authoring needs Create assessments; sending links needs Assign assessments.",
    ],
  },

  "/interviews": {
    purpose: "The panel calendar: who is being seen, when, by whom, and what came of it.",
    shows: [
      "Cards grouped by day with the time, status, candidate, role, duration and interviewer, and a line saying how many are still awaiting an outcome in the range on screen.",
    ],
    use: [
      "Cut the view by Today / Next 7 days / Next 30 days / Next 90 days / Last 30 days, and by status: All, Awaiting outcome, Completed, No-show, Cancelled.",
      "Move reschedules — date and time typed in the organisation's timezone, duration, interviewer, meeting link — and tells the candidate the slot changed.",
      "Record Completed, No-show or Cancelled. Only a move messages the candidate; an outcome never does.",
      "Join opens the meeting link and the candidate's name opens their record.",
    ],
    edges: [
      "The agenda reads 30 days back and 90 days forward. Panels booked past either edge are counted and named, not listed.",
      "A slot that has passed cannot be moved — record what happened, or book a new panel from the candidate.",
      "Panels are scheduled from a candidate's profile, and the interview guide is drafted there, not here.",
      "Reading needs only a staff session; moving or recording needs Edit candidates.",
    ],
  },

  "/onboarding": {
    purpose: "The new-hire checklists, and the skill gaps each plan found.",
    shows: [
      "Active plans with a progress meter and their open gaps, the hires still waiting for a plan, and the tiles above both.",
    ],
    use: [
      "Generate plan builds the nine base tasks for a hire, plus the extras matched to the role's title.",
      "Tick or reopen a task, Edit its title, category, owner and due offset, Add task, or Delete task. Progress recomputes on every write.",
      "Due dates are offsets from the hire's start date, so a task reads Due in 7 d and turns overdue on its own.",
    ],
    edges: [
      "A hire can have exactly one plan, and there is no way to delete or restart one from the console.",
      "Generating needs the Manage platform settings permission while ticking, editing and adding need Edit candidates — so a Recruiter can see a button that will refuse them.",
      "Skill gaps are written once, at generation, and never re-derived.",
      "The unplanned list is the ten most recent hires.",
    ],
  },

  "/files": {
    purpose: "What the portal has stored, which record owns each file, and what it weighs.",
    shows: [
      "Tiles for buckets, folders, files and bytes, a bucket rail, one folder at a time with its sub-folders, and a card naming what writes into each bucket.",
    ],
    use: [
      "Switch bucket — candidate CVs, pitch videos, resumes, candidate audio — walk into folders, or move back with the breadcrumb.",
      "Search by file name, storage path or the linked record, and filter to All files or to Not linked to a record to find orphans.",
      "Open previews a file through a short-lived signed link; Download takes the file down.",
      "Delete removes the object and clears the record that pointed at it, then writes an audit row.",
    ],
    edges: [
      "Nothing is uploaded from here. A CV arrives on the apply form, a pitch in the runner, a staff file from the candidate's own record.",
      "Browsing needs View candidates; deleting needs the stricter Manage platform settings.",
      "A folder lists its first 200 items and says when there are more. Bucket totals walk a limited number of listings a few folders deep, so a large bucket reports at least.",
      "A missing link is only trustworthy when the referencing records were read — the page says when they were not.",
    ],
  },

  "/whatsapp": {
    purpose: "Everything the portal sends a candidate — the queue, the WhatsApp record, the email relay and the portal notices.",
    shows: [
      "Tiles for due, scheduled, delivered and parked, the Outbound queue and Delivery log tabs, and the email and portal-notice panels with their own rails.",
    ],
    use: [
      "New message composes a WhatsApp for one candidate. Leave Send at empty to hand it to the very next scheduler pass.",
      "Edit the copy or the time, Retry or Bump to now a parked job, or Cancel one that has not gone.",
      "Filter the queue by All / Due now / Scheduled / Delivered / Parked, sort it, and search it.",
      "Show every send or Undelivered only on the log. Retry re-sends a failed email exactly as the candidate would receive it.",
    ],
    edges: [
      "A delivered message is history: it cannot be edited, and retrying it would message the candidate twice.",
      "Only emails are relayed from here — a portal notice is already in the candidate's inbox.",
      "The queue holds the newest 200 jobs and the log the newest 60 rows of each channel, while the bucket chips count all time.",
      "A hand-written message has no placeholders substituted; rendered copy comes from the templates in Settings.",
      "Sends need the Send messages permission; without it the panels show what happened and refuse to change it. Nothing leaves at all until a WhatsApp token and an SMTP relay are configured under Settings → API keys.",
    ],
  },

  "/assistant": {
    purpose: "A chat that reads and changes the portal with exactly your account's permissions.",
    shows: [
      "Your saved conversations on the left, the chat on the right, and a What can the assistant do? button listing its tools.",
    ],
    use: [
      "Ask in words: it reads candidates, openings, tests, the outbox, settings and the change trails, and answers with a table or a chart drawn by the portal from the figures it read.",
      "Instruct a change and nothing happens until you press Approve & run on the card. A delete also needs the Allow deletions switch. Ignoring the card leaves the record exactly as it is.",
      "Allow web search lets the Qoder engine look up what is outside the portal — a market salary band, a pay survey, a competitor's ad — on the Qoder account the stored token pays for. Every lookup shows as a chip, the figure arrives as advice with its source named, and nothing it reads is written into a record. The switch is inert while a model is chosen or the engine is Gateway, because neither can reach the network.",
      "Attach a PDF, Word or text file for it to read, pick the engine and model, and Rename, Delete or Reload a conversation.",
      "Edit and send again re-runs a turn you were not happy with.",
    ],
    edges: [
      "Every read is capped, and the answer carries its own note saying what it left out; a long result is clipped.",
      "Never type a secret into this chat. The credential tool edits only non-secret fields, because your words are sent to the inference provider.",
      "Approvals live in the server's memory, so on a host that starts a fresh isolate per request the card answers that it is gone — and nothing changed.",
      "The Time Tracker and the activity trail have no tools while their tables stay unapplied.",
      "Attachments are read, not stored: the first 12,000 characters reach the model.",
    ],
  },

  "/settings": {
    purpose: "Every switch the portal obeys, who may do what, and the record of both.",
    shows: [
      "Four areas in the dock: Platform (organisation, AI, assessment, notifications, security, and the settings change trail), Organisation (companies, departments, locations, role families, skills, currencies, and the filing drift desk), Access & comms (permissions, team, notification templates) and Providers (API keys with their audit trail, and AI models with routing, catalogue and provider health).",
    ],
    use: [
      "Pick a section, change the controls, Save changes. Each write is recorded with who made it.",
      "Search the settings by name, key or description; the box names what it matches.",
      "In Organisation add and edit the vocabularies every opening is filed under, and Refile the openings sitting outside them.",
      "In Access & comms grant and revoke per role, create a staff account or record an invite, show a generated password once, reset it, deactivate, or delete an account that is already disabled — and edit, reset to shipped copy or delete a notification template per channel.",
      "In Providers store a key, Test it, set the primary and fallback model for each task, and run the health checks.",
      "Both trails page and search: by key, value, action or person.",
    ],
    edges: [
      "Writes and both trails need the Manage platform settings permission; staff accounts need Manage users.",
      "A stored key always wins over the environment variable of the same name, and removing one falls back to the environment. A saved key is never displayed back to you.",
      "A second master-data row carrying the same words is refused, because a job opening stores only the name.",
      "You cannot disable your own account, and the last active Super Admin cannot be locked out.",
      "A probe costs money: arriving on the provider tab runs nothing — only Test and the health checks send a request.",
    ],
  },
};

/** The three headings the panel prints above each list, in order. */
export const GUIDE_HEADINGS = {
  shows: "What it shows",
  use: "How to use it",
  edges: "What it refuses, and its limits",
} as const;

/** The lists of a manual, in the order the panel prints them. */
export const GUIDE_SECTIONS = ["shows", "use", "edges"] as const;

export type GuideSection = (typeof GUIDE_SECTIONS)[number];

/** The heading a section prints, with the short name the panel folds it under. */
export const GUIDE_SECTION_LABELS: Record<GuideSection, { heading: string; short: string }> = {
  shows: { heading: GUIDE_HEADINGS.shows, short: "what it shows" },
  use: { heading: GUIDE_HEADINGS.use, short: "how to use it" },
  edges: { heading: GUIDE_HEADINGS.edges, short: "its limits" },
};

export interface GuideHit {
  route: StaffRoute;
  /** The lists carrying at least one typed word — not every list of the page. */
  sections: GuideSection[];
  /** How many of its sentences carry one, which is what orders the results. */
  sentences: number;
}

/**
 * Which of a page's three lists start open.
 *
 * The panel keeps one exception to this — a list someone folded or opened by hand
 * stays as they left it — and everything else comes from here: nothing typed means
 * the manual is read straight through, and a search opens the lists that carry the
 * words. A hit whose words sit only in the one-line purpose has no list to name, so
 * all three stay open rather than the pane showing three folded headings with
 * nothing inside.
 */
export function openLists(needle: string, hit: GuideHit | null): readonly GuideSection[] {
  if (!needle) return GUIDE_SECTIONS;
  if (!hit || hit.sections.length === 0) return GUIDE_SECTIONS;
  return hit.sections;
}

/**
 * Which screens the manual can answer for, given what was typed.
 *
 * A screen is a hit only when every word appears somewhere in its own text — the
 * one-line purpose or any bullet — so "re-issue link" narrows the list instead of
 * drowning it. The sections are reported separately because the panel opens the
 * lists that matched and leaves the rest folded: naming a list that says nothing
 * about the words would send a recruiter reading the wrong heading.
 *
 * Case and spacing are ignored; nothing is stemmed, and the box says so rather
 * than promising fuzzy matching it does not do.
 */
export function searchGuide(query: string): GuideHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: GuideHit[] = [];
  for (const route of STAFF_ROUTES) {
    const guide = PAGE_GUIDE[route];
    const sections: GuideSection[] = [];
    let sentences = 0;

    const purpose = guide.purpose.toLowerCase();
    if (terms.some((term) => purpose.includes(term))) sentences += 1;

    for (const section of GUIDE_SECTIONS) {
      let carried = false;
      for (const line of guide[section]) {
        const text = line.toLowerCase();
        if (!terms.some((term) => text.includes(term))) continue;
        carried = true;
        sentences += 1;
      }
      if (carried) sections.push(section);
    }

    const whole = [guide.purpose, ...guide.shows, ...guide.use, ...guide.edges]
      .join("\n")
      .toLowerCase();
    if (terms.every((term) => whole.includes(term))) {
      hits.push({ route, sections, sentences });
    }
  }

  return hits.sort((a, b) => b.sentences - a.sentences);
}

/**
 * Which of the sixteen staff pages a pathname is on, longest prefix first.
 *
 * The app bar renders over every page, including a sub-route a page may grow
 * later, so a prefix match is what keeps the guide pointing at something.
 */
export function routeOf(pathname: string): StaffRoute | null {
  let best: StaffRoute | null = null;
  for (const route of STAFF_ROUTES) {
    if ((pathname === route || pathname.startsWith(`${route}/`)) && (!best || route.length > best.length)) {
      best = route;
    }
  }
  return best;
}
