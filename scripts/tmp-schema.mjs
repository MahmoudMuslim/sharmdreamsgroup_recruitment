import { Client } from "pg";

const c = new Client({
  connectionString:
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
    encodeURIComponent(process.env.SB_DB) +
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

await c.connect();

for (const t of ["job_openings", "onboarding_plans", "assessment_templates"]) {
  const r = await c.query(
    "select column_name, data_type, udt_name, is_nullable, column_default " +
      "from information_schema.columns where table_name = $1 order by ordinal_position",
    [t]
  );
  console.log(`\n${t}:`);
  r.rows.forEach((x) =>
    console.log(
      `  ${x.column_name.padEnd(22)} ${(x.udt_name || x.data_type).padEnd(18)} null=${x.is_nullable} def=${x.column_default ?? ""}`
    )
  );
}

// Enums that matter for forms
const enums = await c.query(
  "select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as vals " +
    "from pg_type t join pg_enum e on e.enumtypid = t.oid " +
    "where t.typname in ('job_status','employment_type','question_type','plan_status','application_stage') " +
    "group by t.typname"
);
console.log("\nenums:");
enums.rows.forEach((r) => console.log(`  ${r.typname}: ${r.vals}`));

await c.end();