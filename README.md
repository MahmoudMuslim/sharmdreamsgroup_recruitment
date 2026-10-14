# Sharm Dreams Group — AI-Driven HRMS, ATS & Skill Assessment Platform

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_17-green?logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-Private-lightgrey)](#)

An enterprise-grade, **AI-Driven Omnichannel HRMS, ATS, & Skill Assessment Platform** serving multi-company groups (Hospitality, Real Estate, Commercial Development, Corporate Shared Services). A standalone hybrid of Canditech + Greenhouse + Lever + AI Recruiter.

---

## 🎯 Features Overview

### 🔐 Authentication & RBAC
- **Supabase Auth** with Email/Password, Magic Link, OAuth 2.0
- **Roles**: `SUPER_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `CANDIDATE`
- **Granular Permissions**: `candidates.read`, `assessments.create`, `settings.manage_users`, `scores.view_unmasked`
- **Middleware Protection** on all `/(admin)/*` routes
- **RLS Policies** enforcing tenant isolation

### 📊 Admin Dashboard (`/dashboard`)
- Real-time pipeline funnel with conversion rates
- Channel effectiveness (LinkedIn, WhatsApp, Job Board, Career Site, Referral)
- AI fit score distribution (0–49, 50–79, 80–100)
- Top candidates ranked by AI match score
- Time-to-hire trends (6-month rolling)
- Application velocity (last 14 days)

### 💼 Job Management (`/jobs`)
- Multi-company job openings across 4 sectors
- Draft/Published/Paused/Closed statuses
- Salary ranges with multi-currency support
- Applicant counts per role
- `NewJobDrawer` for rapid creation

### 👥 Candidate Database (`/candidates`)
- Searchable, filterable candidate table (name, email, role, tracking code)
- Stage filter: `NEW` → `AI_SCREENING` → `ASSESSMENT` → `INTERVIEW` → `OFFER` → `HIRED`/`REJECTED`
- **Bulk WhatsApp** messaging with template placeholders
- **Profile Drawer** showing:
  - AI match score with meter
  - Screening summary
  - Strengths & Gaps
  - Soft skills radar (Emotional Intelligence, Communication, Leadership, Cultural Fit)
  - Personalized feedback
  - Rejection reason (if applicable)

### 🧪 Assessment Engine (`/assessments`)
- **Templates** per role family (Finance, Operations, Investments)
- **Question Types**:
  - **Excel Model** — Handsontable financial modeling (NPV, IRR, DCF)
  - **Video Pitch** — MediaRecorder with preview, review, Supabase Storage upload
  - **Case Study** — Long-form with word count validation
  - **Multiple Choice** — Configurable options with correct answers
- **Question Editor Drawer** with live preview
- Time limits (5–300 minutes)

### ⚙️ Settings (`/settings`)
| Section | Purpose |
|---------|---------|
| **Credentials Console** | Multi-API key management per provider with priority failover, AES-256 encryption, audit log |
| **Model Routing Console** | Per-capability model selection (primary + fallback), cost-tier grouping, search |
| **Team** | User management, company assignment, role matrix |
| **Master Data** | Companies, departments, locations, currencies, skills |
| **Onboarding** | AI-generated checklist plans |

### 🤖 AI Screening & Assessment Runner
- **Multi-Provider Gateway**: OpenRouter (100+ models), Google AI Studio (Gemini), OpenCode
- **Failover Chain**: Priority 1 key → Priority 2 key → … → Environment variable
- **Free Tier Models**: Gemma 4 (31B/26B MoE), Llama 3.1 8B, Phi-3 Mini 128K
- **Paid Fallbacks**: GPT-4o Mini, Claude 3.5 Haiku, Gemini 1.5 Flash
- **Candidate Portal** (`/test/[token]`): Token validation, timed session, auto-submit

---

## 🏗 Architecture

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Login, Forgot Password, Unauthorized
│   ├── (admin)/                  # Protected Admin Portal
│   │   ├── dashboard/            # Analytics Dashboard
│   │   ├── settings/             # Credentials, Model Routing, Team, Master Data
│   │   ├── assessments/          # Assessment Builder
│   │   ├── candidates/           # Candidate Browser + Profile
│   │   ├── jobs/                 # Job Openings
│   │   └── onboarding/           # AI Onboarding Plans
│   ├── (candidate)/              # Public Candidate Portal
│   │   ├── portal/               # Application Tracker
│   │   └── test/[token]/         # Timed Assessment Runner
│   └── api/                      # Webhooks, Auth Callbacks, Cron
├── modules/                      # Clean Architecture Domains
│   ├── auth/                     # RBAC, Session, Permissions
│   ├── assessment/               # Excel, Video, Quiz, Case Study
│   ├── screening/                # AI Gateway, CV Parsing, Scoring
│   ├── omnichannel/              # WhatsApp, Email
│   ├── analytics/                # Dashboard Metrics, Pipeline
│   └── onboarding/               # Checklist Generation
├── lib/                          # Supabase Clients, Config, Crypto
├── stores/                       # Zustand (Auth, Assessment)
└── types/                        # Shared TypeScript Interfaces
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm (recommended) or npm
- Supabase CLI (for local development)

### Installation

```bash
# Clone and install
git clone <repository-url>
cd sharm_dreams_group
pnpm install

# Generate encryption key for credential storage
node scripts/generate-encryption-key.mjs

# Copy environment template
cp .env.example .env.local
# Edit .env.local with your credentials
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role secret (server-only) | ✅ |
| `SETTINGS_ENCRYPTION_KEY` | 32-byte base64 key for AES-256-GCM | ✅ |
| `OPENROUTER_API_KEY` | OpenRouter API key (fallback) | ⚠️ |
| `GOOGLE_AI_STUDIO_API_KEY` | Google AI Studio key (fallback) | ⚠️ |
| `WHATSAPP_TOKEN` | Meta WhatsApp access token | ⚠️ |

> **Note**: Most API keys are managed in **Settings → API Keys** panel with encrypted storage. Environment variables serve as fallbacks only.

### Database Setup

```bash
# Option 1: Use Supabase Dashboard (recommended)
# 1. Go to https://supabase.com/dashboard/project/lbxdeceropsxwohnzinl
# 2. Run schema.sql in SQL Editor
# 3. Run seed.sql for demo data

# Option 2: Local development with Supabase CLI
supabase start
supabase db reset --linked
```

### Development

```bash
# Start dev server with Turbopack
pnpm dev

# Type check
pnpm tsc --noEmit

# Build for production
pnpm build

# Start production server
pnpm start
```

---

## 🗄 Database Schema

### Core Tables
- `tenants_and_companies` — 4 group entities (Hospitality, Real Estate, Commercial, Corporate)
- `user_profiles` — Staff & candidates linked to `auth.users`
- `job_openings` — Multi-tenant job requisitions
- `applications` — Candidate applications with AI screening fields
- `assessment_templates` / `assessment_questions` — Configurable test batteries
- `candidate_attempts` — Timed assessment sessions with secure tokens
- `candidate_responses` — Answers per question (spreadsheet, video, text, choices)
- `ats_integrations` — reserved table, no longer read by the app (the ATS/calendar connectors were removed)
- `communication_logs` — WhatsApp, Email, In-app message history
- `interview_schedules` — Interview slots with meeting links, sent over WhatsApp and email
- `onboarding_plans` — AI-generated checklists & skill gaps

### RLS Policies
- **Candidates** access ONLY their attempt via `attempt_token` JWT claim
- **Staff** access ONLY data within their `tenant_id` (unless `SUPER_ADMIN`)
- **Public** can INSERT applications (career site), READ published jobs

### Storage Buckets
- `candidate-videos` (50MB, video/webm, video/mp4)
- `candidate-audio` (20MB, audio/webm, audio/mpeg)
- `resumes` (10MB, PDF, Docx)

---

## 🤖 AI Provider Configuration

### Adding a New Provider
```typescript
// src/modules/settings/domain/providers.ts
providerRegistry.register({
  id: "my_provider",
  displayName: "My Provider",
  group: "ai",
  envVar: "MY_PROVIDER_API_KEY",
  description: "Description for UI",
  docsUrl: "https://docs.example.com",
  verify: { url: "https://api.example.com/health", method: "GET", header: "Authorization" },
  fields: [
    { key: "api_key", label: "API Key", kind: "text", required: true, secret: true },
  ],
});
```

### Model Cost Tiers
Models auto-grouped in Model Routing Console:
- **Free** — $0/M tokens
- **Low Cost** — <$0.50/M
- **Medium Cost** — $0.50–$2/M
- **High Cost** — $2–$10/M
- **Premium** — >$10/M

---

## 📱 Candidate Assessment Flow

```
1. Recruiter schedules assessment → Creates candidate_attempts row with access_token
2. WhatsApp dispatcher sends link: https://domain.com/test/demo-attempt-token-fin01
3. Candidate opens link → Server validates token & link_expires_at
4. First access → Sets started_at, expires_at = started_at + time_limit_minutes
5. Client timer starts (validated server-side on each action)
6. Candidate completes questions → Responses saved to candidate_responses
7. Timer expires OR manual submit → Status = SUBMITTED, auto-grade triggered
8. Results appear in Candidate Browser with AI evaluation
```

---

## 🔧 Key Scripts

```bash
# Type checking
pnpm tsc --noEmit

# Linting
pnpm lint

# Build
pnpm build

# Supabase migration helpers
supabase migration new <name>
supabase db push
supabase db reset

# Generate encryption key (run once)
node scripts/generate-encryption-key.mjs

# Generate TypeScript types from Supabase
supabase gen types typescript --project-id lbxdeceropsxwohnzinl > src/types/database.ts
```

---

## 📦 Deployment

### Vercel (Recommended)
1. Connect GitHub repository
2. Add environment variables from `.env.local`
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SETTINGS_ENCRYPTION_KEY`
4. Deploy

### Docker
```dockerfile
# Dockerfile.example
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## 🧪 Testing

```bash
# Unit tests (when added)
pnpm test

# E2E tests (when added)
pnpm test:e2e

# Manual assessment test
# 1. Go to /test/demo-attempt-token-fin01
# 2. Complete Excel model, video pitch, case study, quiz
# 3. Verify auto-submit on timer expiry
```

---

## 📚 Documentation

- [Prompt & Project Spec](prompt.md) — Complete requirements & architecture
- [Database Schema](supabase/schema.sql) — Full DDL + RLS + Seed
- [API Types](src/types/index.ts) — All TypeScript interfaces
- [Provider Registry](src/modules/settings/domain/providers.ts) — Dynamic provider system

---

## 🛡 Security

- **Encryption**: AES-256-GCM for all stored API keys (`SETTINGS_ENCRYPTION_KEY`)
- **RLS**: Row Level Security on every table with custom PostgreSQL functions
- **Tokens**: 128-bit unguessable `access_token` for candidate attempts
- **Secrets**: Never logged, never sent to browser, decrypted only at request time
- **Audit Log**: All credential changes tracked with actor, action, detail

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Ensure `pnpm tsc --noEmit` passes
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open Pull Request

---

## 📄 License

Private proprietary software. All rights reserved — Sharm Dreams Group.

---

## 🙋 Support

- **Issues**: GitHub Issues (internal)
- **Architecture Questions**: See `prompt.md` for complete specification
- **Database Changes**: Create migration in `supabase/migrations/`
- **New Providers**: Register in `src/modules/settings/domain/providers.ts`

---

**Built with ❤️ for Sharm Dreams Group** — Hospitality, Real Estate, Commercial Development & Corporate Shared Services