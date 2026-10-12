-- ============================================================================
-- Master data: companies, departments, locations, role families, skills
-- Everything the rest of the app selects from instead of free text.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Companies: enrich the existing tenant table rather than replacing it
-- ---------------------------------------------------------------------------
alter table tenants_and_companies
  add column if not exists legal_name text,
  add column if not exists logo_url text,
  add column if not exists website text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order integer not null default 100;

create index if not exists idx_companies_active on tenants_and_companies (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Generic helper: is this master-data row group-wide (tenant_id NULL) or
-- owned by one company?
-- ---------------------------------------------------------------------------

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants_and_companies (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  head_profile_id uuid references user_profiles (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists departments_global_slug_uniq
  on departments (slug) where tenant_id is null;
create unique index if not exists departments_tenant_slug_uniq
  on departments (tenant_id, slug) where tenant_id is not null;
create index if not exists idx_departments_tenant on departments (tenant_id);

drop trigger if exists trg_departments_updated on departments;
create trigger trg_departments_updated before update on departments
  for each row execute function set_updated_at();

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants_and_companies (id) on delete cascade,
  name text not null,
  city text,
  governorate text,
  country text not null default 'Egypt',
  timezone text not null default 'Africa/Cairo',
  address text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists locations_global_name_uniq
  on locations (name, city) where tenant_id is null;
create unique index if not exists locations_tenant_name_uniq
  on locations (tenant_id, name, city) where tenant_id is not null;
create index if not exists idx_locations_tenant on locations (tenant_id);

drop trigger if exists trg_locations_updated on locations;
create trigger trg_locations_updated before update on locations
  for each row execute function set_updated_at();

create table if not exists role_families (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  department_id uuid references departments (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists idx_role_families_department on role_families (department_id);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_skills_category on skills (category);

drop trigger if exists trg_skills_updated on skills;
create trigger trg_skills_updated before update on skills
  for each row execute function set_updated_at();

-- Skill <-> role family many-to-many, used for skill-gap analysis and matching.
create table if not exists role_family_skills (
  role_family_id uuid not null references role_families (id) on delete cascade,
  skill_id uuid not null references skills (id) on delete cascade,
  required_level integer not null default 3 check (required_level between 1 and 5),
  weight numeric(3,2) not null default 1.00,
  primary key (role_family_id, skill_id)
);

create table if not exists candidate_skills (
  application_id uuid not null references applications (id) on delete cascade,
  skill_id uuid not null references skills (id) on delete cascade,
  proficiency integer not null default 1 check (proficiency between 1 and 5),
  source text not null default 'AI_SCREENING',
  primary key (application_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- RLS — master data is company-scoped; staff read, platform settings write
-- ---------------------------------------------------------------------------
alter table departments enable row level security;
alter table locations enable row level security;
alter table role_families enable row level security;
alter table skills enable row level security;
alter table role_family_skills enable row level security;
alter table candidate_skills enable row level security;

drop policy if exists departments_read on departments;
create policy departments_read on departments
  for select using (is_active or is_staff());

drop policy if exists departments_write on departments;
create policy departments_write on departments
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists locations_read on locations;
create policy locations_read on locations
  for select using (is_active or is_staff());

drop policy if exists locations_write on locations;
create policy locations_write on locations
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists role_families_read on role_families;
create policy role_families_read on role_families
  for select using (is_active or is_staff());

drop policy if exists role_families_write on role_families;
create policy role_families_write on role_families
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists skills_read on skills;
create policy skills_read on skills
  for select using (is_active or is_staff());

drop policy if exists skills_write on skills;
create policy skills_write on skills
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists role_family_skills_read on role_family_skills;
create policy role_family_skills_read on role_family_skills
  for select using (is_staff());

drop policy if exists role_family_skills_write on role_family_skills;
create policy role_family_skills_write on role_family_skills
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists candidate_skills_read on candidate_skills;
create policy candidate_skills_read on candidate_skills
  for select using (is_staff());

drop policy if exists candidate_skills_write on candidate_skills;
create policy candidate_skills_write on candidate_skills
  for all using (is_staff()) with check (is_staff());

-- Companies may be managed by platform admins, read by everyone (public showcase).
drop policy if exists companies_read on tenants_and_companies;
create policy companies_read on tenants_and_companies
  for select using (is_active or is_staff());

drop policy if exists companies_write on tenants_and_companies;
create policy companies_write on tenants_and_companies
  for all using (has_permission('companies.manage') or has_permission('settings.manage_platform'))
  with check (has_permission('companies.manage') or has_permission('settings.manage_platform'));

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

update tenants_and_companies set legal_name = 'Sharm Dreams Company for Tourist Investment' where slug = 'sharm-dreams-touristic';
update tenants_and_companies set legal_name = 'Rowad Misr for Tourist Investment Co. S.A.E.' where slug = 'rowad-misr';
update tenants_and_companies set legal_name = 'Sharm Dreams Holding Company for Tourism & Hotels' where slug = 'sharm-dreams-realestate';
update tenants_and_companies set legal_name = 'SDG Corporate Shared Services' where slug = 'sdg-corporate';

insert into departments (tenant_id, name, slug, description, sort_order) values
  (null, 'Finance & Investment', 'finance-investment', 'FP&A, treasury, audit and investment analysis', 10),
  (null, 'Human Resources', 'human-resources', 'Talent acquisition, L&D and people operations', 20),
  (null, 'Front Office & Guest Relations', 'front-office', 'Reception, concierge and guest experience leadership', 30),
  (null, 'Food & Beverage', 'food-beverage', 'Restaurants, bars, banqueting and culinary teams', 40),
  (null, 'Rooms Division', 'rooms-division', 'Housekeeping and room operations', 50),
  (null, 'Spa & Wellness', 'spa-wellness', 'Spa, fitness and recreation services', 60),
  (null, 'Sales & Marketing', 'sales-marketing', 'Revenue, reservations, digital and brand', 70),
  (null, 'Real Estate & Development', 'real-estate-development', 'Acquisition, design, construction and handover', 80),
  (null, 'Maintenance & Engineering', 'maintenance-engineering', 'Technical services, projects and facilities', 90),
  (null, 'Operations & Administration', 'operations-administration', 'Resort operations, admin and procurement', 100),
  (null, 'Information Technology', 'information-technology', 'Platform, infrastructure and digital products', 110),
  (null, 'Legal & Compliance', 'legal-compliance', 'Contracts, governance and regulatory affairs', 120),
  (null, 'Commercial & Procurement', 'commercial-procurement', 'Sourcing, supplier management and cost control', 130)
on conflict do nothing;

insert into locations (tenant_id, name, city, governorate, country, sort_order) values
  (null, 'Sharm El Sheikh', 'Sharm El Sheikh', 'South Sinai', 'Egypt', 10),
  (null, 'Sahl Hasheesh', 'Hurghada', 'Red Sea', 'Egypt', 20),
  (null, 'Marsa Alam', 'Marsa Alam', 'Red Sea', 'Egypt', 30),
  (null, 'Cairo (Head Office)', 'Cairo', 'Cairo', 'Egypt', 40),
  (null, 'Hurghada', 'Hurghada', 'Red Sea', 'Egypt', 50)
on conflict do nothing;

insert into role_families (key, label, description, sort_order) values
  ('FINANCE', 'Finance', 'Financial planning, analysis, controlling and investment roles', 10),
  ('INVESTMENTS', 'Investments', 'Deal analysis, valuation and portfolio management', 20),
  ('ACCOUNTING', 'Accounting', 'Bookkeeping, reporting, audit and statutory compliance', 30),
  ('HOSPITALITY_OPS', 'Hospitality Operations', 'Front office, rooms, F&B and guest experience operations', 40),
  ('FOOD_BEVERAGE', 'Food & Beverage', 'Culinary and beverage service leadership', 50),
  ('HOUSEKEEPING', 'Housekeeping', 'Rooms and public-area housekeeping supervision', 60),
  ('SALES', 'Sales', 'Consultative selling and revenue generation', 70),
  ('RECRUITING', 'Recruiting & Talent Acquisition', 'Sourcing, screening and talent pipeline ownership', 80),
  ('HR', 'Human Resources', 'People operations, L&D and employee relations', 90),
  ('ENGINEERING', 'Engineering & Maintenance', 'Technical services, HVAC, electrical and projects', 100),
  ('REAL_ESTATE', 'Real Estate & Development', 'Property development, design and delivery', 110),
  ('IT', 'Information Technology', 'Software, infrastructure and support', 120),
  ('LEGAL', 'Legal & Compliance', 'Contracts and regulatory affairs', 130),
  ('GENERAL', 'General', 'Any role without a specific family', 900)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into skills (name, category, description, sort_order) values
  ('Financial modelling', 'Technical', 'Building multi-sheet financial models with linked assumptions', 10),
  ('NPV / IRR analysis', 'Technical', 'Discounted cash flow and return calculations', 20),
  ('Budgeting', 'Technical', 'Annual budgeting cycles and variance analysis', 30),
  ('IFRS reporting', 'Technical', 'Financial reporting under IFRS', 40),
  ('Excel (advanced)', 'Technical', 'Formulas, pivot tables, Power Query and macros', 50),
  ('Revenue management', 'Technical', 'Pricing, yield and distribution strategy', 60),
  ('Property valuation', 'Technical', 'DCF, cap rates and comparable-sales analysis', 70),
  ('Feasibility studies', 'Technical', 'Development appraisal and market studies', 80),
  ('Team leadership', 'Soft', 'Leading and developing teams', 90),
  ('Stakeholder communication', 'Soft', 'Presenting to executives and external parties', 100),
  ('Emotional intelligence', 'Soft', 'Self-awareness and relationship management', 110),
  ('Guest relations', 'Soft', 'Managing guest expectations and service recovery', 120),
  ('Conflict resolution', 'Soft', 'De-escalation and difficult conversations', 130),
  ('Negotiation', 'Commercial', 'Commercial negotiation and closing', 140),
  ('CRM discipline', 'Commercial', 'Pipeline hygiene and forecasting', 150),
  ('Recruiting', 'Functional', 'Sourcing, screening and closing candidates', 160),
  ('ATS / HRIS tooling', 'Functional', 'Applicant tracking and HR information systems', 170),
  ('Data analysis', 'Technical', 'Quantitative analysis and reporting', 180),
  ('Compliance', 'Functional', 'Regulatory and policy compliance', 190),
  ('Hygiene and food safety', 'Functional', 'HACCP and kitchen safety standards', 200),
  ('Maintenance planning', 'Technical', 'Preventive maintenance and asset management', 210),
  ('Project management', 'Technical', 'Delivery, scheduling and contractor management', 220)
on conflict (name) do update set category = excluded.category, description = excluded.description;

-- Give the finance and investment families their expected skill profile.
insert into role_family_skills (role_family_id, skill_id, required_level, weight)
select rf.id, s.id,
       case s.name
         when 'Financial modelling' then 5 when 'NPV / IRR analysis' then 5
         when 'Budgeting' then 4 when 'IFRS reporting' then 4 when 'Excel (advanced)' then 4
         else 3 end,
       case s.name when 'Financial modelling' then 1.5 when 'NPV / IRR analysis' then 1.5 else 1.0 end
from role_families rf, skills s
where rf.key = 'FINANCE'
  and s.name in ('Financial modelling','NPV / IRR analysis','Budgeting','IFRS reporting','Excel (advanced)','Revenue management','Data analysis','Stakeholder communication','Team leadership','Compliance')
on conflict do nothing;

insert into role_family_skills (role_family_id, skill_id, required_level, weight)
select rf.id, s.id, 5, 1.5
from role_families rf, skills s
where rf.key = 'INVESTMENTS'
  and s.name in ('Financial modelling','NPV / IRR analysis','Property valuation','Feasibility studies','Data analysis','Negotiation','Stakeholder communication')
on conflict do nothing;

insert into role_family_skills (role_family_id, skill_id, required_level, weight)
select rf.id, s.id, 5, 1.5
from role_families rf, skills s
where rf.key = 'HOSPITALITY_OPS'
  and s.name in ('Guest relations','Emotional intelligence','Conflict resolution','Team leadership','Compliance')
on conflict do nothing;

insert into role_family_skills (role_family_id, skill_id, required_level, weight)
select rf.id, s.id, 5, 1.5
from role_families rf, skills s
where rf.key = 'RECRUITING'
  and s.name in ('Recruiting','ATS / HRIS tooling','Stakeholder communication','Emotional intelligence','Negotiation','Data analysis')
on conflict do nothing;

-- Attach departments to the role families that map cleanly.
update role_families set department_id = d.id
from departments d
where d.slug = 'finance-investment' and role_families.key in ('FINANCE','INVESTMENTS','ACCOUNTING');

update role_families set department_id = d.id
from departments d
where d.slug = 'human-resources' and role_families.key in ('RECRUITING','HR');

update role_families set department_id = d.id
from departments d
where d.slug = 'front-office' and role_families.key = 'HOSPITALITY_OPS';

update role_families set department_id = d.id
from departments d
where d.slug = 'real-estate-development' and role_families.key = 'REAL_ESTATE';

update role_families set department_id = d.id
from departments d
where d.slug = 'information-technology' and role_families.key = 'IT';

update role_families set department_id = d.id
from departments d
where d.slug = 'legal-compliance' and role_families.key = 'LEGAL';