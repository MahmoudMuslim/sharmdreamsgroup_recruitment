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
    "We store your details to process this application only. You get a tracking code on the next screen.",
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
  "apply.privacy": "نحفظ بياناتك لمعالجة هذا الطلب فقط. وستحصل على رمز تتبّع في الشاشة التالية.",
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
  "enum.hospitality": "الضيافة",
  "enum.real_estate": "العقارات",
  "enum.commercial_development": "التطوير التجاري",
  "enum.corporate": "الإدارة المركزية",
  "enum.full_time": "دوام كامل",
  "enum.part_time": "دوام جزئي",
  "enum.contract": "عقد",
  "enum.internship": "تدريب",
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
