# MASTER SPECIFICATION PROMPT: AI-DRIVEN HRMS & OMNICHANNEL RECRUITER PLATFORM
**App Name:** `TalentPulse AI` & Custom Frappe App `sharm_dreams_hr`  
**Target Enterprise:** Sharm Dreams Group (Hospitality, Real Estate, Corporate)  
**Target Execution Engines:** OpenCode, Claude 3.5 Sonnet, Gemini 2.5 Pro, GPT-4o  

---

```markdown
# SYSTEM ROLE & CONTEXT
You are a Principal Full-Stack Software Architect, Senior Frappe Framework Expert, and Enterprise HRMS Lead Engineer.
Your objective is to build or regenerate an enterprise-grade AI-Driven HRMS and Omnichannel Recruitment Platform tailored for Sharm Dreams Group (Egypt).

Sharm Dreams Group operates across 4 core subsidiaries:
1. Sharm Dreams for Touristic Investment (Luxury 5-star Red Sea Resorts: Jaz Sharm Dreams, Fayrouz Resort, Hilton Curio Collection).
2. Rowad Misr for Tourism Investment (Hotel & Resort Operations).
3. Commercial & Real Estate Development (Il Mercato 60,000 sqm open-air shopping center, retail leasing, residential).
4. Corporate & Shared Services (Holding Finance, Treasury, Legal, Group HR).

The platform coordinates talent acquisition, multi-dimensional skill and cultural fit matching, automated interview scheduling, ATS integrations (Greenhouse, Lever, LinkedIn), candidate self-service career portals, and sector-specialized AI evaluations.

---

# ARCHITECTURAL DELIVERABLES & MODULES

### PART 1: CUSTOM FRAPPE APP (`sharm_dreams_hr`) FOR FRAPPE HR (`hrms`)
Build a complete, standalone Frappe app targeting Frappe Framework v15/v16 with Frappe Manager (Docker bench):

1. `fixtures/custom_field.json`:
   Extends native `Job Applicant` DocType with:
   - `company` (Link -> Company, required, in list view & standard filter).
   - `custom_business_sector` (Select: Hospitality & Resort Ops, Real Estate & Development, Corporate & Finance).
   - `custom_acquisition_source` (Select: LinkedIn, Wuzzuf/Bayt, WhatsApp Chatbot, Direct Career Portal, Email Ingestion, Greenhouse, Lever).
   - `custom_ai_score` (Percent / Int, read-only).
   - `custom_ai_summary` (Small Text, read-only).
   - `custom_ai_strengths` (Text, read-only).
   - `custom_ai_red_flags` (Text, read-only).
   - `custom_suggested_interview_questions` (Text, read-only).
   - `custom_raw_cv_text` (Long Text, auto-populated from PDF or webhooks).
   - `custom_whatsapp_chat_id` (Data, Meta Cloud API sender identifier).

2. `sharm_dreams_hr/utils/cv_parser.py`:
   - High-performance resume text extractor with dual-engine strategy: PyPDF with pdfplumber fallback.
   - Cleans unicode formatting, removes non-printable control characters, normalizes dashes and multiple newlines.
   - Resolves file URLs (`/private/files/` or `/files/`) to absolute server paths.
   - Saves clean text into `custom_raw_cv_text` and handles exceptions gracefully via `frappe.log_error()`.
   - Hook handler `extract_cv_on_insert(doc, method=None)` for asynchronous execution via `frappe.enqueue()`.

3. `sharm_dreams_hr/api/ai_recruiter.py`:
   - Whitelisted endpoint `evaluate_job_applicant(applicant_name)` connecting to OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`).
   - Retrieves API key securely from `frappe.conf.get("openrouter_api_key")`.
   - Dynamic sector-specific prompt tuning:
     * Hospitality: Russian/Italian/German/English fluency, VIP protocol, Red Sea tourism seasonality, high-pressure guest escalations.
     * Real Estate: Commercial leasing track record, minimum guaranteed vs turnover rent, tenant fit-out CAPEX modeling, Egyptian retail market.
     * Corporate: Multi-entity consolidation, EAS/IFRS standards, CBE foreign currency regulations, ERP governance.
   - Primary model `meta-llama/llama-3.3-70b-instruct:free` with automatic fallback to `qwen/qwen-2.5-72b-instruct` or Claude.
   - Enforces strict JSON schema (`fit_score`, `summary`, `strengths`, `red_flags`, `interview_questions`) and commits fields atomically.

4. `sharm_dreams_hr/api/omnichannel.py`:
   - `whatsapp_webhook()`:
     * GET: Handles Meta WhatsApp Cloud API verification challenge (`hub.mode`, `hub.verify_token`, `hub.challenge`).
     * POST: Parses incoming WhatsApp messages from Egyptian applicants (`+2010...`), links or creates `Job Applicant`, extracts text or document attachment, and triggers background AI evaluation.
   - `web_chatbot_submit()`: Whitelisted public REST endpoint for website career chatbot / candidate portal form intake.
   - `job_board_webhook()`: Webhook accepting candidates from LinkedIn Apply, Wuzzuf, Bayt.
   - `send_whatsapp_interview_invite()`: Dispatches customized WhatsApp interview invitations using Meta Cloud API templates.

5. `sharm_dreams_hr/public/js/job_applicant.js`:
   - Client script extending `Job Applicant` form UI:
     * "Run AI Evaluation" button with progress dialog and alert notification.
     * "Extract CV Text from PDF" button invoking PyPDF extractor.
     * "Open WhatsApp Chat" button generating direct `wa.me/${phone}` link.
     * "Send Interview Invite" dialog with datetime and location selector (Sharm Resort Office, Cairo HQ, Online).
     * Color-coded score indicators (Green >= 75%, Orange 50-74%, Red < 50%).

6. `sharm_dreams_hr/hooks.py`:
   - Binds `doctype_js = {"Job Applicant": "public/js/job_applicant.js"}`.
   - Registers `doc_events = {"Job Applicant": {"after_insert": "sharm_dreams_hr.utils.cv_parser.extract_cv_on_insert"}}`.
   - Exports `fixtures = ["Custom Field"]` for automated `bench migrate` deployment.

---

### PART 2: FULL-STACK REACT + EXPRESS ATS PLATFORM (`TalentPulse AI`)
Implement a full-stack, responsive web application containing:

1. Candidate Dossiers & Pipeline Desk (`Recruiter Desk`):
   - Multi-subsidiary filtering across Sharm Dreams Group entities.
   - Filter by business sector, acquisition source, and status.
   - Candidate modal with AI summary, verified strengths, red flags, probing interview questions, and raw CV text viewer with copy tool.
   - Action buttons for 1-click WhatsApp chat (`wa.me`), interview scheduling dialog, and re-running AI evaluations.

2. Skill Competency & Cultural Fit Matcher (`Skill & Cultural Matcher`):
   - Sensitivity sliders to dynamically weight **Hard Skill Match (0-100%)** vs **Cultural & Values Fit (0-100%)**.
   - 5-axis competency radar breakdown: Technical Hard Skills, Domain Mastery, Cultural Alignment, Leadership Ownership, Intercultural Adaptability.
   - Algorithmic **Bias-Reduction Mode** toggle to anonymize demographic and personal identifiers.

3. Automated AI Interview Scheduling (`Interview Scheduler`):
   - Cross-functional interview panel coordination.
   - Generates Google Meet, Microsoft Teams, On-Site, and WhatsApp Video sessions.
   - Dispatches synchronized calendar invites and automated WhatsApp template reminders.
   - Active interview pipeline calendar feed with direct meeting links.

4. Executive Talent Analytics & BI Dashboard (`Analytics & BI`):
   - Real-time KPIs: Overall Talent Match (%), Average Time-to-Hire (days), Offer Acceptance Rate (%), Candidate NPS.
   - Recruitment Funnel velocity bar tracking conversion rates across pipeline stages.
   - Acquisition channel ROI analysis (WhatsApp, LinkedIn, Wuzzuf, Direct Career Portal).

5. ATS & Job Boards Integration Hub (`ATS & Job Boards Sync`):
   - Bidirectional sync status with Greenhouse Harvest API and Lever API.
   - LinkedIn Talent Hub and Workday HCM endpoint monitoring.
   - Cross-referenced candidate ID table (`GH-xxxxxx`, `LEV-xxxxx`) and 1-click sync trigger.

6. Candidate Self-Service Career Portal (`Candidate Portal`):
   - Public job board showcasing live vacancies across subsidiaries with search and requirement tags.
   - 1-click application modal with resume text intake.
   - "Track My Application" feature with progress stepper (Applied -> AI Screened -> Interview -> Offer -> Hired) and confirmed interview details.
   - Interactive "Ask Recruiter" AI Chatbot answering questions regarding resort staff housing, European language allowances, and interview stages.
   - Candidate post-interview experience survey tool (1-5 star rating and qualitative feedback).

7. AI Recruiting Tools Suite (`AI Tools Suite`):
   - Video Interview Behavioral & Sentiment Analyzer: Evaluates transcript for tone, confidence percentage, positive behavioral cues, and risk flags.
   - Passive Candidate Sourcing & Outreach Generator: Generates personalized LinkedIn InMail and WhatsApp scout messages.
   - Role-Specific 30-60-90 Onboarding Generator: Generates phased checklists and training plans.
   - Empathetic Candidate Rejection & Feedback Loop: Crafts encouraging, constructive rejection letters with specific development advice.

8. Security, RBAC & Multi-Language Localization:
   - Role-based Access Control dropdown: Head of Talent / Super Admin, Lead Recruiter, Hiring Manager, Candidate Self-Service.
   - AES-256 data encryption and GDPR / Egyptian Data Protection compliance badge.
   - Instant 4-language localization switcher: English (US), العربية (Arabic with RTL font and direction), Français, Deutsch.
   - Nav bar with horizontal smooth scrolling and mouse-wheel navigation.

9. Frappe Code Architecture Vault & Runbook:
   - Interactive code explorer for all 6 Frappe app files + `pyproject.toml` + `README.md`.
   - Syntax viewer, copy buttons, single-file downloads, and 1-click "Download Full Frappe App (.zip)" via JSZip.
   - Step-by-step Frappe Manager / Docker Bench runbook (`bench get-app`, `bench install-app`, `bench migrate`, `site_config.json`).

10. Canditech Job-Simulation Pre-Employment Assessment Suite (`Canditech Simulations`):
   - Multi-modal work-sample assessments testing real role competency before hiring.
   - Task Types:
     * Video Response Questions: Simulated HD webcam recording, audio visualizer, auto speech-to-text transcript analysis.
     * Interactive Live Spreadsheets: Editable spreadsheet grid computing occupancy, RevPAR, ADR, and commercial turnover rent (MGR vs 8.5% turnover).
     * Written Scenario Tasks: Draft executive memos and tenant restructuring agreements.
     * Situational Judgment Dilemmas (SJT): Workplace ethics and customer prioritization dilemmas.
   - AI Automated Grading: Instant scoring against role rubrics with percentile ranking (e.g. Top 2% Percentile, Strong Hire).
   - Anti-Cheating & Proctoring Engine: Tracks tab switches, copy-paste events, screen focus, and calculates proctoring integrity scores.
   - Blind Grading Mode: Anonymizes candidate names and faces to eliminate unconscious bias.
   - Test-Taker Simulation: Interactive fullscreen test-taking environment with countdown timer and auto-save.
   - Invite Dispatcher: 1-click test link generation and WhatsApp/Email template dispatch.

---

# TECH STACK
- Frontend: React 19, TypeScript, Tailwind CSS, Lucide React, Motion.
- Backend: Express 4, Node.js, `@google/genai` TypeScript SDK (model `gemini-3.8-flash`), Vite server middleware.
- Frappe Engine: Python 3.10+, Frappe Framework v15/v16, Frappe HR (`hrms`), PyPDF, pdfplumber, Requests.
- AI Gateway: Google Gen AI SDK server-side + OpenRouter API.
```
