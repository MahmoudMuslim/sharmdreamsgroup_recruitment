-- ============================================================================
-- Demo seed data: jobs, assessment templates, questions, applications.
-- Idempotent: keyed by stable natural keys.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
insert into job_openings (id, tenant_id, title, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, status, posted_at, closing_at) values
(
  '22222222-2222-2222-2222-222222222201',
  '11111111-1111-1111-1111-111111111101',
  'Financial Planning & Analysis Manager',
  'Finance',
  'HOSPITALITY',
  'Sharm El Sheikh, Egypt',
  'FULL_TIME',
  'Own the annual budgeting cycle and investment analysis for a 5-star resort portfolio. You will build financial models, run NPV/IRR evaluations on capital projects, and partner with operations leadership on pricing strategy.',
  '["CPA or CFA preferred", "5+ years FP&A in hospitality or real estate", "Advanced Excel financial modelling (NPV, IRR, scenario analysis)", "IFRS reporting experience", "Team leadership"]',
  42000, 60000, 'PUBLISHED', now() - interval '21 days', now() + interval '40 days'
),
(
  '22222222-2222-2222-2222-222222222202',
  '11111111-1111-1111-1111-111111111101',
  'Guest Experience Manager (Front Office)',
  'Operations',
  'HOSPITALITY',
  'Sharm El Sheikh, Egypt',
  'FULL_TIME',
  'Lead the front-office team of a flagship resort, own guest-satisfaction metrics across all touchpoints, and drive service-recovery playbooks. Multilingual guest communication is core to the role (English/Arabic/Russian).',
  '["3+ years front-office leadership in 4*/5* hotels", "Fluent English; Arabic or Russian a plus", "OPERA PMS proficiency", "Guest-satisfaction score ownership", "Conflict resolution"]',
  21000, 30000, 'PUBLISHED', now() - interval '14 days', now() + interval '30 days'
),
(
  '22222222-2222-2222-2222-222222222203',
  '11111111-1111-1111-1111-111111111102',
  'Commercial Development Analyst',
  'Investments',
  'COMMERCIAL_DEVELOPMENT',
  'Cairo, Egypt (Hybrid)',
  'FULL_TIME',
  'Evaluate mixed-use development opportunities across Egypt''s north coast. You will underwrite deals, build DCF models, sensitivity-test assumptions, and present investment memos to the board.',
  '["Investment banking, PE, or real-estate underwriting background", "Financial modelling mastery (DCF, IRR, waterfall structures)", "Real-estate market analytics", "Excellent memo writing", "Arabic and English fluency"]',
  30000, 45000, 'PUBLISHED', now() - interval '10 days', now() + interval '25 days'
),
(
  '22222222-2222-2222-2222-222222222204',
  '11111111-1111-1111-1111-111111111103',
  'Senior Sales Consultant — Luxury Properties',
  'Sales',
  'REAL_ESTATE',
  'Sharm El Sheikh, Egypt',
  'FULL_TIME',
  'Sell premium beachfront residences to international investors (Russia, Germany, Gulf). Manage a high-value pipeline, host site visits, and close off-plan deals with structured payment plans.',
  '["B2C luxury sales record", "Russian or German language advantage", "CRM discipline", "Consultative selling", "Real-estate brokerage licence preferred"]',
  18000, 36000, 'PUBLISHED', now() - interval '7 days', now() + interval '45 days'
),
(
  '22222222-2222-2222-2222-222222222205',
  '11111111-1111-1111-1111-111111111104',
  'Group Talent Acquisition Specialist',
  'Human Resources',
  'CORPORATE',
  'Cairo, Egypt',
  'FULL_TIME',
  'Run end-to-end recruitment for the group''s shared services centre: hospitality operations, finance, and tech roles. You will deploy AI screening, manage assessment pipelines, and own time-to-hire KPIs.',
  '["3+ years full-cycle recruitment", "ATS/HRIS power user", "Data-driven sourcing", "Excellent stakeholder management", "Arabic and English fluency"]'::jsonb,
  15000, 24000, 'PUBLISHED', now() - interval '4 days', now() + interval '35 days'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Assessment templates + questions
-- ---------------------------------------------------------------------------
insert into assessment_templates (id, tenant_id, name, description, role_family, time_limit_minutes) values
(
  '33333333-3333-3333-3333-333333333301',
  '11111111-1111-1111-1111-111111111101',
  'Finance & Investment Excellence Suite',
  'End-to-end evaluation for finance roles: Excel financial modelling, structured case reasoning, video pitch, and financial logic quiz.',
  'FINANCE',
  75
),
(
  '33333333-3333-3333-3333-333333333302',
  '11111111-1111-1111-1111-111111111101',
  'Hospitality Guest Excellence Suite',
  'Situational judgement, service-recovery case studies, multilingual video pitch, and hospitality logic quiz.',
  'OPERATIONS',
  60
),
(
  '33333333-3333-3333-3333-333333333303',
  '11111111-1111-1111-1111-111111111102',
  'Real Estate Analyst Battery',
  'DCF/IRR modelling test, market-analysis case study, and investment logic quiz.',
  'INVESTMENTS',
  90
)
on conflict (id) do nothing;

insert into assessment_questions (id, template_id, question_type, title, prompt, config, points, position) values
-- Q1: Excel financial model (Finance suite)
(
  '44444444-4444-4444-4444-444444444401',
  '33333333-3333-3333-3333-333333333301',
  'EXCEL_MODEL',
  'Resort Expansion — Financial Model',
  'The resort is evaluating a 120-room expansion. Complete the model: compute cash flows, discount them at the WACC in cell B8, and produce the NPV in cell B12 and IRR in cell B13. Cells B10 (net cash flow) and B11 (cumulative) must contain formulas referencing prior rows.',
  '{
    "initial_sheet": {
      "data": [
        ["A", "B"],
        ["Investment (Year 0)", -25000000],
        ["Occupancy Year 1", 0.62],
        ["ADR Year 1 (USD)", 145],
        ["Rooms", 120],
        ["OpEx ratio", 0.42],
        ["Revenue growth", 0.08],
        ["Horizon (years)", 5],
        ["WACC", 0.11],
        ["Net cash flow", null],
        ["Cumulative", null],
        ["NPV", null],
        ["IRR", null]
      ],
      "col_widths": [180, 140]
    },
    "expected_outputs": [
      {"cell": "B10", "formula_hint": "Revenue*(1-OpEx ratio)", "description": "Net cash flow Year 1"},
      {"cell": "B11", "formula_hint": "B10 + prior cumulative", "description": "Cumulative cash flow"},
      {"cell": "B12", "formula_hint": "NPV(WACC, flows)+B1", "description": "Net present value of the expansion"},
      {"cell": "B13", "formula_hint": "IRR of the flow series", "description": "Internal rate of return"}
    ]
  }'::jsonb,
  35, 1
),
-- Q2: Case study (Finance suite)
(
  '44444444-4444-4444-4444-444444444402',
  '33333333-3333-3333-3333-333333333301',
  'CASE_STUDY',
  'Pricing Strategy Under Demand Shock',
  'A competitor opened 300 rooms 2km away and cut ADR by 20%. Occupancy dropped 9 points in one quarter. Recommend a 12-month pricing and positioning strategy. Address revenue management, segmentation, and capital implications. Minimum 250 words.',
  '{"context": "5-star resort, 380 keys, 68% occupancy, ADR $152, guest mix 35% Russian, 25% German, 20% domestic, 20% Gulf.", "min_words": 250}'::jsonb,
  25, 2
),
-- Q3: Video pitch (Finance suite)
(
  '44444444-4444-4444-4444-444444444403',
  '33333333-3333-3333-3333-333333333301',
  'VIDEO_PITCH',
  'Executive Video Pitch',
  'Record a 90-second pitch to the board: why you, why hospitality finance, and the one metric you would fix first at our resorts. Speak in English; structure matters as much as content.',
  '{"max_duration_seconds": 120, "min_duration_seconds": 45}'::jsonb,
  25, 3
),
-- Q4: Multiple choice (Finance suite)
(
  '44444444-4444-4444-4444-444444444404',
  '33333333-3333-3333-3333-333333333301',
  'MULTIPLE_CHOICE',
  'Financial Reasoning Quiz',
  'Answer all questions. Each tests core financial reasoning used daily in this role.',
  '{"options": []}'::jsonb,
  15, 4
),
-- Q5: Video pitch (Hospitality suite)
(
  '44444444-4444-4444-4444-444444444405',
  '33333333-3333-3333-3333-333333333302',
  'VIDEO_PITCH',
  'Guest-Recovery Roleplay Pitch',
  'A long-stay guest''s anniversary dinner was double-booked and the apology gesture missed the mark. Record your service-recovery speech to the guest (60–120 seconds). You may answer in English, Arabic, or Russian.',
  '{"max_duration_seconds": 150, "min_duration_seconds": 45}'::jsonb,
  30, 1
),
-- Q6: Case study (Hospitality suite)
(
  '44444444-4444-4444-4444-444444444406',
  '33333333-3333-3333-3333-333333333302',
  'CASE_STUDY',
  'Situational Judgement: Night Audit Discrepancy',
  'At 02:00 the night audit reveals a 40,000 EGP discrepancy in the city ledger. The front-desk agent on duty is a new hire, the duty manager is unreachable, and a VIP group checks out at 06:00. Rank your actions and justify each. Minimum 200 words.',
  '{"context": "You are Guest Experience Manager on call.", "min_words": 200}'::jsonb,
  40, 2
),
-- Q7: Excel model (Investments suite)
(
  '44444444-4444-4444-4444-444444444407',
  '33333333-3333-3333-3333-333333333303',
  'EXCEL_MODEL',
  'Mixed-Use Development DCF',
  'Build a 5-year DCF for a north-coast mixed-use plot: 60% residential, 25% retail, 15% offices. Land cost $18M, hard costs $52M phased over years 0–2. Absorption per the given schedule. Output levered IRR and equity multiple. All key cells must be formula-driven.',
  '{
    "initial_sheet": {
      "data": [
        ["A", "B"],
        ["Land cost (USD)", -18000000],
        ["Hard cost Y0", -22000000],
        ["Hard cost Y1", -18000000],
        ["Hard cost Y2", -12000000],
        ["Sellout revenue Y1", 24000000],
        ["Sellout revenue Y2", 38000000],
        ["Sellout revenue Y3", 45000000],
        ["Sellout revenue Y4", 30000000],
        ["Sellout revenue Y5", 16000000],
        ["Discount rate", 0.14],
        ["Levered IRR", null],
        ["Equity multiple", null]
      ],
      "col_widths": [190, 150]
    },
    "expected_outputs": [
      {"cell": "B11", "formula_hint": "IRR of net flow series", "description": "Levered IRR"},
      {"cell": "B12", "formula_hint": "Positive flows / equity in", "description": "Equity multiple"}
    ]
  }'::jsonb,
  50, 1
),
-- Q8: Multiple choice (Investments suite)
(
  '44444444-4444-4444-4444-444444444408',
  '33333333-3333-3333-3333-333333333303',
  'MULTIPLE_CHOICE',
  'Investment Logic Quiz',
  'Core concepts in real-estate investment analysis.',
  '{"options": []}'::jsonb,
  20, 2
)
on conflict (id) do nothing;

-- Multiple-choice sub-questions live in config.options; attach real options:
update assessment_questions
set config = '{
  "options": [
    {
      "label": "A",
      "text": "A project with an IRR of 12% when the cost of capital is 10% destroys value because IRR ignores the scale of investment.",
      "is_correct": false
    },
    {
      "label": "B",
      "text": "NPV is preferred over IRR for mutually exclusive projects because it measures absolute value created in currency terms.",
      "is_correct": true
    },
    {
      "label": "C",
      "text": "Payback period is the most robust capital-budgeting metric because it accounts for time value of money.",
      "is_correct": false
    },
    {
      "label": "D",
      "text": "A higher WACC always increases the NPV of a project with conventional cash flows.",
      "is_correct": false
    }
  ]
}'::jsonb
where id = '44444444-4444-4444-4444-444444444404';

update assessment_questions
set config = '{
  "options": [
    {
      "label": "A",
      "text": "Cap rate = Net Operating Income / Property Value; a lower cap rate implies higher valuation for the same NOI.",
      "is_correct": true
    },
    {
      "label": "B",
      "text": "Cap rate = Property Value / Gross Rental Income; a lower cap rate implies lower valuation.",
      "is_correct": false
    },
    {
      "label": "C",
      "text": "Equity multiple of 1.5x guarantees a 50% IRR.",
      "is_correct": false
    },
    {
      "label": "D",
      "text": "Leverage always increases equity IRR regardless of debt cost.",
      "is_correct": false
    }
  ]
}'::jsonb
where id = '44444444-4444-4444-4444-444444444408';

-- ---------------------------------------------------------------------------
-- Demo applications (varied stages, sources, scores)
-- ---------------------------------------------------------------------------
insert into applications (id, job_id, full_name, email, phone, tracking_code, stage, source, ai_match_score, ai_screening_summary, ai_strengths, ai_gaps, created_at, hired_at) values
(
  '55555555-5555-5555-5555-555555555501',
  '22222222-2222-2222-2222-222222222201',
  'Youssef El-Sayed', 'youssef.elsayed@example.com', '+20 100 111 2233', 'SDG-FINANCE01', 'ASSESSMENT', 'LINKEDIN', 87,
  'Strong FP&A background in resort groups; advanced modelling; IFRS fluent. Recommended to advance to assessment.',
  '["Advanced Excel & DCF modelling", "Hospitality FP&A 7y", "Team leadership"]',
  '["Limited exposure to development underwriting"]',
  now() - interval '9 days', null
),
(
  '55555555-5555-5555-5555-555555555502',
  '22222222-2222-2222-2222-222222222201',
  'Mariam Fathy', 'mariam.fathy@example.com', '+20 122 334 5566', 'SDG-FINANCE02', 'INTERVIEW', 'WHATSAPP', 79,
  'Solid corporate FP&A; quick learner; needs hospitality domain ramp-up.',
  '["Budgeting cycle ownership", "Power BI dashboards"]',
  '["No hospitality experience", "Arabic reporting limited"]',
  now() - interval '12 days', null
),
(
  '55555555-5555-5555-5555-555555555503',
  '22222222-2222-2222-2222-222222222202',
  'Daria Ivanova', 'daria.ivanova@example.com', '+7 903 555 1188', 'SDG-GEM-0003', 'OFFER', 'JOB_BOARD', 92,
  'Outstanding front-office leadership across Red Sea resorts; trilingual (EN/RU/AR); guest-satisfaction track record excellent.',
  '["Trilingual guest communication", "OPERA PMS expert", "Service recovery"]',
  '[]',
  now() - interval '18 days', null
),
(
  '55555555-5555-5555-5555-555555555504',
  '22222222-2222-2222-2222-222222222203',
  'Lukas Meyer', 'lukas.meyer@example.com', '+49 151 2233 4455', 'SDG-DEV-0004', 'AI_SCREENING', 'LINKEDIN', 74,
  'Investment analyst with retail-mixed-use exposure; strong memo writing; valuation toolkit solid.',
  '["DCF & waterfall modelling", "Market analytics"]',
  '["Egypt market familiarity limited"]',
  now() - interval '5 days', null
),
(
  '55555555-5555-5555-5555-555555555505',
  '22222222-2222-2222-2222-222222222204',
  'Ahmed Samir', 'ahmed.samir@example.com', '+20 106 778 9900', 'SDG-SLS-0005', 'NEW', 'CAREER_SITE', null, null, null, null,
  now() - interval '1 days', null
),
(
  '55555555-5555-5555-5555-555555555506',
  '22222222-2222-2222-2222-222222222201',
  'Nourhan Adel', 'nourhan.adel@example.com', '+20 111 999 4455', 'SDG-FINANCE06', 'HIRED', 'REFERRAL', 95,
  'Exceptional candidate — ex-Big4, resort-group FP&A lead. Hired at band midpoint after strong assessment.',
  '["Full modelling suite", "IFRS & audit", "Stakeholder communication"]',
  '[]',
  now() - interval '34 days', now() - interval '6 days'
),
(
  '55555555-5555-5555-5555-555555555507',
  '22222222-2222-2222-2222-222222222202',
  'Khaled Mansour', 'khaled.mansour@example.com', '+20 128 667 2211', 'SDG-GEM-0007', 'REJECTED', 'JOB_BOARD', 41,
  'Operations background is night-audit heavy; limited guest-facing leadership evidence.',
  '["Night audit mastery"]',
  '["Front-office leadership", "Guest satisfaction ownership", "Language coverage"]',
  now() - interval '16 days', null
),
(
  '55555555-5555-5555-5555-555555555508',
  '22222222-2222-2222-2222-222222222205',
  'Farida Osman', 'farida.osman@example.com', '+20 155 443 6677', 'SDG-TA-0008', 'ASSESSMENT', 'WHATSAPP', 83,
  'Agency + in-house TA blend; comfortable with ATS tooling; strong sourcing analytics.',
  '["Full-cycle recruitment", "ATS/HRIS power user", "Sourcing analytics"]',
  '["Manufacturing TA exposure"]',
  now() - interval '3 days', null
)
on conflict (tracking_code) do nothing;

-- ---------------------------------------------------------------------------
-- Demo attempt for the assessment runner (public token for testing)
-- attempt_id 6666...01 -> Youssef El-Sayed, Finance suite
-- ---------------------------------------------------------------------------
insert into candidate_attempts (id, application_id, template_id, access_token, status, time_limit_minutes) values
(
  '66666666-6666-6666-6666-666666666601',
  '55555555-5555-5555-5555-555555555501',
  '33333333-3333-3333-3333-333333333301',
  'demo-attempt-token-fin01',
  'NOT_STARTED',
  75
)
on conflict (access_token) do nothing;
