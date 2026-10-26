import type { Locale } from "@/types";

export const locales: readonly Locale[] = ["en", "ar", "ru", "de"];

export const localeLabels: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
  ru: "Русский",
  de: "Deutsch",
};

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.assessments": "Assessments",
  "nav.candidates": "Candidates",
  "nav.jobs": "Jobs",
  "nav.onboarding": "Onboarding",
  "nav.portal": "Candidate Portal",
  "nav.signOut": "Sign out",
  "common.loading": "Loading…",
  "common.error": "Something went wrong",
  "common.retry": "Retry",
  "common.submit": "Submit",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.next": "Next",
  "common.previous": "Previous",
  "common.close": "Close",
  "jobs.apply": "Apply now",
  "jobs.openings": "Open Positions",
  "assessment.title": "Skills Assessment",
  "assessment.timer": "Time remaining",
  "assessment.draftSaved": "Draft saved",
  "assessment.video.record": "Start Recording",
  "assessment.video.stop": "Stop & Review",
  "assessment.video.rerecord": "Re-record",
  "assessment.submit": "Submit Assessment",
  "portal.title": "Track Your Application",
  "portal.code": "Tracking code",
  "portal.search": "Search",
  "portal.eyebrow": "Candidate portal",
  "portal.intro":
    "Enter the tracking code you were given when you applied to see your current stage, assessment and next steps.",
  "portal.codeHint": "Looks like",
  "portal.track": "Track",
  "portal.searching": "Searching…",
  "portal.lookupFailed": "Something went wrong. Please try again.",
  "portal.hello": "Hello, {name}",
  "portal.positionUnderReview": "Position under review",
  "portal.matchScore": "Match score",
  "portal.assessmentScore": "Assessment score",
  "portal.notSelected": "Not selected",
  "portal.actionNeeded": "Action needed",
  "portal.inProgress": "In progress",
  "portal.applied": "applied {when}",
  "portal.startAssessment": "Start assessment",
  "portal.resumeAssessment": "Resume assessment",
  "portal.progress": "Application progress: {stage}",
  "portal.messages": "Messages from the hiring team",
  "portal.newCount": "{count} new",
  "portal.markAllRead": "Mark all read",
  "portal.marking": "Marking…",
  "portal.noSubject": "An update on your application",
  "portal.badgeNew": "New",
  "portal.needHelp": "Need help?",
  "portal.helpText":
    "If your link has expired or you cannot find your tracking code, email the talent team and they will look it up for you.",
  "portal.language": "Language",
  "portal.next.rejected":
    "Thank you for applying. After careful review we were not able to move forward with your application for this role. We appreciate the time you took, and we wish you every success in your search.",
  "portal.next.hired": "Congratulations — our people team will be in touch about your offer.",
  "portal.next.interview":
    "Your interview is being scheduled. We will confirm the time and joining link with you.",
  "portal.next.submitted": "Your assessment was submitted and is now with the hiring team.",
  "portal.next.inProgress": "Assessment in progress — {time} remaining.",
  "portal.next.closedWindow": "Your assessment window has closed.",
  "portal.next.invited":
    "You have been invited to complete an assessment. Open your secure link below.",
  "portal.next.screening": "Your application is with our screening team.",
  "stage.new": "Application",
  "stage.ai_screening": "AI screening",
  "stage.assessment": "Assessment",
  "stage.interview": "Interview",
  "stage.offer": "Offer",
  "stage.hired": "Hired",
  "time.today": "today",
  "time.daysAgo": "{count} days ago",
  "time.monthsAgo": "{count} months ago",
  "login.title": "Sign in",
  "login.email": "Email",
  "login.password": "Password",
  "login.action": "Sign in",

  // ---- Public chrome: the header, footer and controls every candidate sees.
  "chrome.careers": "Careers",
  "chrome.track": "Track application",
  "chrome.trackCta": "Track an application",
  "chrome.explore": "Explore",
  "chrome.language": "Language",
  "chrome.languageAuto": "Automatic",
  "chrome.theme": "Theme",
  "chrome.careersFooter":
    "Applications are reviewed by our people team. Keep your tracking code — it is the only way to follow your application.",

  // ---- Landing page.
  "home.badge": "AI-driven recruitment platform",
  "home.titleA": "Talent intelligence,",
  "home.titleB": "without the bottlenecks",
  "home.lede":
    "Multi-tenant recruitment for the Sharm Dreams Group — bias-reduced CV screening, interactive assessment suites, interview scheduling with automatic candidate notices and real-time hiring analytics.",
  "home.cap1Eyebrow": "Open roles",
  "home.cap1Title": "Hiring across the group",
  "home.cap1Copy":
    "Every published opening — resort operations, real estate and corporate services — with the salary range stated and an application that takes a few minutes.",
  "home.cap2Eyebrow": "Assessments",
  "home.cap2Title": "Tests graded on what you actually did",
  "home.cap2Copy":
    "Invited candidates run their assessment in the browser: financial models with NPV and IRR, video pitches, case studies and quizzes, marked from what they submit.",
  "home.cap3Eyebrow": "Candidate experience",
  "home.cap3Title": "A portal candidates trust",
  "home.cap3Copy":
    "Track application status, assessment results and next steps from any device, at any time.",
  "home.serving": "Serving the group",
  "home.footerTag": "Enterprise HRMS, ATS & assessment platform",

  // ---- The job board and a single role.
  "careers.hiring": "We are hiring",
  "careers.timeline": "The timeline",
  "careers.undated": "Undated",
  "careers.benefits": "What the group offers its people",
  "careers.alsoGroup": "Also part of the group",
  "careers.alsoGroupNote":
    "These companies have no open roles right now — the board above is everything the group is hiring for today.",
  "careers.applied": "Already applied?",
  "careers.appliedNote":
    "Enter the tracking code you received when you applied to see your current stage, upcoming interviews and next steps.",
  "careers.trackMine": "Track my application",
  "careers.allRoles": "All open roles",
  "careers.aboutRole": "About this role",
  "careers.looking": "What we are looking for",
  "careers.howWorks": "How hiring works here",
  "careers.step1": "Apply with your CV. You get a tracking code immediately.",
  "careers.step2": "Our AI screening reads your CV against the role's requirements.",
  "careers.step3":
    "If there is a fit, we open an assessment and you start it from the portal with your code.",
  "careers.step4":
    "Your recruiter books the interview and confirms the time and joining link with you.",
  "careers.otherRoles": "Other roles at {name}",
  "careers.otherRolesUs": "Other roles with us",
  "careers.aboutCompany": "About {name}",
  "careers.theirStory": "Their story",
  "careers.online": "{name} online",
  "chat.openRole": "Ask about this role",
  "chat.openBoard": "Ask about our roles",
  "chat.title": "Careers assistant",
  "chat.aiBadge": "AI",
  "chat.note":
    "Answers only what these pages publish. A chat is not an application.",
  "chat.greetingRole":
    "Hi — I can tell you what this page says about {role}. What would you like to know?",
  "chat.greetingBoard":
    "Hi — I can tell you what our careers pages say about the roles we have open. What would you like to know?",
  "chat.placeholder": "Ask about pay, location, what the role involves…",
  "chat.send": "Send",
  "chat.thinking": "Reading the page…",
  "chat.failed": "No answer came back. Try again in a moment.",
  "chat.lead": "Leave my details",
  "chat.leadCancel": "Not now",
  "chat.leadTitle": "Leave your details",
  "chat.leadNote":
    "A recruiter reads this with the conversation attached. It is not an application — send your CV through the form to be considered.",
  "chat.leadName": "Full name",
  "chat.leadEmail": "Email",
  "chat.leadPhone": "Phone",
  "chat.leadSave": "Send to a recruiter",
  "chat.leadSaving": "Sending…",
  "chat.leadSaved":
    "Saved with this conversation. A recruiter can read it — it is not an application yet.",
  "chat.leadFailed": "Could not save that. Try again in a moment.",
  "chat.askSalary": "What is the pay?",
  "chat.askDuties": "What would I actually do?",
  "chat.askLooking": "What are you looking for?",
  "chat.askLocation": "Where is the role based?",
  "chat.askBenefits": "What does the group offer its people?",
  "chat.askOther": "Do you have other roles open?",
  "chat.askRoles": "Which roles are open right now?",
  "chat.askProcess": "How does hiring work here?",

  // ---- The figures a company profile prints, and the board's filter titles.
  "glance.founded": "Founded",
  "glance.ownership": "Ownership",
  "glance.people": "People",
  "glance.headquarters": "Headquarters",
  "glance.sector": "Sector",
  "facet.department": "Department",
  "facet.location": "Location",
  "facet.jobType": "Job type",
  "facet.sector": "Sector",
  "board.searchAria": "Search and filter open roles",
  "board.searchPlaceholder": "Search a role, team, city or company",
  "board.clearSearch": "Clear the search text",
  "board.clearFilters": "Clear filters",
  "board.filters": "Filters",
  "board.hideFilters": "Hide filters",
  "board.companies": "Companies",
  "board.tabAll": "All companies",
  "board.tabUnlisted": "Unlisted",
  "board.showingAll": "{shown} roles open",
  "board.showingFiltered": "{shown} of {total} roles open",
  "board.showingCompanyOne": "{shown} open role at {company}",
  "board.showingCompanyMany": "{shown} open roles at {company}",
  "board.emptyTitle": "No open roles right now",
  "board.emptyBody":
    "Please check back soon — new openings are posted here as soon as they are approved.",
  "board.emptyMatchTitle": "Nothing matches that search",
  "board.emptyMatchBody":
    "None of the {count} open roles fit the words and filters you chose. Clear them to see the whole board.",
  "board.companiesAria": "Companies with open roles",
  "board.openRole": "{count} open role",
  "board.openRoles": "{count} open roles",
  "board.searchLabel": "Search open roles",
  "careers.viewApply": "View & apply",

  // ---- The stepped application. One screen at a time, so the words a step
  // owns live under `apply.` and the page that shows them owns nothing else.
  "apply.ctaTitle": "Apply for this role",
  "apply.ctaNote":
    "Four short steps — your details, your CV, this role's questions, and a review before anything is sent.",
  "apply.ctaButton": "Start the application",
  "apply.ctaMinutes": "It takes a few minutes, and you get a tracking code at the end.",
  "apply.title": "Apply for {role}",
  "apply.exit": "Back to the role",
  "apply.intro": "Four short steps. Nothing is sent until you submit on the last one.",
  "apply.stepOf": "Step {step} of {total}",
  "apply.steps.about": "About you",
  "apply.steps.cv": "Your CV",
  "apply.steps.questions": "This role's questions",
  "apply.steps.review": "Review",
  "apply.back": "Back",
  "apply.next": "Continue",
  "apply.submit": "Submit application",
  "apply.submitting": "Submitting…",
  "apply.edit": "Edit",
  "apply.notSet": "Not filled in",
  "apply.aboutTitle": "About you",
  "apply.aboutNote": "This is how the hiring team reaches you about this role.",
  "apply.name": "Full name",
  "apply.namePlaceholder": "Youssef El-Sayed",
  "apply.email": "Email",
  "apply.phone": "Phone",
  "apply.phonePlaceholder": "+20 100 000 0000",
  "apply.source": "How did you hear about us?",
  "apply.source.site": "This careers site",
  "apply.source.board": "A job board",
  "apply.source.referral": "A referral",
  "apply.source.referred":
    "You arrived through a team member's link, so this application is credited to them.",
  "apply.optional": "Optional",
  "apply.linkedin": "LinkedIn profile",
  "apply.linkedinPlaceholder": "https://www.linkedin.com/in/your-name",
  "apply.linkedinNote":
    "Optional. Your link is filed with your application text, where the hiring team reads it. With a link here, the button at the top of this step can draft your About me from your profile — LinkedIn refuses most automated reads, so if nothing comes back, choose your CV instead or write those lines yourself.",
  "apply.aboutMe": "About me",
  "apply.aboutMePlaceholder":
    "A few lines about who you are and what you do — or use the button at the top of this step to draft them from your LinkedIn profile or your CV.",
  "apply.aboutMeNote":
    "This text, along with any CV file you attach, is what our screening step reads. It is sent as your own words, so change anything that is not you.",
  "apply.aboutFill": "Write it from my LinkedIn or CV",
  "apply.aboutFilling": "Writing…",
  "apply.aboutPick": "Choose your CV to write from",
  "apply.aboutFillNote":
    "With a LinkedIn link on this step, it drafts from that link. With the field empty and no CV attached, it opens your file picker — PDF, Word or text, up to {mb} MB. The CV you choose here is the same one attached on the CV step.",
  "apply.about.noSource":
    "No link and no CV yet, so this button opens your file picker for you to choose the CV to draft from — or add a LinkedIn link above and it reads that instead.",
  "apply.about.written": "Drafted from your {sources}.",
  "apply.about.check": "Read it and change anything that is not you.",
  "apply.about.kept": "You had already written your About me, so it stayed as you wrote it.",
  "apply.about.failed": "We could not write an About me from that just now.",
  "apply.about.unreachable":
    "We could not reach the writing helper just now. Write a few lines yourself — the rest of your application is unaffected.",
  "apply.word.linkedin": "LinkedIn profile",
  "apply.word.cv": "CV",
  "apply.cvTitle": "Your CV",
  "apply.cvNote": "Attach your CV file. This is what our screening step reads.",
  "apply.cvAttach": "Attach your CV",
  "apply.cvChoose": "Choose a file",
  "apply.cvTypes": "PDF, Word or text — up to {mb} MB",
  "apply.cvRemove": "Remove attached CV",
  "apply.cvFill": "Fill my name, email and phone from this CV",
  "apply.cvFilling": "Reading your CV…",
  "apply.cvFillNote":
    "Your CV text is read to fill those three fields. Nothing is submitted until the last step, and every field stays editable.",
  "apply.cvFillCheck": "Use Back to check them before you continue.",
  "apply.cvHasAbout":
    "Your About-me text is on the first step — that, together with this file, is what our screening step reads. Press the button there to draft it from this CV.",
  "apply.cvNoAbout":
    "Without a file, our screening step reads the About-me text from the first step. Attach your CV here, or write those lines there.",
  "apply.fill.written": "Filled in your {fields}.",
  "apply.fill.kept": "You had already typed your {fields}, so that stayed as you wrote it.",
  "apply.fill.absent": "Your CV did not state your {fields}.",
  "apply.fill.none":
    "Nothing in that file looked like your contact details. Fill the fields yourself.",
  "apply.fill.failed": "We could not read your CV just now. Fill the fields yourself.",
  "apply.fill.unreachable":
    "We could not reach the detail reader. Fill the fields yourself — your CV is still reviewed.",
  "apply.word.name": "name",
  "apply.word.email": "email",
  "apply.word.phone": "phone number",
  "apply.qTitle": "Before you apply",
  "apply.qNote":
    "A few details about this role that everyone who applies is asked to fill in. Please answer each one.",
  "apply.qLoading": "Loading the application questions for this role…",
  "apply.qLoadFailed": "We could not load this role's application questions.",
  "apply.qRetry": "Try again",
  "apply.qNone": "This role asks nothing beyond your details and your CV.",
  "apply.qWarnReview":
    "This role's questions could not be read, so nothing is listed here. Try again on that step before submitting, or the submission is refused for the answers we cannot see.",
  "apply.reviewTitle": "Check your application",
  "apply.reviewNote": "Nothing has been sent yet. Open any step to change it.",
  "apply.reviewName": "Name",
  "apply.reviewEmail": "Email",
  "apply.reviewPhone": "Phone",
  "apply.reviewSource": "Heard about us",
  "apply.reviewLink": "LinkedIn",
  "apply.reviewAbout": "About me",
  "apply.reviewWritten": "{count} characters of text",
  "apply.reviewCv": "CV",
  "apply.reviewFile": "Attached — {name}",
  "apply.reviewCvFromAbout":
    "No file attached — our screening step reads your About me from the first step.",
  "apply.reviewQuestions": "This role's questions",
  "apply.privacy":
    "Your details are handled as our privacy notice describes, and you get a tracking code on the next screen.",
  "apply.consentHeading": "Your privacy",
  "apply.consent.processing":
    "I agree that Sharm Dreams Group may process my application — my contact details, my CV and my answers — to assess me for this role.",
  "apply.consent.processingNote": "This is needed to receive and review an application.",
  "apply.consent.required": "Please tick the processing consent before submitting.",
  "apply.consent.pool":
    "Keep my details for {months} months so you can consider me for other roles.",
  "apply.consent.poolNote":
    "Optional. Leave it unticked and your details are kept only for this application. You can change your mind on the privacy page at any time.",
  "apply.consent.privacyLink": "Read the privacy notice",
  "apply.doneTitle": "Application received",
  "apply.doneBody":
    "Thank you for applying for {role}. Our people team will review your application and contact you if there is a fit.",
  "apply.doneCode": "Your tracking code",
  "apply.doneCodeNote":
    "Save this now — we have also copied it to your clipboard. Use it on the tracking page to follow your application at any time. Without it we cannot show you your progress.",
  "apply.doneTrack": "Track this application",
  "apply.doneBack": "Back to all roles",
  "apply.err.name": "Enter your full name.",
  "apply.err.email": "Enter a valid email address.",
  "apply.err.link": "Enter your linkedin.com profile link, or leave the field empty.",
  "apply.err.cv":
    "Attach your CV file, or write a few lines about yourself on the first step, so we can review your application.",
  "apply.err.questions": "Please answer every question before continuing.",
  "apply.err.fileType": "Attach a PDF, Word document or plain-text CV.",
  "apply.err.fileSize": "That file is larger than {mb} MB. Please attach a smaller CV.",
  "apply.err.failed": "Something went wrong. Please try again.",
  "apply.err.upload": "We could not attach your CV. Try pasting your CV text instead.",

  // ---- The authored form. The step headings, labels, help and placeholders are
  // the recruiter's own sentences and arrive as filed; everything here is the
  // furniture around them.
  "apply.dyn.formStep": "Your application",
  "apply.dyn.required": "Please answer “{label}”.",
  "apply.dyn.badUrl": "Enter a full web address starting with http:// or https://.",
  "apply.dyn.agree": "I agree",
  "apply.dyn.ratherNot": "I'd rather not say",
  "apply.dyn.consentNote":
    "Answering is optional and never decides your application. “I'd rather not say” leaves this part out of your profile; the application carries on.",
  "apply.dyn.declined":
    "You chose not to answer this part. It is left out, and your application carries on.",
  "apply.dyn.chooseFile": "Choose a file",
  "apply.dyn.replaceFile": "Choose another file",
  "apply.dyn.removeFile": "Remove",
  "apply.dyn.uploading": "Uploading…",
  "apply.dyn.uploadFailed": "That file could not be uploaded. Try again.",
  "apply.dyn.tooLarge": "That file is larger than {mb} MB.",
  "apply.dyn.choose": "Choose one",
  "apply.dyn.yes": "Yes",
  "apply.dyn.no": "No",
  "apply.dyn.amount": "Amount",
  "apply.dyn.unit": "Unit",
  "apply.dyn.useLocation": "Use my location",
  "apply.dyn.locating": "Finding you…",
  "apply.dyn.locationFailed":
    "We could not read your location. Type the two numbers instead.",
  "apply.dyn.lat": "Latitude",
  "apply.dyn.lng": "Longitude",
  "apply.dyn.address.line1": "Address line 1",
  "apply.dyn.address.line2": "Address line 2",
  "apply.dyn.address.city": "City",
  "apply.dyn.address.region": "Region",
  "apply.dyn.address.postalCode": "Postal code",
  "apply.dyn.address.country": "Country",
  "privacy.back": "Back to careers",
  "privacy.eyebrow": "Your data",
  "privacy.title": "Your privacy choices",
  "privacy.intro":
    "You can ask for a copy of what we hold about your application, or ask us to erase it. Requests open from a private link we email to you.",
  "privacy.signedLink": "Opened from your link",
  "privacy.recordFor": "Application for",
  "privacy.linkMask": "This link speaks about the record for {email}.",
  "privacy.linkExpires": "It stops working on {date}.",
  "privacy.chooseKind": "What would you like us to do?",
  "privacy.kind.access": "Send me a copy",
  "privacy.kind.accessHint": "A list of what we hold, mailed to your address.",
  "privacy.kind.erasure": "Erase my data",
  "privacy.kind.erasureHint": "Your name and details are removed from the record.",
  "privacy.erasureWarning":
    "This cannot be undone once it runs. Your application keeps its stage and score, but it will no longer name you.",
  "privacy.noteLabel": "Anything we should know? (optional)",
  "privacy.file": "Send request",
  "privacy.filing": "Sending…",
  "privacy.askLinkBody":
    "Requests open from a link we email to the address on your application. It works for seven days and speaks about one application only.",
  "privacy.emailLabel": "The email address you applied with",
  "privacy.sendLink": "Email me a private link",
  "privacy.sending": "Sending…",
  "privacy.linkQuiet":
    "We answer the same way whether or not that address is on file, and the link goes only to the address we stored. If nothing arrives, check the spelling and the spam folder.",
  "privacy.unreachable": "We could not reach the portal just now. Try again in a moment.",
  "privacy.keepTitle": "What we hold, and for how long",
  "privacy.keepBody":
    "We keep your application and what you attached to it for {months} months after the last activity on it. If you agreed to be considered for other roles, we keep your details for {poolMonths} months from that agreement. We warn you {warningDays} days before anything is removed, and you can ask for it sooner at any time.",
  "privacy.noticeVersion": "Notice version {version}.",
  "privacy.erasureTitle": "What erasing means",
  "privacy.erasureBody":
    "Erasing removes your name, contact details, CV, answers and notes, and deletes the files you attached. The record that an application was received and judged stays without your identity, because the group keeps its own hiring history. Someone who was hired stays on record for that reason.",
  "privacy.decideTitle": "Who decides",
  "privacy.decideBody":
    "A recruiter checks that the request comes from the person on the record, and the owner approves what happens next. You hear from us by email before anything is removed. If you were hired, this page does not erase your employment record.",

  // ---- The offer a candidate answers from a mailed link.
  "offer.back": "Back to careers",
  "offer.eyebrow": "Your offer",
  "offer.title": "Your offer",
  "offer.intro":
    "This page belongs to the offer we emailed you. You can accept or decline it here, until the deadline shown below.",
  "offer.for": "Offer for",
  "offer.deadline": "Please answer by {date}.",
  "offer.accept": "Accept the offer",
  "offer.decline": "Decline the offer",
  "offer.sending": "Recording your answer…",
  "offer.answered": "This offer has already been answered.",
  "offer.accepted":
    "You accepted this offer. A recruiter will confirm the next steps with you directly.",
  "offer.declined": "You declined this offer. A recruiter will be in touch.",
  "offer.withdrawn":
    "This offer was withdrawn. Contact the recruiter who sent it if you have questions.",
  "offer.expired":
    "The deadline for this offer has passed. Contact the recruiter who sent it if you would still like to be considered.",
  "offer.unreachable": "We could not reach the portal just now. Try again in a moment.",
  "offer.noToken": "This page opens from the link we emailed you about your offer.",

  // ---- The person-profile spine (migration 043). Keys come from the field
  // registry (`person-fields.ts`), the notice groups (`person-notice.ts`) and
  // the three desks that write them, so a field added to the store and not to
  // this dictionary shows as a gap in Settings → Languages instead of an
  // English word on an Arabic screen.
  //
  // Arabic wording for a medical or family field is reviewed by a human, not
  // drafted by the `translation` capability. A machine guess beside a diagnosis
  // is a worse failure than a untranslated key.
  "candidates.person.field.legal_name": "Legal name",
  "candidates.person.field.preferred_name": "Preferred name",
  "candidates.person.field.pronouns": "Pronouns",
  "candidates.person.field.gender": "Gender (as the person wrote it)",
  "candidates.person.field.date_of_birth": "Date of birth",
  "candidates.person.field.birthplace": "Birthplace",
  "candidates.person.field.national_id": "National ID",
  "candidates.person.field.nationality": "Nationality",
  "candidates.person.field.phone": "Phone",
  "candidates.person.field.mailing_address": "Mailing address",
  "candidates.person.field.current_city": "Current city",
  "candidates.person.field.photo_path": "Photo",
  "candidates.person.field.photo_mime": "Photo format",
  "candidates.person.field.employment": "Work history",
  "candidates.person.field.education": "Education",
  "candidates.person.field.languages": "Languages",
  "candidates.person.field.skills": "Skills",
  "candidates.person.field.certifications": "Certifications",
  "candidates.person.field.marital_status": "Marital status",
  "candidates.person.field.children_count": "Children (count)",
  "candidates.person.field.household_size": "Household size",
  "candidates.person.field.housing_tenure": "Housing tenure",
  "candidates.person.field.commute_mode": "Commute mode",
  "candidates.person.field.commute_minutes": "Commute (minutes)",
  "candidates.person.field.relocation_willingness": "Willing to relocate",
  "candidates.person.field.travel_restrictions": "Travel restrictions",
  "candidates.person.field.disability_status": "Disability status",
  "candidates.person.field.accommodations": "Accommodations",
  "candidates.person.field.chronic_conditions": "Chronic conditions",
  "candidates.person.field.allergies": "Allergies",
  "candidates.person.field.dietary_restrictions": "Dietary restrictions",
  "candidates.person.field.blood_type": "Blood type",
  "candidates.person.field.health_insurance": "Health insurance",
  "candidates.person.field.partner_name": "Partner's name",
  "candidates.person.field.partner_occupation": "Partner's occupation",
  "candidates.person.field.partner_contact": "Partner's contact",
  "candidates.person.field.anniversary_date": "Wedding date",
  "candidates.person.field.household_composition": "Who lives in the house",
  "candidates.person.field.family_planning": "Family planning",
  "candidates.person.field.dependants": "Dependants",
  "candidates.person.field.emergency_contacts": "Emergency contacts",

  "candidates.person.tab.history": "History",
  "candidates.person.tab.skills": "Skills",
  "candidates.person.tab.background": "Background",
  "candidates.person.tab.health": "Health",
  "candidates.person.tab.family": "Family",
  "candidates.person.tab.changes": "Changes",

  "candidates.person.section.career": "Career indicators",
  "candidates.person.section.work": "Work history",
  "candidates.person.section.education": "Education",
  "candidates.person.section.languages": "Languages",
  "candidates.person.section.skills": "Skills claimed",
  "candidates.person.section.certifications": "Certifications",
  "candidates.person.section.identity": "Identity",
  "candidates.person.section.contact": "Contact and location",
  "candidates.person.section.marital": "Marital status and children",
  "candidates.person.section.housing": "Housing and commute",
  "candidates.person.section.health": "Health and disability",
  "candidates.person.section.family": "Family details",
  "candidates.person.section.dependants": "Dependants",
  "candidates.person.section.emergency": "Emergency contacts",
  "candidates.person.section.changes": "Changes to this person",

  "candidates.person.notice.identity.title": "Your basic identity",
  "candidates.person.notice.contact.title": "How we reach you",
  "candidates.person.notice.work_history.title": "Your jobs and experience",
  "candidates.person.notice.education.title": "Your education",
  "candidates.person.notice.languages.title": "The languages you speak",
  "candidates.person.notice.skills.title": "Your skills and certifications",
  "candidates.person.notice.photo.title": "Your photograph",
  "candidates.person.notice.marital_status.title": "Marital status and number of children",
  "candidates.person.notice.family_details.title": "Family details",
  "candidates.person.notice.dependants.title": "Your dependants",
  "candidates.person.notice.emergency_contacts.title": "Emergency contacts",
  "candidates.person.notice.health.title": "Health and disability",
  "candidates.person.notice.housing.title": "Housing and commute",
  "candidates.person.notice.extraction.title": "Turning your CV into structured facts",

  "candidates.person.consent.title": "What the candidate agreed to",
  "candidates.person.consent.blurb":
    "One row per answer, newest wins. Nothing is edited: a change of mind is a later row, and a field whose group has no live agreement is refused rather than saved. Record here what the candidate said — this desk does not decide it for them.",
  "candidates.person.consent.notAsked": "not asked yet",
  "candidates.person.consent.agreed": "agreed",
  "candidates.person.consent.olderNotice": "agreed to an older notice — record it again",
  "candidates.person.consent.declined": "declined",
  "candidates.person.consent.recordAgreement": "Record agreement",
  "candidates.person.consent.recordRefusal": "Record refusal",
  "candidates.person.consent.wording": "The wording they were asked",

  "candidates.person.extract.title": "Structure the CV into the profile",
  "candidates.person.extract.blurb":
    "Reads the stored CV and reports dated roles, schooling, languages, skills and certificates. Nothing is written until you read the preview and confirm it, and a value it finds fills an empty field only — it never overwrites a hand.",
  "candidates.person.extract.noConsent":
    "The candidate has no live agreement to the CV-structuring notice, so this door is shut. Record their answer in the consent list above first.",
  "candidates.person.extract.preview": "Preview what the CV says",
  "candidates.person.extract.reading": "Reading the CV…",
  "candidates.person.extract.previewHeading": "Preview · nothing saved yet",
  "candidates.person.extract.write": "Write it into the profile",
  "candidates.person.extract.discard": "Discard the preview",
  "candidates.person.extract.dropped":
    "The model returned {fields} — outside the operational list this extraction may write, so they were dropped and named here rather than saved.",
  "candidates.person.extract.written": "Wrote {count} sections into the profile.",

  "candidates.indicators.total": "Total experience",
  "candidates.indicators.roles": "{count} dated roles",
  "candidates.indicators.longest": "Longest role",
  "candidates.indicators.shortest": "shortest {value}",
  "candidates.indicators.gaps": "Gaps between roles",
  "candidates.indicators.longestGap": "longest {value}",
  "candidates.indicators.noGap": "one role, so no gap to measure",
  "candidates.indicators.churn": "Roles per five years",
  "candidates.indicators.churnNote": "a count over the dated span, not a verdict",
  "candidates.indicators.coverage":
    "{withMonths} of {rows} roles state a start month, so the rest are counted as whole years. {withEnd} state an end — an ongoing role's end is “now”. No figure here is a score, and none is attached to the AI screening above.",
  "candidates.indicators.empty":
    "No dated roles are on file, so there is nothing to count. A hand edit or the CV structuring fills this — zero experience is not a figure this page will print.",

  "candidates.health.withheldTitle": "Health data is not shown to you",
  "candidates.health.withheldNote":
    "This is a special-category group behind its own grant. The absence of rows here is a statement about your account, not about this person.",
  "candidates.health.openLogged":
    "You hold the health-data grant, so this open is recorded in the activity trail. Health answers are never handed to a model, never used to screen and never scored.",
  "candidates.health.noConsent":
    "The person's agreement to this group is not live, so a hand edit here will be refused until the answer is recorded in Background.",
  "candidates.health.groupBlurb":
    "Every question is optional; the group may be declined as a whole.",
  "candidates.health.noRow":
    "No health row has been written. That is one of three different facts — never asked, asked and declined, or asked and left blank — and the consent list in Background tells them apart.",
  "candidates.health.noColumns": "No health columns are on file yet.",

  "candidates.family.withheldTitle": "{label} is not shown to you",
  "candidates.family.withheldNote":
    "This is other people's data behind a named grant. An empty list here does not mean there is nothing to see.",
  "candidates.family.groupBlurb":
    "Partner details, the wedding date and who lives in the house. Held for the person who shared them, not for screening.",
  "candidates.family.notLogged":
    "Opens of emergency contacts and family details are not written to the activity trail — only the health open is logged.",

  "candidates.person.card.title": "Who they are",
  "candidates.person.card.metaPerson": "the person behind every application",
  "candidates.person.card.metaRecord": "what this application record knows",
  "candidates.person.card.born": "Born",
  "candidates.person.card.basedIn": "Based in",
  "candidates.person.card.trackingCodes": "Tracking codes",
  "candidates.person.card.cameThrough": "Came through",
  "candidates.person.card.firstSeen": "First seen",
  "candidates.person.card.lastActivity": "Last activity",
  "candidates.person.card.records": "Records",
  "candidates.person.label.email": "Email",
  "candidates.person.label.notOnFile": "not on file",
  "candidates.person.label.notStated": "not stated",
  "candidates.person.label.noneOnFile": "none on file",

  "candidates.person.changes.blurb":
    "Every write to this person, with the door it came through. A row about a Tier-3 group is only here when your account holds that group's grant.",
  "candidates.person.changes.empty": "No change has been recorded on the profile spine yet.",

  "candidates.person.save.nothingChanged": "Nothing has changed in this section.",
  "candidates.person.save.saved": "Saved {count} fields.",
  "candidates.person.save.nothingWritten": "Nothing was written.",
  "candidates.person.save.onlyChanged":
    "Only the fields you changed are written, each with its own history row.",
  "candidates.person.save.button": "Save {count} changes",
  "candidates.person.save.readOnly":
    "This account can read the profile but not edit it. Editing needs the Edit candidates permission.",
  "candidates.person.save.conflict":
    "{label}: kept the value a higher door wrote. The incoming {value} does not outrank it.",

  "candidates.person.drawer.button": "Record a candidate",
  "candidates.person.drawer.eyebrow": "Talent database",
  "candidates.person.drawer.title": "Record a candidate by hand",
  "candidates.person.drawer.subtitle":
    "For someone who never applied through the careers site. Add their CV and photo now.",
  "candidates.person.drawer.filed":
    "Filed under New — the CV is attached and read in before screening.",
  "candidates.person.drawer.submit": "Record candidate",
  "candidates.person.drawer.submitAnother": "Record another",
  "candidates.person.drawer.note":
    "Nothing is sent to the candidate. They didn't apply, so a confirmation would be wrong.",
  "candidates.person.drawer.job": "Job opening",
  "candidates.person.drawer.loading": "Loading openings…",
  "candidates.person.drawer.selectOpening": "Select opening…",
  "candidates.person.drawer.name": "Full name",
  "candidates.person.drawer.source": "Where they came from",
  "candidates.person.drawer.cv": "CV file",
  "candidates.person.drawer.photo": "Profile photo",
  "candidates.person.drawer.personDetails": "Person details (optional)",
  "candidates.person.drawer.groupIdentity": "Identity",
  "candidates.person.drawer.groupContact": "Contact",
  "candidates.person.drawer.groupMarital": "Marital & family status",
  "candidates.person.drawer.groupHousing": "Housing & commute",
  "candidates.person.drawer.groupHealth": "Health (restricted)",
  "candidates.person.drawer.groupFamily": "Family details (restricted)",

  // ---- The closed enums a job row carries. A value with no key here is shown
  // as the English label instead, so an enum the build has no words for never
  // prints its own key.
  "enum.hospitality": "Hospitality",
  "enum.real_estate": "Real estate",
  "enum.commercial_development": "Commercial development",
  "enum.corporate": "Corporate",
  "enum.full_time": "Full time",
  "enum.part_time": "Part time",
  "enum.contract": "Contract",
  "enum.internship": "Internship",
  "enum.remote": "Remote",
  "enum.hybrid": "Hybrid",
  "enum.junior": "Junior",
  "enum.mid": "Mid",
  "enum.senior": "Senior",
  "enum.lead": "Lead",
};

const ar: Dictionary = {
  "nav.dashboard": "لوحة التحكم",
  "nav.assessments": "التقييمات",
  "nav.candidates": "المرشحون",
  "nav.jobs": "الوظائف",
  "nav.onboarding": "التأهيل",
  "nav.portal": "بوابة المرشح",
  "nav.signOut": "تسجيل الخروج",
  "common.loading": "جار التحميل…",
  "common.error": "حدث خطأ ما",
  "common.retry": "إعادة المحاولة",
  "common.submit": "إرسال",
  "common.save": "حفظ",
  "common.cancel": "إلغاء",
  "common.next": "التالي",
  "common.previous": "السابق",
  "common.close": "إغلاق",
  "jobs.apply": "قدّم الآن",
  "jobs.openings": "الوظائف المتاحة",
  "assessment.title": "تقييم المهارات",
  "assessment.timer": "الوقت المتبقي",
  "assessment.draftSaved": "تم حفظ المسودة",
  "assessment.video.record": "بدء التسجيل",
  "assessment.video.stop": "إيقاف ومراجعة",
  "assessment.video.rerecord": "إعادة التسجيل",
  "assessment.submit": "إرسال التقييم",
  "portal.title": "تابع طلبك",
  "portal.code": "رمز التتبع",
  "portal.search": "بحث",
  "portal.eyebrow": "بوابة المرشح",
  "portal.intro":
    "أدخل رمز التتبع الذي حصلت عليه عند التقديم لتعرف مرحلتك الحالية وتقييمك والخطوات التالية.",
  "portal.codeHint": "الشكل مشابه لـ",
  "portal.track": "تتبّع",
  "portal.searching": "جارٍ البحث…",
  "portal.lookupFailed": "حدث خطأ ما. حاول مرة أخرى.",
  "portal.hello": "مرحبًا، {name}",
  "portal.positionUnderReview": "وظيفة قيد المراجعة",
  "portal.matchScore": "درجة الملاءمة",
  "portal.assessmentScore": "درجة التقييم",
  "portal.notSelected": "لم يتم الاختيار",
  "portal.actionNeeded": "مطلوب إجراء",
  "portal.inProgress": "قيد التنفيذ",
  "portal.applied": "تم التقديم {when}",
  "portal.startAssessment": "ابدأ التقييم",
  "portal.resumeAssessment": "أكمل التقييم",
  "portal.progress": "تقدم الطلب: {stage}",
  "portal.messages": "رسائل من فريق التوظيف",
  "portal.newCount": "{count} جديدة",
  "portal.markAllRead": "تحديد الكل كمقروء",
  "portal.marking": "جارٍ التحديد…",
  "portal.noSubject": "مستجد بخصوص طلبك",
  "portal.badgeNew": "جديد",
  "portal.needHelp": "تحتاج مساعدة؟",
  "portal.helpText":
    "إذا انتهى رابطك أو لم تعثر على رمز التتبع، راسل فريق المواهب وسيقوم بالبحث نيابةً عنك.",
  "portal.language": "اللغة",
  "portal.next.rejected":
    "شكرًا لتقديمك. بعد مراجعة دقيقة لم نتمكن من المضي في طلبك لهذه الوظيفة. نقدّر وقتك ونتمنى لك كل التوفيق في بحثك.",
  "portal.next.hired": "مبروك — سيتواصل معك فريق الموارد البشرية بخصوص العرض.",
  "portal.next.interview": "يتم الآن تحديد موعد مقابلتك. سنؤكد لك الوقت ورابط الانضمام.",
  "portal.next.submitted": "تم إرسال تقييمك وهو الآن لدى فريق التوظيف.",
  "portal.next.inProgress": "التقييم قيد التنفيذ — متبقٍ {time}.",
  "portal.next.closedWindow": "انتهت مدة التقييم.",
  "portal.next.invited": "لديك دعوة لإكمال تقييمك. افتح الرابط الآمن بالأسفل.",
  "portal.next.screening": "طلبك حاليًا لدى فريق الفرز.",
  "stage.new": "الطلب",
  "stage.ai_screening": "الفرز بالذكاء الاصطناعي",
  "stage.assessment": "التقييم",
  "stage.interview": "المقابلة",
  "stage.offer": "العرض",
  "stage.hired": "التعيين",
  "time.today": "اليوم",
  "time.daysAgo": "قبل {count} يوم",
  "time.monthsAgo": "منذ {count} شهر",
  "login.title": "تسجيل الدخول",
  "login.email": "البريد الإلكتروني",
  "login.password": "كلمة المرور",
  "login.action": "دخول",

  "chrome.careers": "الوظائف",
  "chrome.track": "تتبّع الطلب",
  "chrome.trackCta": "تتبّع طلبك",
  "chrome.explore": "استكشف",
  "chrome.language": "اللغة",
  "chrome.languageAuto": "تلقائي",
  "chrome.theme": "المظهر",
  "chrome.careersFooter":
    "تراجع فريق الموارد البشرية الطلبات. احتفظ برمز التتبع الخاص بك، فهو الوسيلة الوحيدة لمتابعة طلبك.",

  "home.badge": "منصة توظيف مدعومة بالذكاء الاصطناعي",
  "home.titleA": "ذكاء المواهب،",
  "home.titleB": "دون عناء الإجراءات",
  "home.lede":
    "توظيف متعدد الشركات لمجموعة شرم دريمز — فرز سير ذاتية يقلّل التحيز، وتقييمات تفاعلية، وجدولة مقابلات بإشعارات تلقائية للمرشحين، وتحليلات فورية للتوظيف.",
  "home.cap1Eyebrow": "وظائف متاحة",
  "home.cap1Title": "التوظيف في كل شركات المجموعة",
  "home.cap1Copy":
    "كل وظيفة منشورة — تشغيل المنتجعات والعقارات والخدمات الإدارية — مع ذكر نطاق الراتب وطلب تقديم لا يستغرق دقائق.",
  "home.cap2Eyebrow": "التقييمات",
  "home.cap2Title": "اختبارات تُقيَّم على ما أنجزته فعلاً",
  "home.cap2Copy":
    "يؤدي المرشح المدعو تقييمه في المتصفح: نماذج مالية بحساب صافي القيمة الحالية ومعدل العائد الداخلي، وعروض مرئية، ودراسات حالة، واختبارات، وتُراجع بحسب ما يرسله.",
  "home.cap3Eyebrow": "تجربة المرشح",
  "home.cap3Title": "بوابة يثق بها المرشحون",
  "home.cap3Copy": "تابع حالة طلبك ونتائج التقييم والخطوات التالية من أي جهاز وفي أي وقت.",
  "home.serving": "نخدم مجموعة",
  "home.footerTag": "منصة موارد بشرية ونظام تتبع مرشحين وتقييم للمؤسسات",

  "careers.hiring": "نحن نوظّف",
  "careers.timeline": "المسيرة الزمنية",
  "careers.undated": "بلا تاريخ",
  "careers.benefits": "ما تقدّمه المجموعة لأفرادها",
  "careers.alsoGroup": "من المجموعة أيضاً",
  "careers.alsoGroupNote":
    "لا تملك هذه الشركات وظائف متاحة الآن — القائمة أعلاه هي كل ما توظّف له المجموعة اليوم.",
  "careers.applied": "هل قدّمت من قبل؟",
  "careers.appliedNote":
    "أدخل رمز التتبع الذي استلمته عند التقديم لتعرف مرحلتك الحالية ومقابلاتك القادمة والخطوات التالية.",
  "careers.trackMine": "تتبّع طلبي",
  "careers.allRoles": "كل الوظائف المتاحة",
  "careers.aboutRole": "عن هذه الوظيفة",
  "careers.looking": "ما نبحث عنه",
  "careers.howWorks": "كيف يسير التوظيف هنا",
  "careers.step1": "قدّم بالسيرة الذاتية، ويصلك رمز تتبع فوراً.",
  "careers.step2": "يقرأ الذكاء الاصطناعي سيرتك الذاتية مقابل متطلبات الوظيفة.",
  "careers.step3": "عند وجود توافق نفتح لك تقييماً تبدأه من البوابة برمزك.",
  "careers.step4": "يحجز مسؤول التوظيف المقابلة ويؤكد لك الموعد ورابط الانضمام.",
  "careers.otherRoles": "وظائف أخرى في {name}",
  "careers.otherRolesUs": "وظائف أخرى معنا",
  "careers.aboutCompany": "عن {name}",
  "careers.theirStory": "قصتهم",
  "careers.online": "{name} على الإنترنت",
  "chat.openRole": "اسأل عن هذه الوظيفة",
  "chat.openBoard": "اسأل عن وظائفنا",
  "chat.title": "مساعد التوظيف",
  "chat.aiBadge": "ذكاء اصطناعي",
  "chat.note": "يجيب فقط عمّا تنشره هذه الصفحات. المحادثة ليست طلب توظيف.",
  "chat.greetingRole":
    "مرحبًا — أستطيع أن أخبرك بما ورد في هذه الصفحة عن {role}. ماذا تريد أن تعرف؟",
  "chat.greetingBoard":
    "مرحبًا — أستطيع أن أخبرك بما ورد في صفحات التوظيف عن الوظائف المتاحة. ماذا تريد أن تعرف؟",
  "chat.placeholder": "اسأل عن الراتب أو الموقع أو طبيعة العمل…",
  "chat.send": "إرسال",
  "chat.thinking": "أقرأ الصفحة…",
  "chat.failed": "لم تصل إجابة. حاول بعد قليل.",
  "chat.lead": "اترك بياناتي",
  "chat.leadCancel": "ليس الآن",
  "chat.leadTitle": "اترك بياناتك",
  "chat.leadNote":
    "يقرأ مسؤول التوظيف هذه البيانات مع المحادثة مرفقة بها. هذا ليس طلب توظيف — قدّم بسيرتك الذاتية من النموذج ليُنظر في طلبك.",
  "chat.leadName": "الاسم الكامل",
  "chat.leadEmail": "البريد الإلكتروني",
  "chat.leadPhone": "الهاتف",
  "chat.leadSave": "أرسل إلى مسؤول التوظيف",
  "chat.leadSaving": "جارٍ الإرسال…",
  "chat.leadSaved": "حُفظت مع هذه المحادثة، ويستطيع مسؤول التوظيف قراءتها — هذا ليس طلب توظيف بعد.",
  "chat.leadFailed": "لم نتمكن من الحفظ. حاول بعد قليل.",
  "chat.askSalary": "كم الراتب؟",
  "chat.askDuties": "ما المهام الفعلية للوظيفة؟",
  "chat.askLooking": "من تبحثون عنه؟",
  "chat.askLocation": "أين مقر العمل؟",
  "chat.askBenefits": "ماذا تقدّم المجموعة لأفرادها؟",
  "chat.askOther": "هل لديكم وظائف أخرى؟",
  "chat.askRoles": "ما الوظائف المتاحة الآن؟",
  "chat.askProcess": "كيف يسير التوظيف هنا؟",

  "glance.founded": "السنة",
  "glance.ownership": "الملكية",
  "glance.people": "عدد الموظفين",
  "glance.headquarters": "المقر الرئيسي",
  "glance.sector": "القطاع",
  "facet.department": "القسم",
  "facet.location": "الموقع",
  "facet.jobType": "نوع الوظيفة",
  "facet.sector": "القطاع",
  "board.searchAria": "ابحث وصفِّ الوظائف المتاحة",
  "board.searchPlaceholder": "ابحث عن وظيفة أو فريق أو مدينة أو شركة",
  "board.clearSearch": "مسح نص البحث",
  "board.clearFilters": "مسح عوامل التصفية",
  "board.filters": "عوامل التصفية",
  "board.hideFilters": "إخفاء عوامل التصفية",
  "board.companies": "الشركات",
  "board.tabAll": "كل الشركات",
  "board.tabUnlisted": "غير مُدرَجة",
  "board.showingAll": "{shown} وظيفة متاحة",
  "board.showingFiltered": "{shown} من {total} وظيفة متاحة",
  "board.showingCompanyOne": "وظيفة واحدة متاحة في {company}",
  "board.showingCompanyMany": "{shown} وظائف متاحة في {company}",
  "board.emptyMatchBody":
    "لا شيء من الوظائف المتاحة ({count}) يطابق الكلمات وعوامل التصفية التي اخترتها. امسحها لترى القائمة كاملة.",
  "board.emptyTitle": "لا توجد وظائف متاحة الآن",
  "board.emptyBody": "نرجو العودة قريباً — تُنشر الوظائف الجديدة هنا فور اعتمادها.",
  "board.emptyMatchTitle": "لا نتيجة تطابق هذا البحث",
  "board.companiesAria": "الشركات التي لديها وظائف متاحة",
  "board.openRole": "وظيفة واحدة متاحة",
  "board.openRoles": "{count} وظائف متاحة",
  "board.searchLabel": "ابحث في الوظائف المتاحة",
  "careers.viewApply": "العرض والتقديم",

  "apply.ctaTitle": "قدّم على هذه الوظيفة",
  "apply.ctaNote":
    "أربع خطوات قصيرة — بياناتك، سيرتك الذاتية، أسئلة هذه الوظيفة، ثم مراجعة قبل أن يُرسل أي شيء.",
  "apply.ctaButton": "ابدأ الطلب",
  "apply.ctaMinutes": "لا تستغرق سوى دقائق، وتحصل في نهايتها على رمز تتبّع.",
  "apply.title": "التقديم على {role}",
  "apply.exit": "العودة إلى الوظيفة",
  "apply.intro": "أربع خطوات قصيرة. لا يُرسل شيء قبل أن تضغط إرسال في الخطوة الأخيرة.",
  "apply.stepOf": "الخطوة {step} من {total}",
  "apply.steps.about": "بياناتك",
  "apply.steps.cv": "سيرتك الذاتية",
  "apply.steps.questions": "أسئلة الوظيفة",
  "apply.steps.review": "المراجعة",
  "apply.back": "السابق",
  "apply.next": "متابعة",
  "apply.submit": "إرسال الطلب",
  "apply.submitting": "جارٍ الإرسال…",
  "apply.edit": "تعديل",
  "apply.notSet": "غير مُعبّأ",
  "apply.aboutTitle": "بياناتك",
  "apply.aboutNote": "بهذه البيانات يتواصل معك فريق التوظيف بخصوص هذه الوظيفة.",
  "apply.name": "الاسم الكامل",
  "apply.namePlaceholder": "يوسف السيد",
  "apply.email": "البريد الإلكتروني",
  "apply.phone": "الهاتف",
  "apply.phonePlaceholder": "+20 100 000 0000",
  "apply.source": "كيف سمعت عنا؟",
  "apply.source.site": "موقع التوظيف هذا",
  "apply.source.board": "موقع إعلانات وظيفية",
  "apply.source.referral": "ترشيح من شخص",
  "apply.source.referred":
    "لقد وصلت عبر رابط أحد أعضاء الفريق، لذا يُنسب هذا الطلب إليه.",
  "apply.optional": "اختياري",
  "apply.linkedin": "حساب لينكدإن",
  "apply.linkedinPlaceholder": "https://www.linkedin.com/in/your-name",
  "apply.linkedinNote":
    "اختياري. يُحفظ رابطك مع نص طلبك حيث يقرؤه فريق التوظيف. بوجود رابط هنا يستطيع الزر أعلى هذه الخطوة صياغة نبذتك من حسابك — لكن لينكدإن يرفض أغلب القراءة الآلية، فإذا لم يرجع شيء فاختر سيرتك الذاتية أو اكتب النبذة بنفسك.",
  "apply.aboutMe": "نبذة عنك",
  "apply.aboutMePlaceholder":
    "بضع سطور عن من أنت وماذا تعمل — أو استخدم الزر أعلى هذه الخطوة لصياغتها من حساب لينكدإن أو من سيرتك الذاتية.",
  "apply.aboutMeNote":
    "هذا النص مع أي ملف سيرة ذاتية مرفق هو ما تقرأه خطوة الفرز. يُرسل كأنه كلماتك أنت، فصحّح كل لا يشبهك.",
  "apply.aboutFill": "اكتبها من حسابي أو من سيرتي",
  "apply.aboutFilling": "نكتب النبذة…",
  "apply.aboutPick": "اختر سيرتك الذاتية لتُكتب منها",
  "apply.aboutFillNote":
    "بوجود رابط لينكدإن على هذه الخطوة تُكتب النبذة من ذلك الرابط. وبفارغ الحقل وبدون سيرة مرفقة يفتح الزر نافذة اختيار ملف — PDF أو Word أو نص، حتى {mb} ميغابايت. السيرة التي تختارها هنا هي نفسها المرفقة في خطوة السيرة الذاتية.",
  "apply.about.noSource":
    "لا رابط ولا سيرة بعد، لذا يفتح هذا الزر نافذة اختيار الملف لتنتقي السيرة التي تُكتب منها — أو أضف رابط لينكدإن في الأعلى ليقرأ منه بدل ذلك.",
  "apply.about.written": "صاغتها من {sources}.",
  "apply.about.check": "اقرأها وغيّر كل ما لا يشبهك.",
  "apply.about.kept": "كنت قد كتبت نبذتك بنفسك، فبقيت كما كتبتها.",
  "apply.about.failed": "لم نتمكن من كتابة نبذة من هذا الآن.",
  "apply.about.unreachable":
    "لم نتمكن من الوصول إلى أداة الكتابة الآن. اكتب بضع سطور بنفسك — بقية طلبك لم تتأثر.",
  "apply.word.linkedin": "حساب لينكدإن",
  "apply.word.cv": "السيرة الذاتية",
  "apply.cvTitle": "سيرتك الذاتية",
  "apply.cvNote": "أرفق ملف سيرتك الذاتية. هذا ما تقرأه خطوة الفرز.",
  "apply.cvAttach": "أرفق سيرتك الذاتية",
  "apply.cvChoose": "اختر ملفاً",
  "apply.cvTypes": "PDF أو Word أو نص — حتى {mb} ميغابايت",
  "apply.cvRemove": "إزالة الملف المرفق",
  "apply.cvFill": "املأ الاسم والبريد والهاتف من هذه السيرة",
  "apply.cvFilling": "نقرأ سيرتك الذاتية…",
  "apply.cvFillNote":
    "يُقرأ نص سيرتك لملء تلك الحقول الثلاثة. لا يُرسل شيء قبل الخطوة الأخيرة، وتبقى كل الحقول قابلة للتعديل.",
  "apply.cvFillCheck": "اضغط السابق لمراجعتها قبل المتابعة.",
  "apply.cvHasAbout":
    "نبذتك موجودة في الخطوة الأولى، وهي مع هذا الملف ما تقرأه خطوة الفرز. اضغط الزر هناك لصياغتها من هذه السيرة.",
  "apply.cvNoAbout":
    "بدون ملف مرفق، تقرأ خطوة الفرز نبذتك من الخطوة الأولى. أرفق سيرتك هنا أو اكتب تلك السطور هناك.",
  "apply.fill.written": "تم ملء {fields}.",
  "apply.fill.kept": "كنت قد كتبت {fields} بنفسك، فبقيت كما كتبتها.",
  "apply.fill.absent": "لم تذكر سيرتك الذاتية {fields}.",
  "apply.fill.none": "لا شيء في هذا الملف بدا كبيانات تواصلك. املأ الحقول بنفسك.",
  "apply.fill.failed": "لم نتمكن من قراءة سيرتك الذاتية الآن. املأ الحقول بنفسك.",
  "apply.fill.unreachable":
    "لم نتمكن من الوصول إلى قارئ التفاصيل. املأ الحقول بنفسك — وستبقى سيرتك قيد المراجعة.",
  "apply.word.name": "الاسم",
  "apply.word.email": "البريد الإلكتروني",
  "apply.word.phone": "رقم الهاتف",
  "apply.qTitle": "قبل أن تقدّم",
  "apply.qNote":
    "تفاصيل قليلة عن هذه الوظيفة يُطلب من كل متقدم تعبئتها. نرجو الإجابة على كل منها.",
  "apply.qLoading": "نحمّل أسئلة التقديم لهذه الوظيفة…",
  "apply.qLoadFailed": "لم نتمكن من تحميل أسئلة التقديم لهذه الوظيفة.",
  "apply.qRetry": "حاول مرة أخرى",
  "apply.qNone": "هذه الوظيفة لا تطلب شيئاً إضافة إلى بياناتك وسيرتك الذاتية.",
  "apply.qWarnReview":
    "لم نتمكن من قراءة أسئلة هذه الوظيفة، فلا شيء مُدرج هنا. أعد المحاولة في تلك الخطوة قبل الإرسال، وإلا سيُرفض الطلب لإجابات لا نراها.",
  "apply.reviewTitle": "راجع طلبك",
  "apply.reviewNote": "لم يُرسل شيء بعد. افتح أي خطوة لتعديلها.",
  "apply.reviewName": "الاسم",
  "apply.reviewEmail": "البريد الإلكتروني",
  "apply.reviewPhone": "الهاتف",
  "apply.reviewSource": "كيف سمعت عنا",
  "apply.reviewLink": "لينكدإن",
  "apply.reviewAbout": "نبذة عنك",
  "apply.reviewWritten": "{count} حرفاً من النص",
  "apply.reviewCv": "السيرة الذاتية",
  "apply.reviewFile": "مرفق — {name}",
  "apply.reviewCvFromAbout": "لا ملف مرفق — تقرأ خطوة الفرز نبذتك من الخطوة الأولى.",
  "apply.reviewQuestions": "أسئلة هذه الوظيفة",
  "apply.privacy":
    "نتعامل مع بياناتك وفقاً لإشعار الخصوصية، وستحصل على رمز تتبّع في الشاشة التالية.",
  "apply.consentHeading": "خصوصيتك",
  "apply.consent.processing":
    "أوافق على أن تعالج مجموعة شرم دريمز طلبي — بيانات التواصل وسيرتي الذاتية وإجاباتي — لتقييمي لهذه الوظيفة.",
  "apply.consent.processingNote": "هذه الموافقة لازمة لاستلام طلبك ومراجعته.",
  "apply.consent.required": "يرجى تحديد الموافقة على معالجة الطلب قبل الإرسال.",
  "apply.consent.pool": "احتفظوا ببياناتي لمدة {months} شهراً لتنظروا في ترشيحي لأدوار أخرى.",
  "apply.consent.poolNote":
    "اختياري. إن تركته دون تحديد، تُحفظ بياناتك لهذا الطلب فقط. ويمكنك تغيير رأيك في صفحة الخصوصية في أي وقت.",
  "apply.consent.privacyLink": "اقرأ إشعار الخصوصية",
  "apply.doneTitle": "وصلنا طلبك",
  "apply.doneBody":
    "شكرًا لتقديمك على {role}. سيراجع فريق الموارد البشرية طلبك ويتواصل معك إن وجد توافقاً.",
  "apply.doneCode": "رمز التتبع الخاص بك",
  "apply.doneCodeNote":
    "احفظه الآن — وقد نسخناه أيضاً إلى الحافظة. استخدمه في صفحة التتبّع لمتابعة طلبك في أي وقت، وبدونه لا نستطيع عرض تقدمك.",
  "apply.doneTrack": "تتبّع هذا الطلب",
  "apply.doneBack": "العودة إلى كل الوظائف",
  "apply.err.name": "أدخل اسمك الكامل.",
  "apply.err.email": "أدخل بريداً إلكترونياً صحيحاً.",
  "apply.err.link": "أدخل رابط حسابك على linkedin.com أو اترك الحقل فارغاً.",
  "apply.err.cv": "أرفق ملف سيرتك الذاتية أو اكتب بضع سطور عن نفسك في الخطوة الأولى حتى نتمكن من مراجعة طلبك.",
  "apply.err.questions": "أجب عن كل الأسئلة قبل المتابعة.",
  "apply.err.fileType": "أرفق ملف PDF أو Word أو نصاً عادياً.",
  "apply.err.fileSize": "هذا الملف أكبر من {mb} ميغابايت. أرفق ملفاً أصغر.",
  "apply.err.failed": "حدث خطأ ما. حاول مرة أخرى.",
  "apply.err.upload": "لم نتمكن من إرفاق سيرتك الذاتية. جرّب لصق نصّها بدلاً من ذلك.",
  "privacy.back": "العودة إلى الوظائف",
  "privacy.eyebrow": "بياناتك",
  "privacy.title": "خياراتك في الخصوصية",
  "privacy.intro":
    "يمكنك طلب نسخة من البيانات التي نحتفظ بها عن طلبك، أو طلب حذفها. تُفتح الطلبات من رابط خاص نرسله إلى بريدك الإلكتروني.",
  "privacy.signedLink": "فُتحت الصفحة من رابطك",
  "privacy.recordFor": "طلب التقديم لـ",
  "privacy.linkMask": "يتعلق هذا الرابط بسجل {email}.",
  "privacy.linkExpires": "ويتوقف عن العمل في {date}.",
  "privacy.chooseKind": "ماذا تريد أن نفعل؟",
  "privacy.kind.access": "أرسلوا لي نسخة",
  "privacy.kind.accessHint": "قائمة بما نحتفظ به، تُرسل إلى بريدك.",
  "privacy.kind.erasure": "احذفوا بياناتي",
  "privacy.kind.erasureHint": "يُزال اسمك وبياناتك من السجل.",
  "privacy.erasureWarning":
    "لا يمكن التراجع عن هذا بعد تنفيذه. سيحتفظ طلبك بمرحلته ودرجته، لكنه لن يحمل اسمك.",
  "privacy.noteLabel": "هل هناك ما ينبغي أن نعرفه؟ (اختياري)",
  "privacy.file": "إرسال الطلب",
  "privacy.filing": "جارٍ الإرسال…",
  "privacy.askLinkBody":
    "تُفتح الطلبات من رابط نرسله إلى البريد الإلكتروني الموجود في طلبك. يعمل سبعة أيام ويتعلق بطلب واحد فقط.",
  "privacy.emailLabel": "البريد الإلكتروني الذي قدّمت به",
  "privacy.sendLink": "أرسلوا لي رابطاً خاصاً",
  "privacy.sending": "جارٍ الإرسال…",
  "privacy.linkQuiet":
    "نجيب بالطريقة نفسها سواء كان هذا البريد مسجلاً أم لا، ويُرسل الرابط إلى البريد المحفوظ لدينا فقط. إن لم يصل شيء، تحقق من الإملاء ومن مجلد الرسائل غير المرغوب فيها.",
  "privacy.unreachable": "لم نتمكن من الوصول إلى البوابة الآن. حاول بعد قليل.",
  "privacy.keepTitle": "ما نحتفظ به، وإلى متى",
  "privacy.keepBody":
    "نحتفظ بطلبك وبما أرفقته به لمدة {months} شهراً بعد آخر نشاط عليه. وإن وافقت على أن ننظر في ترشيحك لأدوار أخرى، نحتفظ ببياناتك لمدة {poolMonths} شهراً من تلك الموافقة. ننبهك قبل {warningDays} يوماً من أي حذف، ويمكنك طلب الحذف قبل ذلك في أي وقت.",
  "privacy.noticeVersion": "إصدار الإشعار {version}.",
  "privacy.erasureTitle": "ماذا يعني الحذف",
  "privacy.erasureBody":
    "الحذف يزيل اسمك وبيانات التواصل وسيرتك الذاتية وإجاباتك وملاحظاتك، ويحذف الملفات التي أرفقتها. يبقى سجل استلام الطلب وتقييمه دون هويتك، لأن المجموعة تحتفظ بتاريخها الوظيفي. ومن جرى تعيينه يبقى سجله لهذا السبب.",
  "privacy.decideTitle": "من يقرر",
  "privacy.decideBody":
    "يتحقق مسؤول التوظيف من أن الطلب صادر من صاحب السجل، ويعتمد المالك ما يحدث بعده. سنراسلك بالبريد قبل حذف أي شيء. وإن كنت قد عُيّنت، فلا تحذف هذه الصفحة سجل التوظيف.",
  "offer.back": "العودة إلى الوظائف",
  "offer.eyebrow": "عرض العمل",
  "offer.title": "عرض العمل الخاص بك",
  "offer.intro":
    "هذه الصفحة خاصة بعرض العمل الذي أرسلناه إلى بريدك الإلكتروني. يمكنك قبوله أو رفضه من هنا حتى الموعد المبيّن أدناه.",
  "offer.for": "عرض العمل لـ",
  "offer.deadline": "يُرجى الرد قبل {date}.",
  "offer.accept": "أقبل عرض العمل",
  "offer.decline": "أرفض عرض العمل",
  "offer.sending": "جارٍ تسجيل ردك…",
  "offer.answered": "تم الرد على هذا العرض بالفعل.",
  "offer.accepted":
    "لقد قبلت هذا العرض. سيتواصل معك مسؤول التوظيف لتأكيد الخطوات التالية.",
  "offer.declined": "لقد رفضت هذا العرض. سيتواصل معك مسؤول التوظيف.",
  "offer.withdrawn": "سُحب هذا العرض. تواصل مع مسؤول التوظيف الذي أرسله إن كانت لديك أسئلة.",
  "offer.expired":
    "انتهت المهلة المحددة لهذا العرض. تواصل مع مسؤول التوظيف الذي أرسله إن كنت لا تزال ترغب في أن ننظر في ترشيحك.",
  "offer.unreachable": "لم نتمكن من الوصول إلى البوابة الآن. حاول بعد قليل.",
  "offer.noToken": "تُفتح هذه الصفحة من الرابط الذي أرسلناه إلى بريدك الإلكتروني عن عرض العمل.",

  // ---- The person-profile spine. The `ar` dictionary deliberately carries no
  // wording for the four Tier-3 groups (health, family details, dependants,
  // emergency contacts): a human reviewer supplies those labels, and Settings →
  // Languages shows each gap as an empty field rather than an English fallback.
  "candidates.person.field.legal_name": "الاسم القانوني",
  "candidates.person.field.preferred_name": "الاسم المفضل",
  "candidates.person.field.pronouns": "الضمائر",
  "candidates.person.field.gender": "الجنس (كما كتبه الشخص)",
  "candidates.person.field.date_of_birth": "تاريخ الميلاد",
  "candidates.person.field.birthplace": "مكان الميلاد",
  "candidates.person.field.national_id": "الرقم القومي",
  "candidates.person.field.nationality": "الجنسية",
  "candidates.person.field.phone": "الهاتف",
  "candidates.person.field.mailing_address": "عنوان المراسلة",
  "candidates.person.field.current_city": "المدينة الحالية",
  "candidates.person.field.photo_path": "الصورة",
  "candidates.person.field.photo_mime": "صيغة الصورة",
  "candidates.person.field.employment": "الخبرة العملية",
  "candidates.person.field.education": "التعليم",
  "candidates.person.field.languages": "اللغات",
  "candidates.person.field.skills": "المهارات",
  "candidates.person.field.certifications": "الشهادات",
  "candidates.person.field.marital_status": "الحالة الاجتماعية",
  "candidates.person.field.children_count": "عدد الأطفال",
  "candidates.person.field.household_size": "عدد أفراد الأسرة",
  "candidates.person.field.housing_tenure": "نوع السكن",
  "candidates.person.field.commute_mode": "وسيلة التنقل",
  "candidates.person.field.commute_minutes": "مدة التنقل (بالدقائق)",
  "candidates.person.field.relocation_willingness": "الاستعداد للانتقال",
  "candidates.person.field.travel_restrictions": "قيود السفر",

  "candidates.person.tab.history": "السجل",
  "candidates.person.tab.skills": "المهارات",
  "candidates.person.tab.background": "الخلفية",
  "candidates.person.tab.health": "الصحة",
  "candidates.person.tab.family": "الأسرة",
  "candidates.person.tab.changes": "التغييرات",

  "candidates.person.section.career": "مؤشرات المسار المهني",
  "candidates.person.section.work": "الخبرة العملية",
  "candidates.person.section.education": "التعليم",
  "candidates.person.section.languages": "اللغات",
  "candidates.person.section.skills": "المهارات المعلنة",
  "candidates.person.section.certifications": "الشهادات",
  "candidates.person.section.identity": "الهوية",
  "candidates.person.section.contact": "التواصل والموقع",
  "candidates.person.section.marital": "الحالة الاجتماعية والأطفال",
  "candidates.person.section.housing": "السكن والتنقل",
  "candidates.person.section.changes": "التغييرات على هذا الشخص",

  "candidates.person.notice.identity.title": "هويتك الأساسية",
  "candidates.person.notice.contact.title": "كيف نتواصل معك",
  "candidates.person.notice.work_history.title": "وظائفك وخبرتك",
  "candidates.person.notice.education.title": "تعليمك",
  "candidates.person.notice.languages.title": "اللغات التي تتحدثها",
  "candidates.person.notice.skills.title": "مهاراتك وشهاداتك",
  "candidates.person.notice.photo.title": "صورتك",
  "candidates.person.notice.marital_status.title": "الحالة الاجتماعية وعدد الأطفال",
  "candidates.person.notice.housing.title": "السكن والتنقل",
  "candidates.person.notice.extraction.title": "تحويل سيرتك الذاتية إلى حقائق منظمة",

  "candidates.person.consent.title": "ما وافق عليه المرشح",
  "candidates.person.consent.blurb":
    "سطر واحد لكل إجابة، والأحدث هو المعتمد. لا يُعدَّل شيء: تغيّر الرأي يُسجَّل في سطر لاحق، وأي حقل لا تحده موافقة سارية يُرفض بدل حفظه. سجّل هنا ما قاله المرشح — هذا المكتب لا يقرره عنه.",
  "candidates.person.consent.notAsked": "لم يُسأل بعد",
  "candidates.person.consent.agreed": "موافق",
  "candidates.person.consent.olderNotice": "وافق على إشعار أقدم — سجّله مرة أخرى",
  "candidates.person.consent.declined": "رافض",
  "candidates.person.consent.recordAgreement": "سجّل الموافقة",
  "candidates.person.consent.recordRefusal": "سجّل الرفض",
  "candidates.person.consent.wording": "الصيغة التي سُئل عنها",

  "candidates.person.extract.title": "حوّل السيرة الذاتية إلى الملف الشخصي",
  "candidates.person.extract.blurb":
    "يقرأ السيرة المحفوظة ويستخرج الوظائف المؤرخة والتعليم واللغات والمهارات والشهادات. لا يُكتب شيء حتى تقرأ المعاينة وتؤكدها، والقيمة التي يجدها تملأ حقلاً فارغاً فقط — ولا تستبدل ما كتبه إنسان.",
  "candidates.person.extract.noConsent":
    "لا توجد موافقة سارية على إشعار تحويل السيرة الذاتية، لذا هذا الباب مغلق. سجّل إجابته في قائمة الموافقات أعلاه أولاً.",
  "candidates.person.extract.preview": "عاين ما تقوله السيرة الذاتية",
  "candidates.person.extract.reading": "جارٍ قراءة السيرة الذاتية…",
  "candidates.person.extract.previewHeading": "معاينة · لم يُحفظ شيء بعد",
  "candidates.person.extract.write": "اكتبها في الملف الشخصي",
  "candidates.person.extract.discard": "تجاهل المعاينة",
  "candidates.person.extract.dropped":
    "أعاد النموذج {fields} — خارج القائمة التشغيلية التي يجوز لهذا الاستخراج كتابتها، فأُسقطت وسُمّيت هنا بدل حفظها.",
  "candidates.person.extract.written": "كُتبت {count} أقسام في الملف الشخصي.",

  "candidates.indicators.total": "إجمالي الخبرة",
  "candidates.indicators.roles": "{count} وظائف مؤرخة",
  "candidates.indicators.longest": "أطول وظيفة",
  "candidates.indicators.shortest": "الأقصر {value}",
  "candidates.indicators.gaps": "الفجوات بين الوظائف",
  "candidates.indicators.longestGap": "الأطول {value}",
  "candidates.indicators.noGap": "وظيفة واحدة، فلا فجوة تُقاس",
  "candidates.indicators.churn": "الوظائف لكل خمس سنوات",
  "candidates.indicators.churnNote": "عدد على المدى المؤرخ، لا حكم",
  "candidates.indicators.coverage":
    "{withMonths} من {rows} وظائف تذكر شهر بداية، لذا تُحتسب البقية بسنوات كاملة. {withEnd} تذكر نهاية — ونهاية الوظيفة الجارية هي «الآن». لا رقم هنا درجة، ولا شيء منها يغذي الفحص الآلي أعلاه.",
  "candidates.indicators.empty":
    "لا توجد وظائف مؤرخة في الملف، فلا شيء يُحتسب. تعديل يدوي أو تحويل السيرة الذاتية يملأ هذا — ولا تطبع هذه الصفحة صفر خبرة كرقم.",

  "candidates.person.card.title": "من هم",
  "candidates.person.card.metaPerson": "الشخص خلف كل طلب",
  "candidates.person.card.metaRecord": "ما يعرفه سجل الطلب هذا",
  "candidates.person.card.born": "الميلاد",
  "candidates.person.card.basedIn": "مقر الإقامة",
  "candidates.person.card.trackingCodes": "أكواد التتبع",
  "candidates.person.card.cameThrough": "عبر",
  "candidates.person.card.firstSeen": "أول ظهور",
  "candidates.person.card.lastActivity": "آخر نشاط",
  "candidates.person.card.records": "السجلات",
  "candidates.person.label.email": "البريد الإلكتروني",
  "candidates.person.label.notOnFile": "غير موجود في الملف",
  "candidates.person.label.notStated": "غير مذكور",
  "candidates.person.label.noneOnFile": "لا شيء في الملف",

  "candidates.person.changes.blurb":
    "كل كتابة على هذا الشخص، والباب الذي جاءت منه. لا يظهر سطر عن مجموعة من المستوى الثالث إلا إذا كان حسابك يحمل تصريح تلك المجموعة.",
  "candidates.person.changes.empty": "لم يُسجَّل أي تغيير على محور الشخص بعد.",

  "candidates.person.save.nothingChanged": "لم يتغير شيء في هذا القسم.",
  "candidates.person.save.saved": "حُفظت {count} حقول.",
  "candidates.person.save.nothingWritten": "لم يُكتب شيء.",
  "candidates.person.save.onlyChanged":
    "تُكتب الحقول التي غيّرتها فقط، ولكل منها سطر سجل خاص.",
  "candidates.person.save.button": "احفظ {count} تغييرات",
  "candidates.person.save.readOnly":
    "هذا الحساب يستطيع قراءة الملف الشخصي لكن لا يستطيع تعديله. التعديل يحتاج تصريح تعديل المرشحين.",
  "candidates.person.save.conflict":
    "{label}: أُبقي على القيمة التي كتبها باب أعلى. الوارد {value} لا يتجاوزها.",

  "candidates.person.drawer.button": "سجّل مرشحاً",
  "candidates.person.drawer.eyebrow": "قاعدة المواهب",
  "candidates.person.drawer.title": "سجّل مرشحاً يدوياً",
  "candidates.person.drawer.subtitle":
    "لمن لم يتقدم عبر موقع الوظائف. أضف سيرته الذاتية وصورته الآن.",
  "candidates.person.drawer.filed":
    "حُفظ في «جديد» — السيرة الذاتية مرفقة وتُقرأ قبل الفحص.",
  "candidates.person.drawer.submit": "سجّل المرشح",
  "candidates.person.drawer.submitAnother": "سجّل آخر",
  "candidates.person.drawer.note":
    "لا يُرسل شيء إلى المرشح. لم يتقدم، فالرسالة التأكيدية ستكون خطأ.",
  "candidates.person.drawer.job": "الوظيفة",
  "candidates.person.drawer.loading": "جارٍ تحميل الوظائف…",
  "candidates.person.drawer.selectOpening": "اختر وظيفة…",
  "candidates.person.drawer.name": "الاسم الكامل",
  "candidates.person.drawer.source": "المصدر",
  "candidates.person.drawer.cv": "ملف السيرة الذاتية",
  "candidates.person.drawer.photo": "الصورة الشخصية",
  "candidates.person.drawer.personDetails": "بيانات الشخص (اختياري)",
  "candidates.person.drawer.groupIdentity": "الهوية",
  "candidates.person.drawer.groupContact": "التواصل",
  "candidates.person.drawer.groupMarital": "الحالة الاجتماعية والأسرة",
  "candidates.person.drawer.groupHousing": "السكن والتنقل",

  "enum.hospitality": "الضيافة",
  "enum.real_estate": "العقارات",
  "enum.commercial_development": "التطوير التجاري",
  "enum.corporate": "الإدارة المركزية",
  "enum.full_time": "دوام كامل",
  "enum.part_time": "دوام جزئي",
  "enum.contract": "عقد",
  "enum.internship": "تدريب",
  "enum.remote": "عن بُعد",
  "enum.hybrid": "هجين",
  "enum.junior": "مبتدئ",
  "enum.mid": "متوسط",
  "enum.senior": "خبير",
  "enum.lead": "قيادي",
};

const ru: Dictionary = {
  "nav.dashboard": "Панель",
  "nav.assessments": "Оценки",
  "nav.candidates": "Кандидаты",
  "nav.jobs": "Вакансии",
  "nav.onboarding": "Адаптация",
  "nav.portal": "Портал кандидата",
  "nav.signOut": "Выйти",
  "common.loading": "Загрузка…",
  "common.error": "Произошла ошибка",
  "common.retry": "Повторить",
  "common.submit": "Отправить",
  "common.save": "Сохранить",
  "common.cancel": "Отмена",
  "common.next": "Далее",
  "common.previous": "Назад",
  "common.close": "Закрыть",
  "jobs.apply": "Подать заявку",
  "jobs.openings": "Открытые вакансии",
  "assessment.title": "Оценка навыков",
  "assessment.timer": "Оставшееся время",
  "assessment.draftSaved": "Черновик сохранён",
  "assessment.video.record": "Начать запись",
  "assessment.video.stop": "Остановить и проверить",
  "assessment.video.rerecord": "Перезаписать",
  "assessment.submit": "Отправить оценку",
  "portal.title": "Отслеживание заявки",
  "portal.code": "Код отслеживания",
  "portal.search": "Поиск",
  "portal.eyebrow": "Портал кандидата",
  "portal.intro":
    "Введите код отслеживания, полученный при подаче заявки, чтобы увидеть текущий этап, оценку и следующие шаги.",
  "portal.codeHint": "Формат:",
  "portal.track": "Отследить",
  "portal.searching": "Поиск…",
  "portal.lookupFailed": "Что-то пошло не так. Попробуйте снова.",
  "portal.hello": "Здравствуйте, {name}",
  "portal.positionUnderReview": "Должность на рассмотрении",
  "portal.matchScore": "Балл соответствия",
  "portal.assessmentScore": "Балл оценки",
  "portal.notSelected": "Не выбрано",
  "portal.actionNeeded": "Нужно действие",
  "portal.inProgress": "В процессе",
  "portal.applied": "заявка {when}",
  "portal.startAssessment": "Начать оценку",
  "portal.resumeAssessment": "Продолжить оценку",
  "portal.progress": "Прогресс заявки: {stage}",
  "portal.messages": "Сообщения от команды найма",
  "portal.newCount": "Новых: {count}",
  "portal.markAllRead": "Прочитать все",
  "portal.marking": "Отмечаем…",
  "portal.noSubject": "Обновление по вашей заявке",
  "portal.badgeNew": "Новое",
  "portal.needHelp": "Нужна помощь?",
  "portal.helpText":
    "Если ссылка истекла или вы не нашли код отслеживания, напишите команде по подбору — они всё найдут.",
  "portal.language": "Язык",
  "portal.next.rejected":
    "Спасибо за заявку. После тщательного рассмотрения мы не можем продолжить её по этой вакансии. Ценим ваше время и желаем успехов в поиске.",
  "portal.next.hired": "Поздравляем — команда персонала свяжется с вами по офферу.",
  "portal.next.interview": "Собеседование планируется. Мы подтвердим время и ссылку подключения.",
  "portal.next.submitted": "Ваша оценка отправлена и находится у команды найма.",
  "portal.next.inProgress": "Оценка выполняется — осталось {time}.",
  "portal.next.closedWindow": "Срок выполнения оценки истёк.",
  "portal.next.invited": "Вам предложено пройти оценку. Откройте безопасную ссылку ниже.",
  "portal.next.screening": "Ваша заявка у команды скрининга.",
  "stage.new": "Заявка",
  "stage.ai_screening": "ИИ-скрининг",
  "stage.assessment": "Оценка",
  "stage.interview": "Собеседование",
  "stage.offer": "Оффер",
  "stage.hired": "Найм",
  "time.today": "сегодня",
  "time.daysAgo": "{count} дн. назад",
  "time.monthsAgo": "{count} мес. назад",
  "login.title": "Вход",
  "login.email": "Эл. почта",
  "login.password": "Пароль",
  "login.action": "Войти",

  "chrome.careers": "Вакансии",
  "chrome.track": "Отследить заявку",
  "chrome.trackCta": "Отследить заявку",
  "chrome.explore": "Подробнее",
  "chrome.language": "Язык",
  "chrome.languageAuto": "Авто",
  "chrome.theme": "Тема",
  "chrome.careersFooter":
    "Заявки рассматривает наша команда персонала. Сохраните код отслеживания — только по нему можно следить за заявкой.",

  "home.badge": "Платформа подбора на основе ИИ",
  "home.titleA": "Аналитика талантов",
  "home.titleB": "без задержек и бюрократии",
  "home.lede":
    "Многоуровневый подбор для группы Sharm Dreams: скрининг резюме со снижением предвзятости, интерактивные оценки, планирование собеседований с автоматическими уведомлениями и аналитика найма в реальном времени.",
  "home.cap1Eyebrow": "Открытые вакансии",
  "home.cap1Title": "Найм во всей группе компаний",
  "home.cap1Copy":
    "Каждая опубликованная вакансия — курортные операции, недвижимость и корпоративные услуги — с указанием вилки зарплаты и заявкой на несколько минут.",
  "home.cap2Eyebrow": "Оценки",
  "home.cap2Title": "Тесты оцениваются по тому, что вы сделали",
  "home.cap2Copy":
    "Кандидат по приглашению проходит оценку в браузере: финансовые модели с NPV и IRR, видео-презентации, кейсы и тесты — балл ставится по присланной работе.",
  "home.cap3Eyebrow": "Опыт кандидата",
  "home.cap3Title": "Портал, которому доверяют кандидаты",
  "home.cap3Copy":
    "Следите за статусом заявки, результатами оценки и следующими шагами с любого устройства и в любое время.",
  "home.serving": "Мы служим группе",
  "home.footerTag": "Корпоративная HRMS, ATS и платформа оценки",

  "careers.hiring": "Мы нанимаем",
  "careers.timeline": "Хронология",
  "careers.undated": "Без даты",
  "careers.benefits": "Что группа предлагает людям",
  "careers.alsoGroup": "Тоже часть группы",
  "careers.alsoGroupNote":
    "У этих компаний сейчас нет открытых вакансий — список выше это всё, куда группа набирает сегодня.",
  "careers.applied": "Уже отправляли заявку?",
  "careers.appliedNote":
    "Введите код отслеживания, полученный при подаче заявки, чтобы увидеть текущий этап, будущие собеседования и следующие шаги.",
  "careers.trackMine": "Отследить мою заявку",
  "careers.allRoles": "Все открытые вакансии",
  "careers.aboutRole": "Об этой вакансии",
  "careers.looking": "Кого мы ищем",
  "careers.howWorks": "Как устроен найм",
  "careers.step1": "Отправьте резюме — код отслеживания придёт сразу.",
  "careers.step2": "Наш ИИ-скрининг сверяет резюме с требованиями вакансии.",
  "careers.step3":
    "Если вы подходим, мы открываем оценку — начать можно на портале по вашему коду.",
  "careers.step4": "Рекрутер назначает собеседование и подтверждает время и ссылку.",
  "careers.otherRoles": "Другие вакансии в {name}",
  "careers.otherRolesUs": "Другие вакансии у нас",
  "careers.aboutCompany": "О компании {name}",
  "careers.theirStory": "История компании",
  "careers.online": "{name} в интернете",
  "chat.openRole": "Спросить об этой вакансии",
  "chat.openBoard": "Спросить о наших вакансиях",
  "chat.title": "Помощник по найму",
  "chat.aiBadge": "ИИ",
  "chat.note":
    "Отвечает только тем, что опубликовано на этих страницах. Переписка — не заявка.",
  "chat.greetingRole":
    "Здравствуйте — я могу рассказать о том, что на этой странице написано про {role}. Что вы хотите узнать?",
  "chat.greetingBoard":
    "Здравствуйте — я могу рассказать о том, что написано на наших страницах о найме. Что вы хотите узнать?",
  "chat.placeholder": "Спросите о зарплате, местоположении, обязанностях…",
  "chat.send": "Отправить",
  "chat.thinking": "Читаю страницу…",
  "chat.failed": "Ответ не пришёл. Попробуйте через минуту.",
  "chat.lead": "Оставить контакты",
  "chat.leadCancel": "Не сейчас",
  "chat.leadTitle": "Оставьте ваши контакты",
  "chat.leadNote":
    "Рекрутер прочитает это вместе с перепиской. Это не заявка — чтобы её рассмотрели, отправьте резюме через форму.",
  "chat.leadName": "Полное имя",
  "chat.leadEmail": "Эл. почта",
  "chat.leadPhone": "Телефон",
  "chat.leadSave": "Отправить рекрутеру",
  "chat.leadSaving": "Отправляем…",
  "chat.leadSaved":
    "Сохранено вместе с перепиской — рекрутер сможет её прочитать. Заявкой это пока не является.",
  "chat.leadFailed": "Не удалось сохранить. Попробуйте через минуту.",
  "chat.askSalary": "Какая зарплата?",
  "chat.askDuties": "Чем предстоит заниматься?",
  "chat.askLooking": "Кого вы ищете?",
  "chat.askLocation": "Где находится работа?",
  "chat.askBenefits": "Что группа предлагает людям?",
  "chat.askOther": "Есть ли у вас другие вакансии?",
  "chat.askRoles": "Какие вакансии открыты сейчас?",
  "chat.askProcess": "Как устроен найм?",

  "glance.founded": "Основана",
  "glance.ownership": "Форма собственности",
  "glance.people": "Сотрудников",
  "glance.headquarters": "Штаб-квартира",
  "glance.sector": "Сектор",
  "facet.department": "Отдел",
  "facet.location": "Локация",
  "facet.jobType": "Тип занятости",
  "facet.sector": "Сектор",
  "board.searchAria": "Поиск и фильтры открытых вакансий",
  "board.searchPlaceholder": "Вакансия, команда, город или компания",
  "board.clearSearch": "Очистить строку поиска",
  "board.clearFilters": "Сбросить фильтры",
  "board.filters": "Фильтры",
  "board.hideFilters": "Скрыть фильтры",
  "board.companies": "Компании",
  "board.tabAll": "Все компании",
  "board.tabUnlisted": "Без компании",
  "board.showingAll": "Открытых вакансий: {shown}",
  "board.showingFiltered": "{shown} из {total} открытых вакансий",
  "board.showingCompanyOne": "В {company}: {shown} открытая вакансия",
  "board.showingCompanyMany": "В {company}: {shown} открытых вакансий",
  "board.emptyMatchBody":
    "Ни одна из {count} открытых вакансий не подходит под выбранные слова и фильтры. Сбросьте их, чтобы увидеть весь список.",
  "board.emptyTitle": "Сейчас открытых вакансий нет",
  "board.emptyBody":
    "Загляните позже — новые вакансии публикуются здесь сразу после утверждения.",
  "board.emptyMatchTitle": "Ничего не найдено по этому запросу",
  "board.companiesAria": "Компании с открытыми вакансиями",
  "board.openRole": "{count} открытая вакансия",
  "board.openRoles": "{count} открытых вакансий",
  "board.searchLabel": "Поиск открытых вакансий",
  "careers.viewApply": "Смотреть и откликнуться",
  "enum.hospitality": "Гостеприимство",
  "enum.real_estate": "Недвижимость",
  "enum.commercial_development": "Коммерческая застройка",
  "enum.corporate": "Корпоративный блок",
  "enum.full_time": "Полная занятость",
  "enum.part_time": "Частичная занятость",
  "enum.contract": "Контракт",
  "enum.internship": "Стажировка",
  "enum.remote": "Удалённо",
  "enum.hybrid": "Гибрид",
  "enum.junior": "Младший",
  "enum.mid": "Средний",
  "enum.senior": "Старший",
  "enum.lead": "Ведущий",
};

const de: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.assessments": "Assessments",
  "nav.candidates": "Kandidaten",
  "nav.jobs": "Stellen",
  "nav.onboarding": "Onboarding",
  "nav.portal": "Kandidaten-Portal",
  "nav.signOut": "Abmelden",
  "common.loading": "Lädt…",
  "common.error": "Etwas ist schiefgelaufen",
  "common.retry": "Erneut versuchen",
  "common.submit": "Absenden",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.next": "Weiter",
  "common.previous": "Zurück",
  "common.close": "Schließen",
  "jobs.apply": "Jetzt bewerben",
  "jobs.openings": "Offene Stellen",
  "assessment.title": "Kompetenzbewertung",
  "assessment.timer": "Verbleibende Zeit",
  "assessment.draftSaved": "Entwurf gespeichert",
  "assessment.video.record": "Aufnahme starten",
  "assessment.video.stop": "Stoppen & Prüfen",
  "assessment.video.rerecord": "Neu aufnehmen",
  "assessment.submit": "Bewertung absenden",
  "portal.title": "Bewerbung verfolgen",
  "portal.code": "Tracking-Code",
  "portal.search": "Suchen",
  "portal.eyebrow": "Bewerberportal",
  "portal.intro":
    "Geben Sie den Tracking-Code ein, den Sie bei der Bewerbung erhalten haben, um Stadium, Test und nächste Schritte zu sehen.",
  "portal.codeHint": "Beispiel:",
  "portal.track": "Verfolgen",
  "portal.searching": "Sucht…",
  "portal.lookupFailed": "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  "portal.hello": "Hallo, {name}",
  "portal.positionUnderReview": "Stelle in Prüfung",
  "portal.matchScore": "Match-Score",
  "portal.assessmentScore": "Test-Score",
  "portal.notSelected": "Keine Auswahl",
  "portal.actionNeeded": "Aktion nötig",
  "portal.inProgress": "In Bearbeitung",
  "portal.applied": "Bewerbung {when}",
  "portal.startAssessment": "Test starten",
  "portal.resumeAssessment": "Test fortsetzen",
  "portal.progress": "Bewerbungsfortschritt: {stage}",
  "portal.messages": "Nachrichten des Hiring-Teams",
  "portal.newCount": "{count} neu",
  "portal.markAllRead": "Alle als gelesen",
  "portal.marking": "Wird markiert…",
  "portal.noSubject": "Neuigkeiten zu Ihrer Bewerbung",
  "portal.badgeNew": "Neu",
  "portal.needHelp": "Brauchen Sie Hilfe?",
  "portal.helpText":
    "Wenn Ihr Link abgelaufen ist oder Sie Ihren Tracking-Code nicht finden, schreiben Sie dem Talent-Team – es sucht ihn für Sie heraus.",
  "portal.language": "Sprache",
  "portal.next.rejected":
    "Vielen Dank für Ihre Bewerbung. Nach sorgfältiger Prüfung können wir sie für diese Rolle nicht weiterverfolgen. Wir schätzen Ihre Zeit und wünschen viel Erfolg.",
  "portal.next.hired": "Herzlichen Glückwunsch – unser People-Team meldet sich wegen Ihres Angebots.",
  "portal.next.interview":
    "Ihr Interview wird geplant. Wir bestätigen Ihnen Zeit und Link zum Beitritt.",
  "portal.next.submitted": "Ihr Test wurde eingereicht und liegt beim Hiring-Team.",
  "portal.next.inProgress": "Test läuft – noch {time}.",
  "portal.next.closedWindow": "Ihr Testzeitraum ist abgelaufen.",
  "portal.next.invited":
    "Sie sind zu einem Test eingeladen. Öffnen Sie den sicheren Link unten.",
  "portal.next.screening": "Ihre Bewerbung liegt beim Screening-Team.",
  "stage.new": "Bewerbung",
  "stage.ai_screening": "KI-Screening",
  "stage.assessment": "Test",
  "stage.interview": "Interview",
  "stage.offer": "Angebot",
  "stage.hired": "Einstellung",
  "time.today": "heute",
  "time.daysAgo": "vor {count} Tagen",
  "time.monthsAgo": "vor {count} Monaten",
  "login.title": "Anmelden",
  "login.email": "E-Mail",
  "login.password": "Passwort",
  "login.action": "Anmelden",

  "chrome.careers": "Stellenangebote",
  "chrome.track": "Bewerbung verfolgen",
  "chrome.trackCta": "Bewerbung verfolgen",
  "chrome.explore": "Ansehen",
  "chrome.language": "Sprache",
  "chrome.languageAuto": "Automatisch",
  "chrome.theme": "Design",
  "chrome.careersFooter":
    "Bewerbungen prüft unser People-Team. Bewahren Sie Ihren Tracking-Code auf – nur damit lässt sich Ihre Bewerbung verfolgen.",

  "home.badge": "KI-gestützte Recruiting-Plattform",
  "home.titleA": "Talent-Intelligenz",
  "home.titleB": "ohne Flaschenhälse",
  "home.lede":
    "Mandantenfähiges Recruiting für die Sharm Dreams Group – vorurteilsreduzierte CV-Screening, interaktive Test-Suiten, Interview-Planung mit automatischen Bewerberbenachrichtigungen und Echtzeit-Hiring-Analytics.",
  "home.cap1Eyebrow": "Offene Stellen",
  "home.cap1Title": "Wir stellen gruppenweit ein",
  "home.cap1Copy":
    "Jede veröffentlichte Stelle – Resort-Betrieb, Immobilien und Corporate Services – mit angegebenem Gehaltsrahmen und einer Bewerbung, die wenige Minuten dauert.",
  "home.cap2Eyebrow": "Assessments",
  "home.cap2Title": "Tests, bewertet nach dem was Sie getan haben",
  "home.cap2Copy":
    "Eingeladene Kandidaten führen ihren Test im Browser aus: Finanzmodelle mit NPV und IRR, Videopräsentationen, Fallstudien und Quizze – bewertet wird die abgegebene Arbeit.",
  "home.cap3Eyebrow": "Bewerbererlebnis",
  "home.cap3Title": "Ein Portal, dem Bewerber vertrauen",
  "home.cap3Copy":
    "Status der Bewerbung, Testergebnisse und nächste Schritte – auf jedem Gerät, jederzeit.",
  "home.serving": "Im Dienst der Gruppe",
  "home.footerTag": "Unternehmens-HRMS, ATS & Assessments-Plattform",

  "careers.hiring": "Wir stellen ein",
  "careers.timeline": "Der Zeitverlauf",
  "careers.undated": "Ohne Datum",
  "careers.benefits": "Was die Gruppe ihren Mitarbeitenden bietet",
  "careers.alsoGroup": "Gehört ebenfalls zur Gruppe",
  "careers.alsoGroupNote":
    "Diese Unternehmen haben aktuell keine offenen Stellen – die Liste oben ist alles, wofür die Gruppe heute einstellt.",
  "careers.applied": "Schon beworben?",
  "careers.appliedNote":
    "Geben Sie den Tracking-Code ein, den Sie bei der Bewerbung erhalten haben, um Stadium, geplante Interviews und nächste Schritte zu sehen.",
  "careers.trackMine": "Meine Bewerbung verfolgen",
  "careers.allRoles": "Alle offenen Stellen",
  "careers.aboutRole": "Über diese Stelle",
  "careers.looking": "Was wir suchen",
  "careers.howWorks": "So läuft das Recruiting",
  "careers.step1": "Bewerben Sie sich mit Ihrem CV – den Tracking-Code erhalten Sie sofort.",
  "careers.step2": "Unser KI-Screening liest Ihren CV gegen die Anforderungen der Stelle.",
  "careers.step3":
    "Wenn es passt, öffnen wir einen Test – Sie starten ihn im Portal mit Ihrem Code.",
  "careers.step4":
    "Ihre Recruiterin plant das Interview und bestätigt Ihnen Zeit und Zugangslink.",
  "careers.otherRoles": "Weitere Stellen bei {name}",
  "careers.otherRolesUs": "Weitere Stellen bei uns",
  "careers.aboutCompany": "Über {name}",
  "careers.theirStory": "Ihre Geschichte",
  "careers.online": "{name} im Netz",
  "chat.openRole": "Fragen zu dieser Stelle",
  "chat.openBoard": "Fragen zu unseren Stellen",
  "chat.title": "Karriere-Assistent",
  "chat.aiBadge": "KI",
  "chat.note":
    "Antwortet nur mit dem, was diese Seiten veröffentlichen. Ein Chat ist keine Bewerbung.",
  "chat.greetingRole":
    "Hallo — ich kann sagen, was diese Seite über {role} nennt. Was möchten Sie wissen?",
  "chat.greetingBoard":
    "Hallo — ich kann sagen, was unsere Karriereseiten über offene Stellen nennen. Was möchten Sie wissen?",
  "chat.placeholder": "Fragen Sie nach Gehalt, Ort, Aufgaben…",
  "chat.send": "Senden",
  "chat.thinking": "Ich lese die Seite…",
  "chat.failed": "Keine Antwort zurückgekommen. Versuchen Sie es gleich erneut.",
  "chat.lead": "Meine Kontaktdaten hinterlassen",
  "chat.leadCancel": "Nicht jetzt",
  "chat.leadTitle": "Hinterlassen Sie Ihre Kontaktdaten",
  "chat.leadNote":
    "Eine Recruiterin liest das zusammen mit dem Gespräch. Das ist keine Bewerbung — reichen Sie Ihren Lebenslauf über das Formular ein, damit wir Sie berücksichtigen.",
  "chat.leadName": "Vollständiger Name",
  "chat.leadEmail": "E-Mail",
  "chat.leadPhone": "Telefon",
  "chat.leadSave": "An eine Recruiterin senden",
  "chat.leadSaving": "Wird gesendet…",
  "chat.leadSaved":
    "Mit dem Gespräch gespeichert — eine Recruiterin kann es lesen. Eine Bewerbung ist es noch nicht.",
  "chat.leadFailed": "Das konnte nicht gespeichert werden. Versuchen Sie es gleich erneut.",
  "chat.askSalary": "Wie hoch ist das Gehalt?",
  "chat.askDuties": "Was wären meine Aufgaben?",
  "chat.askLooking": "Wen suchen Sie?",
  "chat.askLocation": "Wo ist die Stelle?",
  "chat.askBenefits": "Was bietet die Gruppe ihren Mitarbeitenden?",
  "chat.askOther": "Gibt es weitere offene Stellen?",
  "chat.askRoles": "Welche Stellen sind jetzt offen?",
  "chat.askProcess": "Wie läuft die Bewerbung hier ab?",

  "glance.founded": "Gegründet",
  "glance.ownership": "Eigentumsform",
  "glance.people": "Mitarbeitende",
  "glance.headquarters": "Hauptsitz",
  "glance.sector": "Bereich",
  "facet.department": "Abteilung",
  "facet.location": "Ort",
  "facet.jobType": "Anstellungsart",
  "facet.sector": "Bereich",
  "board.searchAria": "Offene Stellen durchsuchen und filtern",
  "board.searchPlaceholder": "Stelle, Team, Stadt oder Firma suchen",
  "board.clearSearch": "Suchtext löschen",
  "board.clearFilters": "Filter zurücksetzen",
  "board.filters": "Filter",
  "board.hideFilters": "Filter ausblenden",
  "board.companies": "Unternehmen",
  "board.tabAll": "Alle Unternehmen",
  "board.tabUnlisted": "Ohne Unternehmen",
  "board.showingAll": "{shown} offene Stellen",
  "board.showingFiltered": "{shown} von {total} offenen Stellen",
  "board.showingCompanyOne": "{shown} offene Stelle bei {company}",
  "board.showingCompanyMany": "{shown} offene Stellen bei {company}",
  "board.emptyMatchBody":
    "Keine der {count} offenen Stellen passt zu den gewählten Begriffen und Filtern. Setzen Sie sie zurück, um die ganze Liste zu sehen.",
  "board.emptyTitle": "Derzeit keine offenen Stellen",
  "board.emptyBody":
    "Schauen Sie bald wieder – neue Stellen erscheinen hier sofort nach ihrer Freigabe.",
  "board.emptyMatchTitle": "Keine Treffer für diese Suche",
  "board.companiesAria": "Unternehmen mit offenen Stellen",
  "board.openRole": "{count} offene Stelle",
  "board.openRoles": "{count} offene Stellen",
  "board.searchLabel": "Offene Stellen durchsuchen",
  "careers.viewApply": "Ansehen & bewerben",
  "enum.hospitality": "Hotellerie",
  "enum.real_estate": "Immobilien",
  "enum.commercial_development": "Gewerbeentwicklung",
  "enum.corporate": "Corporate",
  "enum.full_time": "Vollzeit",
  "enum.part_time": "Teilzeit",
  "enum.contract": "Befristet",
  "enum.internship": "Praktikum",
  "enum.remote": "Remote",
  "enum.hybrid": "Hybrid",
  "enum.junior": "Junior",
  "enum.mid": "Mid-Level",
  "enum.senior": "Senior",
  "enum.lead": "Lead",
};

const dictionaries: Record<Locale, Dictionary> = { en, ar, ru, de };

/**
 * Wording an admin wrote in Settings, on top of the dictionaries this build
 * ships.
 *
 * It lives in module state for the same reason the visitor's chosen language
 * does: `translate` is called from server components and from client components,
 * and both have to read the same words during the same render. `TranslationsSeed`
 * fills it from the `app_settings` rows before either runs, so a prerendered page
 * and its hydrated copy agree.
 *
 * Empty until a page renders that seed, which is what keeps this additive: a
 * surface nobody wired reads exactly the words it read before the console existed.
 */
export type TranslationOverrides = Partial<Record<Locale, Dictionary>>;

let overrides: TranslationOverrides = {};

export function setTranslationOverrides(next: TranslationOverrides): void {
  overrides = next;
}

/** Narrow an untrusted string (a settings row) to a locale we ship a dictionary for. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Every key the shipped English dictionary defines, in the order it defines them. */
export function translationKeys(): string[] {
  return Object.keys(dictionaries.en);
}

/**
 * The words this build ships for a key, ignoring any stored override.
 *
 * `undefined` means the language has no shipped text of its own — an Arabic row
 * nobody translated yet, which the console draws as an empty field rather than as
 * the English it falls back to on screen, so the gap stays visible.
 */
export function shippedText(locale: Locale, key: string): string | undefined {
  return dictionaries[locale]?.[key];
}

/**
 * The `{name}` placeholders a phrase substitutes.
 *
 * A translation that drops one is a sentence a candidate reads with a hole in it,
 * and nothing downstream can notice: substitution replaces what it finds and
 * leaves the rest alone. So the console compares the two lists before a save.
 */
export function placeholdersIn(text: string): string[] {
  const found: string[] = [];
  const pattern = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Does any dictionary carry this key?
 *
 * Needed where a key is built from data rather than written in the page — an
 * enum code, for instance. `translate` answers a missing key by returning the
 * key itself, which reads well for a typo a developer will fix but would print
 * `enum.some_new_code` to a candidate, so the caller checks first and falls back
 * to the word the database row already carries.
 */
export function hasKey(key: string): boolean {
  return dictionaries.en[key] !== undefined;
}

/** Arabic is the only right-to-left language here, so the check stays a set. */
const RTL_LOCALES: readonly Locale[] = ["ar"];

export function dirForLocale(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

/**
 * Look a phrase up, substituting `{name}` placeholders.
 *
 * A stored override wins over the shipped dictionary, because the whole point of
 * the console is that the words an admin typed are the words a candidate reads.
 * Below that, missing keys fall back to English so a half-translated language
 * still reads, and a key nobody defined comes back verbatim rather than blank.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const text =
    overrides[locale]?.[key] ??
    dictionaries[locale][key] ??
    overrides.en?.[key] ??
    dictionaries.en[key] ??
    key;
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
    text
  );
}
