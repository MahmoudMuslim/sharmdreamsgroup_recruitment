import { Client } from "pg";
import { readFileSync } from "fs";

const file = process.argv[2];
const sql = readFileSync(file, "utf8");

const c = new Client({
  connectionString:
    "postgresql://postgres.lbxdeceropsxwohnzinl:" +
    encodeURIComponent(process.env.SB_DB) +
    "@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  await c.query(sql);
  console.log("OK  " + file);
} catch (e) {
  console.log("FAIL  " + file);
  console.log("      " + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
} finally {
  await c.end();
}