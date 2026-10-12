import { Client } from "pg";

const c = new Client({
  connectionString:
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
    encodeURIComponent(process.env.SB_DB) +
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const cons = await c.query(
  "select conname, pg_get_constraintdef(oid) as def from pg_constraint " +
    "where conrelid = 'job_openings'::regclass order by conname"
);
console.log("job_openings constraints:");
cons.rows.forEach((r) => console.log(`  ${r.conname}\n      ${r.def}`));

// Try the exact insert the action performs, as superuser.
const tenant = "11111111-1111-1111-1111-111111111101";
try {
  const r = await c.query(
    `insert into job_openings (tenant_id, title, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, status)
     values ($1, $2, $3, 'HOSPITALITY', $4, 'FULL_TIME', $5, $6::jsonb, 1500, 2200, 'DRAFT')
     returning id, title`,
    [
      tenant,
      "Guest Experience Lead (debug)",
      "Front Office & Guest Relations",
      "Sharm El Sheikh",
      "Owns guest satisfaction.",
      JSON.stringify(["5+ years hospitality"]),
    ]
  );
  console.log("\ninsert OK:", JSON.stringify(r.rows[0]));
  await c.query("delete from job_openings where id = $1", [r.rows[0].id]);
  console.log("cleaned up");
} catch (e) {
  console.log("\ninsert FAILED:", e.code, e.message);
  console.log("detail:", e.detail);
}

await c.end();