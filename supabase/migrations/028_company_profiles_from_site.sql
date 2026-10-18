-- ============================================================================
-- The companies, in their own words — copied from sharmdreamsgroup.com.
--
-- Migration 027 gave `tenants_and_companies` a profile a careers page can read,
-- and seeded only what docs/RESEARCH.md recorded about the group. This file
-- fills that profile from the group's own public site, which is a far better
-- source: it names the six portfolio companies, says when each was
-- established, lists their shareholders and issued capital, and carries the
-- "Why join us" copy the group already shows candidates.
--
-- Pages read (2026-10-18, English locale):
--   /en/about/                     the group's four-paragraph story, vision, mission
--   /en/careers/                   the recruiting pitch and the four benefits
--   /en/portfolio/<slug>/          one page per portfolio company: what it is, when
--                                  it was established, its capital, shareholders,
--                                  board, subsidiaries and properties
--   /en/affiliated/                the six affiliated businesses
--
-- Two rules this file keeps to:
--
-- 1. The prose is the group's, not mine. Descriptions are quoted from the
--    company pages; the histories are those quotes plus the establishment years,
--    capital figures and shareholder lists printed on the same page. Nothing is
--    rounded up, expanded or written to sound better.
--
-- 2. A row is only given a company's profile when the identity is defensible.
--    The table's four seeded rows carry short internal names ("Sharm Dreams
--    Touristic"), while the site uses each company's full legal name. Where a
--    seeded row clearly is that company, its `legal_name` gets the site's name —
--    which is also how anyone reading the console can see the mapping — and the
--    row's `name` is left exactly as it is, because openings, departments and
--    locations already point at it and the owner decides what a company is
--    called on screen. Where the site says nothing about a row, the row stays
--    blank rather than receiving a neighbour's history.
--
-- So: three of the four seeded rows are filled (two from their own pages, one
-- from the single line the site gives it), `SDG Corporate Shared Services` is
-- left alone because it does not appear on the site at all, and the four
-- portfolio companies that had no row at all get one — none of them duplicates
-- a seeded row, since they are separate legal entities with their own pages.
--
-- `benefits` changes meaning here. 027 described it as an array of short
-- strings; the group's own list is four titled items, each with a sentence, so
-- it now holds {"title": …, "text": …} objects and the comment says so. The
-- shape check (an array) still applies and still cannot tell a true benefit
-- from a false one — that is the recruiter's job, not a constraint's.
--
-- No image URLs are copied. The site's covers and logos are its own hosting,
-- and a careers page that hot-links them breaks when the marketing site is
-- redesigned. `logo_url` and `cover_url` stay for a person to fill from files
-- the group controls.
-- ============================================================================

comment on column public.tenants_and_companies.benefits is
  'Array of {"title": …, "text": …} objects — the group''s own "Why join us" list. Rendered as cards, never promised as a contract.';

-- ---------------------------------------------------------------------------
-- The group row.
-- ---------------------------------------------------------------------------
update public.tenants_and_companies
set
  tagline = 'Building destinations that shape the future of tourism & real estate.',
  website = 'https://sharmdreamsgroup.com/',
  description =
    'Sharm Dreams Group is an Egyptian investment group specializing in tourism, hospitality, and real estate development. Through a diversified portfolio of companies and strategic partnerships, the group delivers integrated destinations designed for long-term value and sustainable growth.' || E'\n\n' ||
    'A structured family of tourism and hospitality companies, united by a single standard of excellence — six companies, one shared vision.',
  history =
    'Since 1996, Sharm Dreams Group has set the gold standard for luxury hospitality in Egypt. Our journey began with the iconic Jaz Sharm Dreams Resort, and over the past two decades, we have redefined the art of gracious living across Egypt''s most breathtaking destinations. Every property in our portfolio is a testament to our unwavering commitment to excellence, elegance, and unforgettable guest experiences.' || E'\n\n' ||
    'Today, Sharm Dreams Group stands as a beacon of sophistication and innovation. With a diverse portfolio of hotels and real estate developments, we continue to elevate the standards of luxury, blending world-class amenities with authentic Egyptian hospitality. Our presence in Egypt''s premier coastal cities is a reflection of our vision to inspire and delight guests from around the globe.' || E'\n\n' ||
    'Our vision is to elevate Egypt''s tourism landscape by attracting international travelers and setting new benchmarks in guest experience. We are dedicated to innovation, sustainability, and the creation of integrated developments that enrich both our guests and the communities we serve. Our mission is to develop and manage high-quality hospitality and real estate projects that deliver long-term value for investors, partners, and communities — through innovation, integrity, and strategic partnerships.' || E'\n\n' ||
    'Looking ahead, Sharm Dreams Group is poised to introduce a new era of entertainment, wellness, and lifestyle destinations. Our future projects will blend global expertise with local charm, offering residents and guests unparalleled experiences in every stay.' || E'\n\n' ||
    'The group''s hotels and resorts are managed by world-class operators Hilton and Jaz Hotels, and its portfolio spans Sharm El Sheikh, Sahl Hasheesh, Marsa Alam, Nuweiba and Borg El Arab, with offices in Cairo and operations across the Red Sea and South Sinai.',
  careers_pitch =
    'Find your perfect role and grow with us. Join a team that turns coastlines into landmark destinations — explore current opportunities across Sharm Dreams Group companies and locations, then apply directly to our HR team.',
  headquarters = 'Cairo, Egypt — with operations across the Red Sea and South Sinai.',
  milestones = '[
    {"year": 1987, "title": "Rowad Misr is established", "detail": "Rowad Misr for Tourist Investment (Co. S.A.E.) is founded in February 1987 as an Egyptian public shareholding company; it is today held by Sharm Dreams Holding Company for Tourism & Hotels."},
    {"year": 1996, "title": "The group is founded", "detail": "Sharm Dreams Company for Tourism Investment is established in September 1996 as an Egyptian public shareholding company, with authorized capital of EGP 1,000,000,000."},
    {"year": 1998, "title": "Concord joins the portfolio", "detail": "Concord Company for Tourist Development S.A.E. is established, the vehicle behind Hilton Marsa Alam Nubian Resort."},
    {"year": 2000, "title": "Listed, and on the Red Sea coast", "detail": "Sharm Dreams Company for Tourism Investment lists on the Egyptian Exchange in October 2000, and Rowad Misr for Red Sea Hotels Co. is established to own, manage and operate hotels along the Red Sea coast."},
    {"year": 2007, "title": "A holding company for the hotels", "detail": "Sharm Dreams Holding Company for Tourism & Hotels is established with authorized capital of EGP 700,000,000, and becomes the shareholder of Rowad Misr for Tourist Investment."},
    {"year": 2019, "title": "Abu Dabbab", "detail": "Abu Dabbab Diving Lodge is established near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations."},
    {"year": null, "title": "Today", "detail": "Six portfolio companies and six affiliated businesses — hotels and resorts operated with Hilton and Jaz, plus real-estate developments across Sharm El Sheikh, Sahl Hasheesh, Marsa Alam, Nuweiba and Borg El Arab."}
  ]'::jsonb,
  benefits = '[
    {"title": "Work–Life Balance", "text": "A culture that respects your time and supports wellbeing."},
    {"title": "Career Growth", "text": "Clear paths to advance within a growing group."},
    {"title": "Learning & Development", "text": "Training and mentorship from industry leaders."},
    {"title": "Competitive Benefits", "text": "Rewarding packages that recognise exceptional talent."}
  ]'::jsonb
where slug = 'sharm-dreams-group';

-- ---------------------------------------------------------------------------
-- Sharm Dreams Touristic — the row the site calls Sharm Dreams Company for
-- Tourism Investment, the 1996 parent whose page the group's portfolio opens with.
-- ---------------------------------------------------------------------------
update public.tenants_and_companies
set
  legal_name = 'Sharm Dreams Company for Tourism Investment',
  tagline = 'A legacy of building Egyptian destinations.',
  description =
    'An Egyptian public shareholding company operating in tourism and entertainment — constructing and managing hotels, resorts, villages, commercial centers, and tourism-related real estate.',
  history =
    'Established September 1996 and listed on the Egyptian Exchange in October 2000, the company is an Egyptian public shareholding company operating in tourism and entertainment — constructing and managing hotels, resorts, villages, commercial centers, and tourism-related real estate.' || E'\n\n' ||
    'Its authorized capital is EGP 1,000,000,000 with EGP 529,854,600 issued. Its shareholders are Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, General Mediterranean Holding, Oval Development Corporation and Suez Canal Bank S.A.E., and it holds investments in Sharm Dreams Holding Company for Tourism & Hotels, Sharm Dreams Real Estate Development and Concord Company for Tourist Development S.A.E.' || E'\n\n' ||
    'Its properties are Jaz Sharm Dreams in Sharm El Sheikh, Vacation Club and Cleo Park Sharm El Sheikh, with Cliffs — Curio Collection By Hilton and further projects announced as upcoming.',
  founded_year = 1996,
  ownership_type = 'Public shareholding company (listed on EGX)',
  sort_order = 2
where slug = 'sharm-dreams-touristic';

-- ---------------------------------------------------------------------------
-- Rowad Misr Development — the site's Rowad Misr for Tourist Investment. The
-- names differ, so this mapping is the one judgement in the file: the seeded row
-- is the only row carrying the "Rowad Misr" name, and the site''s own description
-- of that company is about developing tourism infrastructure. The legal_name
-- below states which page the copy came from, so a reader can check it.
-- ---------------------------------------------------------------------------
update public.tenants_and_companies
set
  legal_name = 'Rowad Misr for Tourist Investment (Co. S.A.E.)',
  tagline = 'Developing the tourism infrastructure that Egypt''s destinations run on.',
  description =
    'An Egyptian public shareholding company focused on developing tourism infrastructure — constructing, owning, and managing hotels, resorts, tourist villages, casinos, and related entertainment and real estate projects.',
  history =
    'Established February 1987 and listed on the Egyptian Exchange, Rowad Misr for Tourist Investment (Co. S.A.E.) is an Egyptian public shareholding company focused on developing tourism infrastructure — constructing, owning, and managing hotels, resorts, tourist villages, casinos, and related entertainment and real estate projects.' || E'\n\n' ||
    'Its authorized capital is EGP 250,000,000 with EGP 150,000,000 issued, and it is held by Sharm Dreams Holding Company for Tourism & Hotels. Its subsidiaries are Rowad Misr for Red Sea Hotels Co., Sahl Hasheesh for Touristic Investment, Rowad Dahab for Tourism Development and Rowad El Wahat for Tourism Development.' || E'\n\n' ||
    'Its properties are Jaz Fayrouz Resort in Sharm El Sheikh, TIME Coral Nuweiba Resort, Borg El Arab Beach Resort and Life Co.',
  founded_year = 1987,
  ownership_type = 'Public shareholding company (listed on EGX)',
  milestones = '[
    {"year": 1987, "title": "Established", "detail": "Founded in February 1987 as an Egyptian public shareholding company, later listed on the Egyptian Exchange."},
    {"year": null, "title": "Its hotels today", "detail": "Jaz Fayrouz Resort (Sharm El Sheikh), TIME Coral Nuweiba Resort, Borg El Arab Beach Resort and Life Co."}
  ]'::jsonb,
  sort_order = 4
where slug = 'rowad-misr';

-- ---------------------------------------------------------------------------
-- Sharm Dreams Real Estate — the site gives it one line, as an investment of
-- the 1996 parent, and a section describing the group's real-estate work. No
-- page, no founding year, no capital: none of that is invented here.
-- ---------------------------------------------------------------------------
update public.tenants_and_companies
set
  legal_name = 'Sharm Dreams Real Estate Development',
  tagline = 'Premium developments, commercial centers and residential projects in Egypt.',
  description =
    'The group''s real-estate arm — premium real estate developments, commercial centers and residential projects in Egypt. The company appears on sharmdreamsgroup.com as Sharm Dreams Real Estate Development, an investment of Sharm Dreams Company for Tourism Investment.',
  sort_order = 8
where slug = 'sharm-dreams-realestate';

-- ---------------------------------------------------------------------------
-- The four portfolio companies that had no row.
--
-- Each is a separate legal entity with its own page on the group's site, and
-- none of them is one of the seeded rows above — so these inserts add companies
-- the careers page can show, they do not create a second copy of a name. An
-- opening filed under one of them is a filing the recruiter makes on purpose;
-- nothing here moves a job.
-- ---------------------------------------------------------------------------
insert into public.tenants_and_companies (
  name, legal_name, slug, sector, country, sort_order, website,
  tagline, description, history, founded_year, ownership_type, milestones
)
values
  (
    'Sharm Dreams Holding',
    'Sharm Dreams Holding Company for Tourism & Hotels',
    'sharm-dreams-holding',
    'HOSPITALITY',
    'Egypt',
    3,
    'https://sharmdreamsgroup.com/en/portfolio/sharm-dreams-holding/',
    'Owning, managing and developing hotels, resorts and touristic projects across Egypt.',
    'An Egyptian joint-stock company engaged in tourism investment, development, and hospitality — owning, managing, and developing hotels, resorts, and touristic projects across Egypt with a diversified portfolio and strategic investments.',
    'Established 2007, Sharm Dreams Holding Company for Tourism & Hotels is an Egyptian joint-stock company engaged in tourism investment, development and hospitality — owning, managing and developing hotels, resorts and touristic projects across Egypt with a diversified portfolio and strategic investments.' || E'\n\n' ||
    'Its authorized capital is EGP 700,000,000 with EGP 550,000,000 issued. Its shareholders are Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, Sharm Dreams for Tourism Investment Company, General Mediterranean Holding (GMH), the National Bank of Egypt and Oval Development Corporation, and it holds Rowad Misr for Tourist Investment (Co. S.A.E.).',
    2007,
    'Joint stock company',
    '[{"year": 2007, "title": "Established", "detail": "Founded as the holding company for the group''s tourism and hotel investments, with EGP 550,000,000 issued capital."},
      {"year": null, "title": "What it holds", "detail": "Rowad Misr for Tourist Investment (Co. S.A.E.), the shareholder of Rowad Misr for Red Sea Hotels Co."}]'::jsonb
  ),
  (
    'Rowad Misr for Red Sea Hotels',
    'Rowad Misr for Red Sea Hotels Co.',
    'rowad-misr-red-sea-hotels',
    'HOSPITALITY',
    'Egypt',
    5,
    'https://sharmdreamsgroup.com/en/portfolio/rowad-misr-red-sea/',
    'Hotels and resorts along the Red Sea coast.',
    'A key subsidiary of Rowad Misr for Tourism Investment, established to own, manage, and operate hotels and resorts along the Red Sea coast — central to Egypt''s hospitality sector and tourism infrastructure.',
    'Established 2000 as a key subsidiary of Rowad Misr for Tourism Investment, the company owns, manages and operates hotels and resorts along the Red Sea coast, and is described by the group as central to Egypt''s hospitality sector and tourism infrastructure.' || E'\n\n' ||
    'Its authorized capital is EGP 100,000,000 with EGP 120,000,000 issued, and its shareholder is Rowad Misr for Tourist Investment (Co. S.A.E.). Its property is Old Palace Resort in Sahl Hasheesh.',
    2000,
    null,
    '[{"year": 2000, "title": "Established", "detail": "Founded to own, manage and operate Rowad Misr''s hotels along the Red Sea coast."},
      {"year": null, "title": "Its resort", "detail": "Old Palace Resort — Sahl Hasheesh."}]'::jsonb
  ),
  (
    'Concord for Tourist Development',
    'Concord Company for Tourist Development S.A.E.',
    'concord-tourist-development',
    'HOSPITALITY',
    'Egypt',
    6,
    'https://sharmdreamsgroup.com/en/portfolio/concord/',
    'Developing, building and managing hotels, resorts and touristic facilities.',
    'An Egyptian joint-stock company engaged in tourism and hospitality investment — focused on the development, construction, and management of hotels, resorts, and related touristic facilities.',
    'Established 1998, Concord Company for Tourist Development S.A.E. is an Egyptian joint-stock company engaged in tourism and hospitality investment, focused on the development, construction and management of hotels, resorts and related touristic facilities.' || E'\n\n' ||
    'Its authorized and issued capital is EGP 500,000,000. Its shareholders include Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, General Mediterranean Holding, Oval Development Corporation, Sharm Dreams for Touristic Investment Co., Suez Canal Bank, Misr Insurance Company, Egypt Life Insurance and the National Bank of Egypt, and it holds Abu Dabbab Diving Lodge. Its property is Hilton Marsa Alam Nubian Resort.',
    1998,
    'Joint stock company (S.A.E.)',
    '[{"year": 1998, "title": "Established", "detail": "Founded as a tourism and hospitality development company, fully subscribed at EGP 500,000,000."},
      {"year": null, "title": "Its resorts", "detail": "Hilton Marsa Alam Nubian Resort, and Abu Dabbab Diving Lodge as a subsidiary."}]'::jsonb
  ),
  (
    'Abu Dabbab Diving Lodge',
    'Abu Dabbab Diving Lodge',
    'abu-dabbab-diving-lodge',
    'HOSPITALITY',
    'Egypt',
    7,
    'https://sharmdreamsgroup.com/en/portfolio/abu-dabbab-lodge/',
    'Eco-tourism and marine adventure near Marsa Alam.',
    'A Red Sea hospitality property near Marsa Alam in one of the world''s most renowned diving and snorkeling destinations — focused on eco-tourism and marine adventure, operating under the group''s central board for consistent quality and operational excellence.',
    'Established 2019, Abu Dabbab Diving Lodge is a Red Sea hospitality property near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations, focused on eco-tourism and marine adventure and operating under the group''s central board for consistent quality and operational excellence.' || E'\n\n' ||
    'Its authorized capital is EGP 490,000,000 with EGP 49,544,000 issued. Its shareholders are Dr. Hamada Mohamed Kamal El Din Abu El Enein, Concord Company for Tourist Development Co. and Bautex Misr Co.',
    2019,
    null,
    '[{"year": 2019, "title": "Established", "detail": "The lodge opens near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations."}]'::jsonb
  )
on conflict (slug) do nothing;

-- The affiliated businesses, for the record: Virgin Gates For Technology,
-- Godonia Travel, Investay, @40, Misr For Investment and Development (MID) and
-- Cliffs — Curio Collection By Hilton. They are deliberately NOT inserted as
-- company rows — affiliation is not ownership, and a recruiter filing an opening
-- under an affiliated brand would be claiming a hiring entity the group's own
-- page does not present as one.

-- PostgREST caches the shape of the table; the columns arrived with 027, but a
-- reader must still be told the rows changed underneath its schema cache.
notify pgrst, 'reload schema';
