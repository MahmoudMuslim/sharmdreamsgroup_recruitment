import { Client } from "pg";

const c = new Client({
  connectionString:
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
    encodeURIComponent(process.env.SB_DB) +
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const companies = await c.query(
  "select id, name, slug, is_active from tenants_and_companies order by sort_order"
);
console.log("companies in DB:");
companies.rows.forEach((r) =>
  console.log(`  ${r.id}  ${r.name}  slug=${r.slug}  active=${r.is_active}`)
);

const jobs = await c.query(
  "select id, title, tenant_id from job_openings order by created_at desc limit 5"
);
console.log("\nexisting jobs (tenant_id must exist in companies):");
jobs.rows.forEach((r) => console.log(`  ${r.title}  tenant_id=${r.tenant_id}`));

// Are the FK ids on job_openings dangling?
const dangling = await c.query(
  "select j.id, j.title, j.tenant_id from job_openings j " +
    "left join tenants_and_companies c on c.id = j.tenant_id where c.id is null"
);
console.log("\ndangling job tenant_ids:", dangling.rows.length);
dangling.rows.forEach((r) => console.log(`  ${r.title} -> ${r.tenant_id}`));

const attempts = await c.query(
  "select a.id, a.template_id, t.name from candidate_attempts a " +
    "left join assessment_templates t on t.id = a.template_id where t.id is null"
);
console.log("\nattempts with dangling template_id:", attempts.rows.length);

await c.end();