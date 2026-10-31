// Pre-flight check for the two KVM2 env files:
//   docker/.env.kvm2  -> becomes docker/.env   (Compose interpolation)
//   .env.kvm2.local   -> becomes .env.local    (app env_file)
//
// It answers one question: "will this stack come up and behave on the VPS?" —
// every value is read, none is printed. Output is key names, verdicts and
// character counts only, so running it on the server leaks nothing to a log.
//
//   node scripts/check-kvm2-env.mjs
//
// Exit code 1 when anything required is missing or malformed.
import fs from 'node:fs';

const root = process.cwd();
const COMPOSE = 'docker/.env.kvm2';
const APP = '.env.kvm2.local';

function parse(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

for (const f of [COMPOSE, APP]) {
  if (!fs.existsSync(`${root}/${f}`)) {
    console.error(`${f} is missing. Generate it with: node scripts/make-kvm2-env.mjs`);
    process.exit(1);
  }
}

const compose = parse(`${root}/${COMPOSE}`);
const app = parse(`${root}/${APP}`);

let failed = 0;
let warned = 0;

const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => {
  failed += 1;
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg) => {
  warned += 1;
  console.log(`  WARN  ${msg}`);
};

/** Present, non-empty, and at least `min` characters. */
function need(env, key, where, min = 1) {
  const v = env[key];
  if (!v) return bad(`${key} is empty/missing in ${where}`);
  if (v.length < min) return bad(`${key} in ${where} is ${v.length} chars, needs >= ${min}`);
  ok(`${key} (${v.length} chars)`);
}

function shape(env, key, where, test, describe) {
  const v = env[key];
  if (!v) return bad(`${key} is empty/missing in ${where}`);
  if (!test(v)) return bad(`${key} in ${where} is not ${describe}`);
  ok(`${key} is ${describe}`);
}

console.log(`\n== ${COMPOSE} (Compose interpolation) ==`);
need(compose, 'LOCAL_DB_PASSWORD', COMPOSE, 24);
need(compose, 'LOCAL_PGRST_PASSWORD', COMPOSE, 24);
need(compose, 'AUTH_JWT_SECRET', COMPOSE, 32);
need(compose, 'AUTH_TOKEN_ISSUER', COMPOSE);
need(compose, 'AUTH_TOKEN_AUDIENCE', COMPOSE);
need(compose, 'CRON_SECRET', COMPOSE, 32);
need(compose, 'LOCAL_STAFF_PASSWORD', COMPOSE, 12);
need(compose, 'STAFF_OWNER_EMAIL', COMPOSE);
shape(compose, 'STAFF_OWNER_EMAIL', COMPOSE, (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'an email address');
if (/@[^@]+\.test$/i.test(compose.STAFF_OWNER_EMAIL ?? '')) {
  warn('STAFF_OWNER_EMAIL is a .test fixture address — fine on a laptop, use a real one in production.');
}
need(compose, 'NGINX_PORT', COMPOSE);
need(compose, 'UPLOADS_ROOT', COMPOSE);
shape(compose, 'SDG_DOMAIN', COMPOSE, (v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v), 'a bare domain');
shape(compose, 'ACME_EMAIL', COMPOSE, (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'an email address');
shape(compose, 'APP_URL_PUBLIC', COMPOSE, (v) => v.startsWith('https://'), 'an https origin');
shape(compose, 'COOKIE_SECURE', COMPOSE, (v) => v === 'true', 'the literal "true"');

if (compose.APP_URL) {
  // cron would otherwise stop reaching the app by service name.
  warn('APP_URL is set here; it overrides cron\'s http://app:3000 default. Use APP_URL_PUBLIC instead.');
}
if (compose.AUTH_DB_URL || compose.REST_BASE_URL) {
  bad('AUTH_DB_URL / REST_BASE_URL must not be set here — docker-compose.yml injects the in-network forms.');
}
if (compose.AUTH_TOKEN_AUDIENCE !== 'sdg_prod') {
  warn(`AUTH_TOKEN_AUDIENCE is not "sdg_prod" — fine, as long as it stays stable across redeploys.`);
}

console.log(`\n== ${APP} (app runtime env) ==`);
need(app, 'APP_URL', APP);
need(app, 'NEXT_PUBLIC_APP_URL', APP);
need(app, 'SETTINGS_ENCRYPTION_KEY', APP, 32);
shape(app, 'APP_URL', APP, (v) => v.startsWith('https://'), 'an https origin');
shape(app, 'NEXT_PUBLIC_APP_URL', APP, (v) => v.startsWith('https://'), 'an https origin');

const aiKeys = ['OPENROUTER_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY', 'OPENCODE_API_KEY',
  'QODER_API_KEY', 'NVIDIA_API_KEY', 'CLOUDFLARE_AI_API_TOKEN'];
const aiPresent = aiKeys.filter((k) => app[k]);
if (aiPresent.length === 0) bad(`no AI provider key in ${APP} — screening, grading and the assistant will refuse to run`);
else ok(`${aiPresent.length} AI provider key(s): ${aiPresent.join(', ')}`);
if (app.CLOUDFLARE_AI_API_TOKEN && !app.CLOUDFLARE_AI_ACCOUNT_ID) {
  warn('CLOUDFLARE_AI_API_TOKEN is set without CLOUDFLARE_AI_ACCOUNT_ID, so Workers AI cannot be used.');
}
if ((app.SMTP_HOST && !(app.SMTP_USER && app.SMTP_PASSWORD)) || (!app.SMTP_HOST && app.SMTP_USER)) {
  warn('SMTP is half-configured (needs HOST + USER + PASSWORD); email dispatch will fail.');
} else if (app.SMTP_HOST) {
  ok('SMTP relay configured');
} else {
  warn('no SMTP relay — invitation and notification email will not send until Settings carries one.');
}
if (app.WHATSAPP_TOKEN && !app.WHATSAPP_PHONE_NUMBER_ID) {
  warn('WHATSAPP_TOKEN is set without WHATSAPP_PHONE_NUMBER_ID, so no outbound message can be addressed.');
} else if (app.WHATSAPP_TOKEN) {
  ok('WhatsApp outbound configured');
} else {
  warn('no WhatsApp token — the WhatsApp channel stays idle; nothing breaks.');
}

// A missing encryption key is the one gap that fails silently until someone
// opens Settings -> API keys, so it is called out separately above (need()).
const carried = Object.keys(app).length;
console.log(`\n${failed === 0 ? 'RESULT: ready to deploy' : 'RESULT: fix the FAIL lines above'}` +
  `  (${failed} failed, ${warned} warning(s), ${carried} keys in ${APP})`);
process.exit(failed === 0 ? 0 : 1);
