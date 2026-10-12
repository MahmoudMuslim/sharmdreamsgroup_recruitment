# Competitive & Company Research

> Captured 12 Oct 2026. Used as the source of truth for feature parity work.

---

## 1. Sharm Dreams Group — company profile

**Source:** [linkedin.com/company/sharmdreamsgroup](https://www.linkedin.com/company/sharmdreamsgroup)

| Field | Value |
|---|---|
| Industry | Hospitality |
| Company size | 501–1,000 employees |
| Type | Public Company |
| Founded | 1996 |
| LinkedIn followers | 2,202 |
| LinkedIn-listed employees | 54 |

**About:** Founded 1996 with parent company *Sharm Dreams for Tourist Investment*. First
hotel — *Hilton Sharm Dreams Resort* — launched 2000. Over 24 years it has grown to
**7 hotels** plus real-estate projects in **Sharm El Sheikh**, **Sahl Hasheesh (Hurghada)**
and **Marsa Alam**. The group now comprises **12 companies** (subsidiaries, affiliates,
sister companies). Stated commitment: "deliver innovative projects and exceptional
services", with sustainable growth and positive community contribution.

### Implications for the HRMS
- **12 companies** → the tenant model maps directly; today we seed 4. Expand to 12.
- **3 geographic hubs** (Sharm El Sheikh, Sahl Hasheesh, Marsa Alam) → multi-site scheduling,
  per-site job distribution.
- **54 listed employees** → small enough that self-serve recruiting (LinkedIn sourcing +
  WhatsApp) matters more than enterprise SSO.
- **Hotel + real estate mix** → both *operational* (front office, F&B, housekeeping) and
  *technical/finance* (FP&A, underwriting, development) job families needed.
- **Public company** → auditability, retention/DE&I reporting and governance are board-level
  concerns, not nice-to-haves.

---

## 2. Canditech — Product → Use Cases

**Source:** [canditech.io](https://www.canditech.io) — full sitemap of the Use Cases IA.

### 2a. Use Cases — by function
| # | Use case | Slug |
|---|---|---|
| 1 | Engineers and Developers | `/use-cases/hiring-engineers-and-developers-rd/` |
| 2 | Data & BI | `/use-cases/hiring-data-bi-professionals/` |
| 3 | Marketing | `/use-cases/hiring-marketing-professionals/` |
| 4 | Sales | `/use-cases/hiring-sales-sdr-bdr/` |
| 5 | Account Management & Customer Success | `/use-cases/hiring-account-management-customer-success/` |
| 6 | Human Resources | `/use-cases/hiring-human-resources/` |
| 7 | Call Center | `/use-cases/hiring-call-center/` |
| 8 | Technical Support | `/use-cases/hiring-technical-support/` |
| 9 | **Finance** | `/use-cases/hiring-finance-employees/` |
| 10 | Administration and Operations | `/use-cases/hiring-administration-and-operations/` |
| 11 | Healthcare | `/use-cases/hiring-healthcare-workers/` |

### 2b. Use Cases — by hiring problem
| Use case | Slug |
|---|---|
| Technical Hiring | `/use-cases/technical-hiring/` |
| Soft Skills Hiring | `/use-cases/soft-skills-hiring/` |
| Objective Hiring | `/use-cases/objective-hiring/` |
| Mass Hiring | `/use-cases/mass-hiring/` |
| Graduate Hiring | `/use-cases/graduate-hiring/` |
| Remote Hiring | `/use-cases/remote-hiring/` |
| Sourcing Candidates | `/use-cases/sourcing-candidates/` |
| Performance Management | `/use-cases/performance-management/` |

### 2c. Use Cases — by company profile
| Use case | Slug |
|---|---|
| Enterprise | `/use-cases/hiring-solutions-for-enterprise/` |
| Startups & SMBs | `/use-cases/hiring-solutions-for-startups-and-smbs/` |
| Recruiting Agencies | `/use-cases/hiring-solutions-for-hr-agencies/` |

### 2d. Feature breakdown (Product Tour + Cheating Prevention + Finance/HR pages)

**Assessment authoring**
- Library of **500+ ready-to-go tests**, 100% customisable (add/delete/edit questions)
- Build custom assessments in minutes: question types incl. **code, SQL, Excel,
  multiple-choice, video response, written response**
- **Question randomization** — every candidate gets a different paper
- Per-question **scoring, timing** and time limits
- Migrate existing company tests, keep automatic scoring

**Employer branding & candidate experience**
- Company **logo, background image, colour scheme, messaging**
- **Welcome video** to show culture and team
- Share link via email template, career page, job board, social media
- Send via ATS, or bulk-send from the platform

**Scoring & reporting**
- **Automatic scoring** — multiple-choice graded instantly
- **Automatic ranking** by performance ("eliminating unconscious human bias")
- Detailed performance reports; **set benchmarks, compare candidates, build reports**
- Collaborate: share results, export **PDF/Excel**, sync to ATS
- Claim: cut **80% of interview hours**, **50% shorter time-to-hire**

**Anti-cheating (their most heavily marketed differentiator)**
1. **ChatGPT / AI detection** — detects text copied from ChatGPT and external responses
2. **Copy-paste detection** — instant on-screen alert, records *what*, *when*, *which question*
3. **Block test-content copying** — prevents pasting the question into Google/ChatGPT
4. **Tab & window switching** — monitors and flags, optional candidate notification
5. **Device & location tracking** — flags multi-device / multi-location completion
6. **Webcam snapshots** — periodic capture to verify identity
7. *Optional inverse feature:* let candidates **use ChatGPT inside the test** and be scored
   on how well they prompt and apply AI

**Sourcing & automation**
- Integrates with **40+ ATS platforms**
- **ChatBots** — engage candidates, answer questions about role/organisation
- Benchmarks + automatic "progress"/"reject" actions for mass hiring
- Personalized communications at scale

**Platform**
- Any device, **any language**
- Security/privacy: **GDPR, ISO 27001**
- PhD psychometric support, validity & reliability programme
- Top-rated customer support

### 2e. Positioning claims
"The Most Holistic Skill Assessment Platform" · "It's not just a Test, It's a Job
Simulation" · "The Only All-in-One Screening Platform" · "Take the guesswork out of your
screening process".

---

## 3. Parity matrix — our platform vs. Canditech

Status: ✅ shipped · 🟡 partial · 🔴 not built

| Canditech capability | Ours | Where |
|---|---|---|
| Excel job simulation | ✅ | `SpreadsheetRunner.tsx` (Handsontable + HyperFormula) |
| Written response / case study | ✅ | `CaseStudyRunner.tsx` |
| Multiple-choice + auto-grading | ✅ | `QuizRunner.tsx`, submit route |
| One-way video response | ✅ | `VideoPitchRecorder.tsx` (MediaRecorder → Supabase Storage) |
| Question randomization | 🔴 | not built |
| Per-question timing | 🔴 | whole-suite timer only |
| Bulk send assessments | 🔴 | not built |
| Shareable assessment link | ✅ | token-based `/test/[token]` |
| Automatic ranking | ✅ | dashboard candidate ranking |
| Benchmarks / compare candidates | 🟡 | ranking exists, no explicit benchmark sets |
| Report export PDF/Excel | 🔴 | not built |
| ATS sync (40+) | 🟡 | Greenhouse, Lever, Frappe HR connectors only |
| Anti-cheat: tab/window tracking | 🟡 | focus-change counter, displayed not stored |
| Anti-cheat: copy-paste detection | 🔴 | not built |
| Anti-cheat: AI/ChatGPT detection | 🔴 | not built |
| Anti-cheat: device/location tracking | 🔴 | not built |
| Anti-cheat: webcam snapshots | 🔴 | not built |
| AI resume screening + bias reduction | ✅ | `openRouterEngine.ts` |
| Soft-skill / sentiment analysis | ✅ | `analyzeSoftSkills()` |
| Personalized feedback | ✅ | `generateCandidateFeedback()` |
| AI interview questions | ✅ | `generateInterviewQuestions()` |
| Employer branding in test | ✅ | SDG logo/colour in runner |
| Welcome video | 🔴 | not built |
| Candidate chatbot | 🔴 | not built |
| Multi-language assessments | 🟡 | i18n helper + locale setting, not applied to tests |
| Mass hiring / benchmarks | 🔴 | not built |
| Performance management | 🔴 | not built (out of hiring scope) |
| Analytics dashboard | ✅ | admin dashboard |
| RBAC / permissions | ✅ | `roles`, `permissions`, `role_permissions` |
| WhatsApp messaging | ✅ | `WhatsAppConnector` |
| Scheduled WhatsApp + cron | 🔴 | not built |

### Highest-value gaps for Sharm Dreams
1. **Anti-cheat integrity** — their #1 selling point; we have one of six mechanisms.
2. **Question randomization + per-question timing** — core assessment integrity.
3. **Report export** (PDF/Excel) — recruiters expect to download.
4. **Bulk assessment send** — a 120-room resort hires in cohorts.
5. **Hotel-specific use cases** — Finance ✅ exists; Front Office, F&B, Housekeeping,
   Maintenance and Spa role families are missing from our library.
6. **Copy-paste / AI-paste detection** — cheap to add, high perceived value.