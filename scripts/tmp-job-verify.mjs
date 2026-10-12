import { Client } from "pg";

const c = new Client({
  connectionString:
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
    encodeURIComponent(process.env.SB_DB) +
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const r = await c.query(
  "select j.id, j.title, j.department, j.location, j.status, j.min_salary_usd, j.max_salary_usd, " +
    "j.requirements, j.created_by, p.full_name as created_by_name, t.name as company " +
    "from job_openings j " +
    "left join user_profiles p on p.id = j.created_by " +
    "left join tenants_and_companies t on t.id = j.tenant_id " +
    "where j.title = 'Guest Experience Lead'"
);
console.log(JSON.stringify(r.rows[0], null, 2));

// Clean up the verification row.
await c.query("delete from job_openings where title = 'Guest Experience Lead'");
console.log("\ncleaned up");

await c.end();