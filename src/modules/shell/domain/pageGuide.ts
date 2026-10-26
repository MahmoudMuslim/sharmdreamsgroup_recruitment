import { STAFF_ROUTES, type StaffRoute } from "@/lib/auth/staffRoutes";
import {
  ATTACHMENT_INPUT_ACCEPT,
  MAX_HISTORY_ATTACHMENT_CHARS,
  MAX_MATERIAL_CHARS,
  MAX_UPLOAD_MB,
} from "@/modules/assistant/domain/attachments";
import {
  GENERATED_FORMAT_LABEL,
  MAX_FILE_BYTES,
  formatBytes,
} from "@/modules/assistant/domain/generatedFiles";

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
      "Fit bands, average score and the scored list are withheld without the View scores permission, and while the score-masking setting is on they are withheld from anyone who also lacks View unmasked scores.",
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
      "The ledger is on this database: db/migrations/025_time_entries.sql is applied, so the page reads and writes real rows. On a database that has not applied it, every write is refused and the page says the ledger has not been created yet.",
      "Everything here, including the read, needs the Track time permission.",
      "Only the person who logged a span can change it, and one timer runs at a time per person.",
      "The read is the newest 1,000 entries in the cut you picked.",
      "The chat reads the same ledger through get_time_ledger, with the same window and scope; its answer states the cut's count, the rows the capped read loaded and the rows it lists as three separate numbers, and links back to that cut.",
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
      "The trail is on this database: db/migrations/024_activity_log.sql is applied, so the console lists real rows. On a database that has not applied it, the page says the trail has not been created yet and reads nothing.",
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
      "The Integrity report on a test holds the signals the runner left, the paper's marks and, once graded, where that paper sits among the graded papers of the same suite. The line names how many papers the rank was taken from, and prints that count instead of a rank when too few are graded to rank against.",
    ],
    use: [
      "Click a rail to query the database for that stage rather than filter what is loaded. Search by name, email, role, company or tracking code; sort by newest, AI fit or name.",
      "Click a name for the person's profile page; the Desk button opens this application's drawer, where the buttons that write live.",
      "Advance moves someone to the next stage. Reject asks for the reason the candidate will be shown.",
      "Screen with AI runs the whole engine — score, strengths, gaps, feedback — and files the skills it recognised in the CV against that application, which is what the applicants drawer on /jobs reads as a shown level. Re-screen runs it again. Draft feedback writes the letter and Email this to the candidate sends it.",
      "Award marks by hand on any answer the AI left for review, in the grading desk.",
      "Record a candidate files a walk-in who never applied; nothing is sent to them.",
      "Open the profile to edit contact details, read a stored CV into the record, revoke / extend / re-issue a test link, move stages, or archive and restore.",
      "Bulk message and Bulk move both act on the rows you tick, never on the whole filtered set; both stay disabled until a row is ticked. Download this list exports the set the filters do match, which is a different group.",
      "Bulk move sends a ticked group to one stage through the same writer a single row uses, with one reason shared across the batch when that stage is rejected.",
      "At the Offer stage the drawer carries the Offer panel. Send the offer mails the letter with a signed link and moves the application to Offer, so someone already at that stage receives the letter a second time with the link in it. The candidate opens the link to accept or decline. An offer defaults to 7 days and takes 1–60. Withdraw closes an offer the candidate has not answered, including one past its deadline; a new letter can be sent only once that is closed. A declined offer can be followed by a new one with new terms and its own deadline. Confirm the hire is refused until the candidate has accepted.",
    ],
    edges: [
      "The list is the newest 200 records; the rails count up to the newest 2,000 and the page says when even that stops being exact.",
      "The offer desk arrives with db/migrations/042_offers.sql, which is authored but not applied on this database: until it is, the panel says the offers table has not been created yet and sends nothing.",
      "Archiving is refused while an assessment link is open or an interview is on the calendar. Nothing is deleted — a filed-away candidate keeps their own tracking page.",
      "One live application per person per role is what refuses a duplicate. One person may hold several live applications on different roles, and the profile page says so rather than splitting them into two candidates.",
      "A profile page is addressed by the person's oldest live record: a link naming a newer application is moved onto that address.",
      "Hand-marking needs Grade assessments, edits need Edit candidates, sending needs Send messages, and booking a panel needs Schedule interviews on top of Edit candidates.",
      "A bulk send stops at 200 recipients, and the panel names the mail provider's own daily ceiling.",
      "A bulk move stops at 50 rows, writes them one at a time, and sends no stage notice unless you tick the opt-in — a ticked group of forty is forty real emails and chats. Rows the write refused are listed by name with the reason; the rest stay moved.",
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
      "Remove on a row takes that prospect out of the pool.",
      "Visitors who leave their details to the assistant on the public careers pages arrive here as new prospects, sourced by \"Careers assistant\", with the conversation in the notes — that is a lead, not an application, so the person is still yours to reach.",
    ],
    edges: [
      "One render carries 500 prospects. The rails still count the whole pool, and the page names what is counted above but not shown below.",
      "LinkedIn has no people-search API, so nothing arrives on its own — you collect the links or the export and the portal parses them.",
      "A repeated profile link is refused by the database. An email match is only skipped when it sits among the newest 5,000 records.",
      "Setting a stage of Applied or Passed by hand is a label: no application backs it until you convert.",
      "A paste is capped at 200,000 characters and a bulk message at 200 recipients.",
      "Removing a prospect needs the Delete candidates permission, and the row's outreach history goes with it.",
    ],
  },

  "/jobs": {
    purpose: "The openings, who applied to each, and what they submitted.",
    shows: [
      "A summary strip, status rails and a Still hiring rail, a company rail, and one card per opening carrying its live applicant count and its hiring-demand line — the headcount target, who sits in the pipeline now and who is hired.",
      "Newer and Older under the cards — 25 openings to a page, and the page is in the address bar, so a copied link shows the same cards.",
    ],
    use: [
      "New opening, then Edit, Publish, Pause or Close. Close is how you stop a role that already has applicants.",
      "New opening can start from a position: the picker fills the title, company, department, description, requirements and salary band from the position's definition, and every field stays editable before you save.",
      "Every opening states a job type; the drawer also offers a seniority level from Junior to Lead where the database holds the column, and both are printed on the card.",
      "Required skills are ticked in the opening form's picker: choose the skills the catalogue holds and the level each has to be shown at on a 1–5 scale, or press Add the skills these lines name to take the list from the opening's own requirement lines — rows added that way carry the line they came from.",
      "Open the applicants drawer to expand a row into their submission, open or download the CV, and move them through the stages without leaving the role.",
      "Full profile in Candidates hands the person over to the pipeline screen.",
      "Filter by status or company, search by title, department, location or company, and sort by newest, most applicants or title.",
    ],
    edges: [
      "Delete is refused once anyone has applied — the opening is closed instead so its records stay reachable.",
      "A closed opening cannot be filed onto: linking, importing, converting or recording someone under it is refused until it reopens.",
      "Departments and locations come from Settings → Organisation. A retired or misspelt value is refused on a new write, and the drift desk there names the openings already carrying one.",
      "Starting from a position needs that list: db/migrations/026_positions.sql is applied on this database, so the drawer offers the positions it holds, and an opening's company has to match the position's company unless the position is group-wide. On a database where that file has not been run, the drawer says the positions have not been created yet and offers a blank opening instead.",
      "Seniority levels and the Remote and Hybrid job types arrive with db/migrations/033_opening_terms.sql, which is authored but not applied on this database: until it is, the drawer offers the four job types the database already accepts, hides the level picker, and the grid says so above the cards. A level is never inferred — an opening nobody has levelled reads not recorded, never a middle tier.",
      "Requisition skills arrive with db/migrations/037_opening_skills.sql, which is applied on this database, so the job form's picker writes the list, the applicants drawer scores every applicant against it, and the assistant can replace it. On a database where that file has not been run, the form prints that file's name where the picker would be, the drawer lists no skills against anyone, and the assistant refuses to write a list and names the same file — the opening's other fields stay editable through all of it.",
      "A requisition lists at most 12 skills: at the ceiling the picker stops offering boxes and says so, and a skill the catalogue has retired keeps its own row with a Remove button, because what the database holds has to be visible to be changed.",
      "Against the requisition's skills in the applicants drawer prints every required skill with the level the opening asks and the level that record shows — required 4, shown 2 — or no evidence when nothing was recorded for it. No evidence is a fact about the paperwork, never a missing skill, and a list the opening left empty prints nothing at all rather than a score of nil. Where scores are masked for a reviewer, the drawer names what the opening asks and withholds what each person showed.",
      "The demand line's target is db/migrations/031_job_headcount.sql's positions_needed column, which is authored but not applied on this database: until it is, every card reads no target set and the grid says above the cards that the target could not be read. The pipeline and hired counts need no migration, and a target nobody recorded reads no target set — never a role that wants zero people.",
      "A card's count is live; the drawer lists the newest 200 applicants.",
      "The grid holds the newest 200 openings in the browser — its rails, its search box and its page count those, while the strip's figure is the whole scope. When the two differ, a line under the strip names what is not here.",
      "A rail, new search words or the assistant's link to one opening moves you to the page that holds it; anything else starts you back at the front.",
      "Writes need Manage jobs; a stage move inside the drawer needs Edit candidates.",
      "An expanded applicant's test-evidence line sits beside the CV's required and shown levels and changes neither: a skill with test marks but no CV row is still no-evidence about the CV. The read covers at most the 500 most recent graded responses and says so when it stopped at that bound.",
    ],
  },

  "/forms": {
    purpose:
      "The application forms themselves: what an applicant is asked, in what order, and which openings ask it.",
    shows: [
      "A list of every form with its name, whether it is a draft or published, whether it is global or the roles it is assigned to, its version, how many fields it holds and when it last changed.",
      "The selected form in a three-pane editor: a palette of the twenty-one field types, the layout as ordered cards with section headings dividing the steps, and an inspector for the selected field.",
      "Each card prints its type, its key, whether it is required, and the candidate fact it writes when it is bound. The inspector's binding list shows the seven fields an application has always collected, then the profile registry keys with their sensitivity tier.",
      "Every save names the version the editor was opened at, so a colleague's save in another tab makes this one refuse instead of quietly overwriting it.",
    ],
    use: [
      "New form names it, writes its description and says whether every open role asks it or only the roles you assign it to. It starts as a draft.",
      "Click a field type to add it at the end; drag a card, or use its up and down buttons, to move it. Select a card to edit its label, help text, placeholder, required box and type-specific settings, and to bind it to a candidate field.",
      "A multi_select can write a profile list; the picker labels that binding \"saves each choice as its own row\" and offers it only on that type. A Tier-3 profile key shows the consent notice it carries, and cannot be marked required.",
      "Save layout writes the whole ordered set in one save at the version on screen. Publish runs the identity contract over the composed layout — every global form plus this one, and every opening this form is assigned to — and lists every violation with the field named.",
      "Assign adds the form to an opening, keeping its place in that opening's order; Unassign takes it off. Retire files the form away: its answers on existing applications stay readable.",
    ],
    edges: [
      "The form tables arrive with db/migrations/044_application_forms.sql, which is authored but not applied on this database: until it is, this page says the tables have not been created yet and refuses every write, rather than pretending the list is empty.",
      "Saving needs the Manage jobs permission; reading the list needs only a staff session.",
      "A draft may be incomplete. Publish is what refuses a layout with no name field, no email field, neither a CV nor an About field, a key or candidate fact held by two forms, a binding the profile cannot store, or two fields sharing a key.",
      "A form is never deleted here. Retire sets its archived date, and applications keep the questions they answered because each submission stores a snapshot of the labels as asked.",
      "A global form is asked on every open role and is not assignable to one; an assigned form is asked only where it is assigned.",
      "There are no conditional questions, branches, scoring or gating inside a form, and no per-field translations. Gate questions that reject an application live at /questions, and the consent step on the public form is fixed.",
      "A published layout can be edited, and an edit reaches a candidate who is mid-form on their next load; nothing snapshots the form until the application is submitted.",
    ],
  },

  "/questions": {
    purpose:
      "The question bank — every question the portal stores, in one list or on a board of the places that ask it, with the writing that used to sit in two separate consoles.",
    shows: [
      "Two tabs over one set: the no-points questions a candidate answers on the apply form, and the marked ones inside an assessment suite. Nothing else is here — interview questions are never stored, and a CV screening prompt is not asked of a candidate.",
      "A toolbar: a search over the question, its guidance, its answers and the role or suite it belongs to; rails by the kind of answer and by whether anything asks it now; a Where picker listing only the places that actually hold a question; and a group-by control — by place, surface, kind, live state, or one list. Beside it, List and Board.",
      "Each row carries its surface, its kind, its marks when it has them, and whether anything asks it right now; then the wording, the guidance, and every answer with what that answer does — keeps them in the running or rules them out, right answer or wrong, or for a judgment scene the percentage it earns.",
      "The board is one tab's places: a column per open role, or per switched-on suite, with a shared-scoped column beside the roles. Its cards are the same questions, shown small.",
      "The count beside every tab, rail and place is the whole bank, not what the current view left standing, so a chip never promises rows the list below cannot show.",
    ],
    use: [
      "Ask a question on a form writes a real apply-form row: the question, its guidance, whether it is asked of every open role or one, and two to twelve answers each marked Accepts or Rules out — at least one answer has to keep an application in the running.",
      "Edit, Stop asking and Delete act on the row a question is. A test question's Edit opens that suite's own editor, because its answer set, its marks, its brief or its spreadsheet grid are columns only that editor writes.",
      "Move up / down sets the order applicants see the form questions. The arrows are held while the list is filtered or grouped another way, because a move swaps a question with the one the form asks next in its own scope, which that view may be hiding.",
      "On the apply-form tab, dropping a card into another column moves it — the same row, now asked by that role. Use it here does the same for one row from the list, and offers only destinations that will accept the question.",
      "On the suite tab, a drop copies. A test question cannot change which paper it belongs to, because every link already issued re-reads its suite live, so the board writes a new row in the destination suite and leaves the original where it was.",
      "Use it here also crosses between the two stores where the answer set allows it: a form question turns into a quiz question only when exactly one of its answers is accepted, because that is the answer the quiz marks correct — and it arrives worth 10 marks. A quiz question turns into a form question when it has one right option, which becomes the answer that keeps an application in the running. A judgment scene copies into another suite with its percentages, but never onto a form: its answers are a scale, not a pass/fail key.",
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
      "Tiles for suites, questions, assigned links and average duration, a searchable grid of suite cards, and four drawers — the suite, its questions, the statistics behind them, and the desk that drafts a whole suite from an opening.",
      "A suite's editor carries a Second test fieldset: the suite to issue when a fully marked paper lands inside a percent band, both ends inclusive. The card prints the rule, and warns when the second suite is paused, has no questions, or is not one this page can see.",
      "The drafting desk shows one reviewed suite shell beside its drafted questions, with the notes the review raised and the drafts it threw out.",
      "Below the suites, an Issued links board: one row per link a still-held candidate holds, with the suite, status, how many answers it carries, and the score when your role may see marks.",
      "A link's Answers or Paper button opens that candidate's whole paper — every question in the order they were dealt it, with the full typed answer, the changed spreadsheet cells, the pitch video and its transcript.",
      "A case study, video pitch or coding answer the author gave a marking scheme reads back criterion by criterion: the drawer's Criterion marks block lists each criterion by name with its marks out of the allowance it was worth, the percentage that earned, and the line quoted from the answer. Your own notes and the quotation stay readable while your role has marks withheld; only the figures go.",
      "A graded paper's drawer adds where it ranks among the graded papers of the same suite, naming that population, and gives the count rather than a rank when there are too few papers to rank against. The line is not shown at all while your role has marks withheld.",
      "A suite's Statistics drawer measures the test rather than a person: four tiles for the questions, graded papers and graded answers it read and how many questions the weakest papers out-earned the strongest on, then one row per question with its difficulty and its strongest-versus-weakest gap beside the counts they came from.",
      "With blind marking on in Settings, a paper whose marks can still change is listed by its tracking code with a Blind badge instead of a name, and the drawer says why. The name returns on its own once the paper is graded.",
    ],
    use: [
      "New template names the suite, its role family, duration and company; Add question builds it.",
      "Six question types: Multiple choice with one correct option, Situational judgment (a workplace scene whose responses each earn a 0–100 percentage, with no single right one), Case study, Spreadsheet model, Video pitch and Coding, each with its own fields.",
      "A coding question fixes one language for the answer — JavaScript, TypeScript, Python, Java, C#, Go, SQL, PHP, Ruby, C++ — and the candidate writes in a plain text box.",
      "A coding answer holds at most 20,000 characters, and the starter is optional and holds at most 10,000 characters.",
      "A coding answer is never compiled, run or tested: the code is stored as text, and a reviewer reads exactly what the candidate wrote.",
      "Case study, video pitch and coding carry a Marking scheme beside their own fields: name two to six criteria, write what a strong answer shows for each if you can, and give every one a weight — the weights are shares of that question's marks, so they must add up to 100. Empty the panel to retire a scheme.",
      "A criterion may carry a skill tag from the catalogue, or stay untagged. The tag is stored with the mark, so the answers drawer can total the marks each skill earned across the paper — summed, never averaged, and never turned into a 1–5 level.",
      "Situational judgment arrives with db/migrations/034_situational_judgment.sql, which is applied on this database, so the fifth type is offered in the picker and each option carries its own share of the question's marks. On a database where that file has not been run, the type picker hides the fifth type, a save that carries it is refused and names that file, and every other type works normally. Coding arrives with db/migrations/039_coding_questions.sql, which is applied on this database, so the sixth type is offered and a code answer has its own character cap and its own review surface. On a database where that file has not been run, the type picker hides the sixth type, a save that carries it is refused and names that file, and every other type works normally.",
      "Set the integrity options — shuffled question order, shuffled options, copy and paste blocked.",
      "To send a candidate on to a second test, open the suite's editor, choose the suite to issue, and give the band as two whole percentages. The link is issued once, the moment the paper becomes fully marked — by the grading engine, the re-grade sweep, or a recruiter's last hand mark — and its invite names the suite it came from.",
      "Assign sends a per-candidate link. Pause stops new assignments while issued tests stay open; Resume reopens it.",
      "Search by the columns the box names, and filter by role family or status.",
      "Statistics on a suite card opens that suite's item table, loaded when the drawer opens rather than with the grid. The same drawer opens from `?stats=` on the address bar — that is where the assistant's link to a suite's statistics lands.",
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
      "A scheme is stored inside the paper it graded, so criteria renamed, reweighted or retired after a candidate sat are never read back as the marks actually awarded. The totals are added here from the per-criterion bands, not from whatever sum the model returned; a paper whose question has no scheme is still graded by the model's own judgement of it, and its drawer says nothing about criteria.",
      "Skill evidence counts only tagged criteria: an untagged criterion is evidence of something, but not of a named skill. A tag added now does not reinterpret a mark already given — a new grading writes a new snapshot — and the percentage is a share of the marks its tagged criteria were worth, not a proficiency level.",
      "A half-written scheme is refused with the sum quoted — one criterion named, a weight left out, weights that total 90 — and nothing is stored. Emptying the panel is different: that is the author retiring the scheme, and it saves.",
      "On a video pitch the grader reads the transcript, so a criterion can mark only what the transcript carries. Delivery, presence and anything off-camera stay with the reviewer who watches the recording.",
      "The board lists the newest 300 links and says how many more are on file. Assigned links on the tiles counts every link ever issued, including a filed-away candidate's, so the two figures can differ.",
      "Blind marking is off until you turn it on in Settings → Security, it holds for every staff reader with no per-role override, and a closed link is never blinded — only a paper whose marks can still change.",
      "With blind marking on, the links search matches a blinded row by its tracking code and not by its name, because the name was never sent to the page. Nothing anonymises the answers themselves — a typed answer or a video pitch still says and shows who sat it — and the candidate's record, with the assessment report that awards the marks, still names them: blind marking hides a name from a reviewer reading a pile of papers, not a candidate from the recruiter who hired them.",
      "Statistics are about the test, not the person, and they stop at the counts. A question needs 5 graded answers before a difficulty figure is claimed for it, and the strongest-versus-weakest gap needs 2 answers on each side of the split — below that the row prints the count it found instead of a number, and never a blank. A negative gap flags the question, not the candidates who answered it well.",
      "The figures cover at most 1,000 graded papers and 5,000 graded answers of a suite, and the drawer says so when a ceiling stopped the read rather than describing part of a suite as the whole of it. The pull is not a newest-first window, so a cut-off suite names the counts it reached, never a date range.",
      "Both halves of the split or neither: a difficulty without its gap is printed, but a gap is never claimed off one half alone. And nothing is claimed at all while your role has marks withheld — an item's difficulty and its gap are both statements about other candidates' marks.",
      "Second-test rules arrive with db/migrations/035_assessment_follow_ups.sql, which is authored but not applied on this database: until it is, the fieldset names that file and every other suite setting still saves.",
      "A rule's guards: the second suite must belong to the same company and cannot be the suite itself, and a rule may not close a loop back to its source. A paused or empty second suite is skipped rather than issued, one candidate gets at most one link per source paper, and a candidate already holding a link for the second suite is not sent another.",
      "Authoring needs Create assessments; sending links needs Assign assessments.",
    ],
  },

  "/interviews": {
    purpose:
      "The panel calendar: who is being seen, when, by whom, which round it is, what came of it, and what the interviewers wrote down.",
    shows: [
      "Cards grouped by day with the time, status, candidate, role, round, duration and interviewer, and a line saying how many are still awaiting an outcome in the range on screen.",
      "Each panel that has happened carries its scorecards: who wrote one, their four marks, the panel average and the written feedback — or a line saying it has not been scored yet.",
      "Each panel also carries its staff notes, one per writer: who wrote it, when, and the words. Your own note is marked as yours; every staff reader sees the rest.",
    ],
    use: [
      "Cut the view by Today / Next 7 days / Next 30 days / Next 90 days / Last 30 days, and by status: All, Awaiting outcome, Completed, No-show, Cancelled.",
      "Move reschedules — date and time typed in the organisation's timezone, duration, interviewer, round, meeting link — and tells the candidate the slot changed.",
      "Add a scorecard rates the panel from 1 to 5 on Technical, Communication, Problem solving and Culture, with optional notes. Every interviewer's row is kept separately, and the button reopens only your own.",
      "Add notes writes what was said and what you would probe next. Edit and Clear touch only your own note; a colleague's stays as they wrote it.",
      "Insert my notes copies your own panel note into the scorecard feedback box for you to edit. Marks are never filled in from a note, and the button refuses to replace feedback you have already typed.",
      "Record Completed, No-show or Cancelled. Only a move messages the candidate; an outcome never does.",
      "Join opens the meeting link and the candidate's name opens their record.",
      "A generated interview guide on a candidate's profile can be filed into your notes on a scheduled or completed panel. It arrives below your own words under a model-drafted heading, and stays editable like the rest of the note.",
    ],
    edges: [
      "Rounds and scorecards arrive with db/migrations/032_interview_scorecards.sql, which is applied on this database, so every panel carries a round and each interviewer keeps their own scorecard on it. On a database where that file has not been run the page says so, the round pickers are hidden and no scorecard can be saved; the calendar itself keeps working.",
      "Panel notes arrive with db/migrations/038_interview_notes.sql, which is applied on this database, so an interviewer saves what they heard in their own words and everyone on staff reads it. On a database where that file has not been run the notes desk is absent and the assistant names the file rather than pretending the panel has no notes; the agenda and its scorecards keep working.",
      "Only a panel whose slot has passed, or one marked Completed, offers the scorecard desk. A cancelled panel and a no-show have nothing to score.",
      "Any staff member can write their own scorecard without Edit candidates — the judgement of the person who sat the panel is the record — while every staff reader can see all of them. The candidate never does.",
      "Notes follow the same rule and are readable on every panel, including cancelled and no-show ones, but the desk stops writing them there: a panel beside the point keeps its record and takes no new words.",
      "A note is capped at 4,000 characters. The refusal quotes the limit before anything is written, and one note per writer per panel is stored — reopening edits it rather than adding a second.",
      "The guide itself is drafted on the candidate's profile, not here. Filing it writes a normal note, so it is staff-readable and yours to edit.",
      "The agenda reads 30 days back and 90 days forward. Panels booked past either edge are counted and named, not listed.",
      "A slot that has passed cannot be moved — record what happened, or book a new panel from the candidate.",
      "Reading needs only a staff session; moving a panel or recording an outcome needs both Edit candidates and Schedule interviews, so revoking either box in the role matrix closes those two writes.",
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

  "/referrals": {
    purpose: "The employee referral book: who brought whom for which role, where each claim stands and what was decided.",
    shows: [
      "Seven tiles — claims, not applied yet, in the pipeline, hired, closed, bonus pending and bonus paid — then the leaderboard, then every claim with the person, the role, who is credited, their progress and the bonus decision.",
      "A claim's progress is the linked application's stage, read when the page loads. No stage is copied onto the claim, so a move made on the candidates page shows here on the next load without a second write.",
    ],
    use: [
      "Pick a role, then Copy link: the address is the role page with this person's own code on it. Open opens the same link in a new tab to check it.",
      "Credit someone by hand with their email, optional name, the role and an optional note of up to 600 characters. The claim is filed under your name, never a profile id the browser sends.",
      "Record the bonus decision — None, Pending, Paid or Declined — with a note of up to 400 characters. This is a decision record, not a payment: the portal stores the state, who decided it and when, and moves no money.",
      "A recruiter or the owner can move a claim to another member of staff. That is the only door out of first-claim-wins, and the trail keeps both names.",
    ],
    edges: [
      "Referrals arrive with db/migrations/040_referrals.sql, which is authored but not applied on this database, so no referral table exists yet and no code has been issued. The page says so, hides its board and refuses every write by naming the file; nothing else in the portal depends on it, and an application is never refused because its referral could not be credited.",
      "The board is scoped by the database, not by the screen: a hiring manager reads the claims they made, while a recruiter and the owner read every claim. The page opens for any staff member.",
      "First claim wins is a unique index on the lower-cased email and the role, so two staff members cannot both be credited for the same person on the same opening. A blocked second claim names who holds it rather than saying 'duplicate'.",
      "A referral belongs to a member of staff. The public apply door resolves a code before it credits anything, and a candidate's own code is refused, so nobody can credit themselves.",
      "The read is the newest 500 claims; the page says when it stopped, and the tiles then count the rows shown rather than the whole book.",
      "The counts are populations — who sits where now — never moves or conversion rates. A bonus state counts the claims it was recorded on.",
      "Reassigning moves only who is credited: the claim's email, role and linked application stay as they were. The hand-entry note is written once and has no editor here.",
      "The bonus decision is one recorded state per claim, so a later decision replaces the state and its note — the change trail keeps what it replaced.",
    ],
  },

  "/retention": {
    purpose: "The privacy desk: what people have asked us to show or erase, and which old records are inside a retention window.",
    shows: [
      "Five tiles for the request book — received, verified, approved, executed and declined — then three for the records being weighed: due, in their warning window, and held.",
      "Every request with its kind, the address it came from, who verified or decided it and when, and the one next step the request allows.",
      "The oldest records first with their last activity, the date their window ends, whether they have been warned, and the reason a record is held — hired, an open assessment, or an open interview.",
      "The settings in force beneath the tiles: whether the sweep runs, the ordinary window, the talent-pool window and how many days a warning runs ahead of erasure.",
    ],
    use: [
      "Verify a received request: the desk looks for an application under that address and links it to the request, so the owner knows whose record is being answered.",
      "Approve or decline a verified request. Only the owner can do this, because it decides what happens next.",
      "Execute an approved request. An access request mails a bounded copy of what is held; an erasure requests a second click, then removes the stored files and blanks the person's data while keeping the application row, its stage, its scores and its dates.",
      "Read the retention rows while the sweep runs on its own schedule — this screen never erases a record by hand.",
    ],
    edges: [
      "The book arrives with db/migrations/041_privacy.sql, which is authored but not applied on this database, so the request tiles and the retention rows say the table is missing rather than showing an empty desk. Nothing on the candidate side depends on it: consent is enforced in code, so an applicant is never refused because the migration is unapplied.",
      "A recruiter or the owner opens the desk; a hiring manager is refused. A recruiter may verify and read, but approving, declining and executing are the owner's, and the database's own UPDATE policy repeats those gates so a direct call cannot skip them.",
      "The sweep ships off. Even switched on, it warns a record first, waits at least the stated warning days, and only then erases it; a record already due on the first run is warned, not deleted.",
      "Hired records are never erased, and neither are records with an assessment or interview still open. A talent-pool grant holds its own window counted from the grant, and the longer of the two windows decides.",
      "The read is the 500 oldest applications and the newest 500 requests; the page says when a list stopped, and the counts are then of the rows shown.",
      "A write never names the requester in the change trail. The trail outlives an erasure, so it records the request id, the kind and the state — never the person.",
      "The figures here are populations: how many requests sit in each state and how many records are due, warned or held right now. Nothing is a rate.",
    ],
  },

  "/files": {
    purpose: "What the portal has stored, which record owns each file, and what it weighs.",
    shows: [
      "Tiles for buckets, folders, files and bytes, a bucket rail, one folder at a time with its sub-folders, and a card naming what writes into each bucket.",
    ],
    use: [
      "Switch bucket — candidate CVs, pitch videos, resumes, candidate audio, candidate photos — walk into folders, or move back with the breadcrumb.",
      "Search by file name, storage path or the linked record, and filter to All files or to Not linked to a record to find orphans.",
      "Open previews a file through a short-lived signed link; Download takes the file down.",
      "Delete removes the object and clears the record that pointed at it, then writes an audit row.",
    ],
    edges: [
      "Nothing is uploaded from here. A CV arrives on the apply form, a pitch in the runner, a staff file from the candidate's own record, and the photo bucket has no door yet, so it is empty.",
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
      "An offer email goes out with a PDF letter attached, written from the same offer copy the candidate reads in the message.",
    ],
    edges: [
      "A delivered message is history: it cannot be edited, and retrying it would message the candidate twice.",
      "The promise only travels with the file: a portal notice never claims an attachment it cannot carry, and when the letter cannot be written the email says the documents follow in a separate email.",
      "Only emails are relayed from here — a portal notice is already in the candidate's inbox.",
      "The queue holds the newest 200 jobs and the log the newest 60 rows of each channel, while the bucket chips count all time.",
      "A hand-written message has no placeholders substituted; rendered copy comes from the templates in Settings.",
      "Sends need the Send messages permission; without it the panels show what happened and refuse to change it. Nothing leaves at all until a WhatsApp token and an SMTP relay are configured under Settings → API keys.",
    ],
  },

  "/assistant": {
    purpose: "A chat that reads and changes the portal with exactly your account's permissions.",
    shows: [
      "Your saved conversations on the left, the chat on the right, and a What can the assistant do? button listing its tools. Above the message box, a Settings button holds the model choice and the two switches, and its own label names the model that replies.",
    ],
    use: [
      "Ask in words: it reads candidates, openings, tests, the outbox, settings, the change trails and the time ledger, and answers with a table or a chart drawn by the portal from the figures it read.",
      "Instruct a change and nothing happens until you press Approve & run on the card. A delete also needs the Allow deletions switch, behind the Settings button. Ignoring the card leaves the record exactly as it is.",
      "Allow web search opens two lookups that leave the portal — search_web and read_web_page — about any subject: a pay band, a law, a competitor's ad, a release note, a company. The search belongs to this portal rather than to one engine, so it works whichever engine or model answers the turn, and the choice is remembered in this browser. Every lookup shows as a chip naming the words searched and the pages read; what comes back is advice with its source named and nothing it reads is written into a record. Lookups run on the OpenRouter key in Settings → API keys, so without one each chip refuses with the reason.",
      `Attach a file and it is read: ${ATTACHMENT_INPUT_ACCEPT.split(",").join(", ")}, up to ${MAX_UPLOAD_MB} MB. Ask a follow-up and the same text is still in front of the assistant for that conversation, as far back as the 12 turns it reads.`,
      `Ask for a file — “put those rows in an Excel workbook” — and a card appears under the answer naming what is in it, with a Download button. It writes: ${GENERATED_FORMAT_LABEL}.`,
      "Choose the answering engine at the top of the panel and the model behind Settings, and Rename, Delete or Reload a conversation.",
      "Edit and send again re-runs a turn you were not happy with.",
    ],
    edges: [
      "Every read is capped, and the answer carries its own note saying what it left out; a long result is clipped.",
      "Never type a secret into this chat. The credential tool edits only non-secret fields, because your words are sent to the inference provider.",
      "Approvals live in the server's memory, so on a host that starts a fresh isolate per request the card answers that it is gone — and nothing changed.",
      "The chat reads the time ledger too: get_time_ledger takes this console's window (today, 7, 14 or 30 days) and scope (mine or team), and its answer states the cut's count, the rows the capped read loaded and the rows it lists as three separate numbers before linking back to that cut. The hiring-data activity trail has its own read — get_activity_trail reads the same cut the /activity console shows, and its answers link back to that cut.",
      `Attachments are read, not stored: ${MAX_MATERIAL_CHARS.toLocaleString("en-GB")} characters of the file attached to your question reach the model and ${MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString("en-GB")} of a file from an earlier turn, and the text the model is handed says how much of it was left out.`,
      "The 97-2003 Office files (.doc, .xls, .ppt) and pictures are refused, with the door that works named: Save As .docx, .xlsx or .pptx, or paste the words. A file that opens but holds no text, like a scanned page, is refused the same way.",
      `A built file is handed to your browser and nowhere else: it is not stored, so after a reload the card offers Build again and makes the file once more from the same rows. Its own size ceiling is ${formatBytes(MAX_FILE_BYTES)}.`,
      "A file is made of rows a read tool returned in that conversation or lines from a file you attached — never of figures the model worked out — and whatever a ceiling cut short is printed on the card.",
    ],
  },

  "/settings": {
    purpose: "Every switch the portal obeys, who may do what, and the record of both.",
    shows: [
      "Four areas in the dock: Platform (organisation, AI, assessment, notifications, security, and the settings change trail), Organisation (companies, departments, locations, role families, positions, skills, currencies, and the filing drift desk), Access & comms (permissions, team, notification templates, languages) and Providers (API keys with their audit trail, and AI models with routing, catalogue and provider health).",
    ],
    use: [
      "Pick a section, change the controls, Save changes. Each write is recorded with who made it.",
      "Search the settings by name, key or description; the box names what it matches.",
      "In Organisation add and edit the vocabularies every opening is filed under, and Refile the openings sitting outside them.",
      "In Access & comms grant and revoke per role, create a staff account or record an invite, show a generated password once, reset it, deactivate, or delete an account that is already disabled — and edit, reset to shipped copy or delete a notification template per channel.",
      "In Languages open a group, type an override for a key, or Draft its blanks with the model and Save — a stored wording replaces the words the build ships on every public page.",
      "In Providers store a key, Test it, set the primary and fallback model for each task, and run the health checks.",
      "Both trails page and search: by key, value, action or person.",
    ],
    edges: [
      "Writes and both trails need the Manage platform settings permission — Companies is the one master-data table whose own Manage companies grant opens it without that; role and permission grants need Manage roles (the same key the database checks); an existing staff account needs Manage users to edit, disable or delete, and opening a new one needs Create users on top of it.",
      "A stored key always wins over the environment variable of the same name, and removing one falls back to the environment. A saved key is never displayed back to you.",
      "A second master-data row carrying the same words is refused, because a job opening stores only the name.",
      "The Positions list arrives with db/migrations/026_positions.sql, which is applied on this database. On one where it has not been run, its section says the list has not been created — not that it is empty — and nothing can be saved there.",
      "A wording override that drops or invents a {placeholder}, or runs past 2000 characters, refuses the whole save rather than writing the half it likes.",
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
