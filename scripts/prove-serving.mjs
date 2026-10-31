/* scripts/prove-serving.mjs
 *
 * Live proof of the byte door: it mints real links and asks the running stack,
 * over HTTP, for the bytes they name.
 *
 *   node scripts/prove-serving.mjs
 *   node scripts/prove-serving.mjs --base http://localhost:3000
 *
 * The unit proof (`files:links`, 76 checks) shows a token cannot be forged. This
 * shows the rest of it: that the volume is mounted where `paths.ts` looks, that
 * every extracted object is reachable through its own link, that a `206` carries
 * the exact slice a video player asked for, and that the content type and the
 * disposition travel from the `files` row to the browser unchanged.
 *
 * Tokens are minted here with the same `AUTH_JWT_SECRET` the app container reads
 * out of docker/.env, so a passing check proves the two halves agree — a
 * different secret would 404 everything, which is the failure this catches.
 * Nothing is written: every request is a read, and the only refusal expected is
 * the one a forged or absent object must answer.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintFileLink } from "../src/lib/files/signed-link.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const BASE = (flagValue("base") ?? process.env.PROVE_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const secret = (() => {
  for (const line of readFileSync(join(ROOT, "docker", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^AUTH_JWT_SECRET=(.*)$/);
    if (m && m[1].trim().length >= 32) return m[1].trim();
  }
  console.error("docker/.env has no AUTH_JWT_SECRET of 32+ characters.");
  process.exit(1);
})();
process.env.AUTH_JWT_SECRET = secret;

const manifest = JSON.parse(
  readFileSync(join(ROOT, "docker", "data", "vendor-files", "manifest.json"), "utf8")
);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(object, { seconds = 120, download, mime, range, method = "GET" } = {}) {
  const token = mintFileLink({
    bucket: object.bucket,
    path: object.path,
    seconds,
    ...(download === undefined ? {} : { download }),
    ...(mime === undefined ? { mime: object.mimeType } : { mime }),
  });
  const res = await fetch(`${BASE}/api/files/f/${token}`, {
    method,
    ...(range === undefined ? {} : { headers: { range } }),
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body, token };
}

/** The bytes this object is supposed to be, straight from the extracted copy. */
const source = (object) =>
  readFileSync(resolve(ROOT, object.localFile.replace(/\\/g, "/").replace(/^\.\.(\/|\\)/, "")));

async function main() {
  let live;
  try {
    live = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(4000) });
  } catch (error) {
    console.error(`Nothing answers on ${BASE} — is the stack up? (${error.message})`);
    process.exit(1);
  }
  if (!live.ok) {
    console.error(`${BASE}/healthz answered ${live.status} — the app is not healthy.`);
    process.exit(1);
  }
  console.log(`Serving proof against ${BASE}\n`);

  const pdf = manifest.objects.find((o) => o.bucket === "candidate-cvs" && o.bytes > 50000);
  const small = manifest.objects.find((o) => o.bucket === "candidate-cvs" && o.bytes < 50000);
  const video = manifest.objects.find((o) => o.bucket === "candidate-videos");
  const resume = manifest.objects.find((o) => o.bucket === "resumes");
  check("the manifest has a CV, a small CV, a video and a resume to probe",
    Boolean(pdf && small && video && resume));
  if (!pdf || !small || !video || !resume) process.exit(1);

  /* --- 1. a whole object, byte for byte ----------------------------------- */
  {
    const { res, body } = await get(pdf);
    check("CV: 200", res.status === 200, `got ${res.status}`);
    check("CV: content type from the files row",
      res.headers.get("content-type") === "application/pdf", res.headers.get("content-type"));
    check("CV: every byte matches the extraction",
      body.length === pdf.bytes && sha256(body) === pdf.sha256,
      `${body.length} B of ${pdf.bytes}`);
    check("CV: Content-Length is the real size",
      res.headers.get("content-length") === String(pdf.bytes), res.headers.get("content-length"));
    check("CV: a PDF is safe to view inline, so no disposition",
      res.headers.get("content-disposition") === null, res.headers.get("content-disposition"));
    check("CV: PII is never cacheable",
      res.headers.get("cache-control")?.includes("no-store"), res.headers.get("cache-control"));
    check("CV: the type is not sniffable",
      res.headers.get("x-content-type-options") === "nosniff");
    check("CV: ranges are offered", res.headers.get("accept-ranges") === "bytes");
  }

  /* --- 2. HEAD is the probe a media player sends -------------------------- */
  {
    const { res, body } = await get(video, { method: "HEAD" });
    check("video: HEAD answers 200, not 405", res.status === 200, `got ${res.status}`);
    check("video: HEAD carries the size and type",
      res.headers.get("content-length") === String(video.bytes) &&
        res.headers.get("content-type") === "video/webm",
      `${res.headers.get("content-length")} / ${res.headers.get("content-type")}`);
    check("video: HEAD sends no body", body.length === 0, `${body.length} B`);
  }

  /* --- 3. ranges: the part that makes a recording seekable ---------------- */
  {
    const original = source(video);
    const cases = [
      { header: "bytes=0-999", start: 0, end: 999 },
      { header: "bytes=1000-1999", start: 1000, end: 1999 },
      // One byte, asked for the way RFC 7233 spells it: the end is inclusive, so
      // a handler that reads it as a length refuses this instead of serving it.
      { header: "bytes=5-5", start: 5, end: 5 },
      { header: `bytes=${Math.floor(original.length / 2)}-`, start: Math.floor(original.length / 2), end: original.length - 1 },
      { header: "bytes=-500", start: original.length - 500, end: original.length - 1 },
      { header: `bytes=0-${original.length + 99}`, start: 0, end: original.length - 1 },
    ];
    for (const c of cases) {
      const { res, body } = await get(video, { range: c.header });
      const want = original.subarray(c.start, c.end + 1);
      const expected = `bytes ${c.start}-${c.end}/${original.length}`;
      check(`range ${c.header}: 206`, res.status === 206, `got ${res.status}`);
      check(`range ${c.header}: ${expected}`, res.headers.get("content-range") === expected,
        res.headers.get("content-range"));
      check(`range ${c.header}: the exact slice`,
        body.length === want.length && sha256(body) === sha256(want), `${body.length} B`);
    }
    const past = await get(video, { range: `bytes=${original.length + 10}-${original.length + 20}` });
    check("range past the end: 416", past.res.status === 416, `got ${past.res.status}`);
    check("range past the end: says how big the file is",
      past.res.headers.get("content-range") === `bytes */${original.length}`,
      past.res.headers.get("content-range"));
    const multi = await get(video, { range: "bytes=0-10,20-30" });
    check("a multi-range request is declined to a full 200",
      multi.res.status === 200 && multi.body.length === original.length,
      `${multi.res.status} / ${multi.body.length} B`);
  }

  /* --- 4. disposition and the inline safety rule -------------------------- */
  {
    const dl = await get(small, { download: "Mahmoud_Mostafa_CV_English.pdf" });
    check("download: offered as an attachment",
      dl.res.headers.get("content-disposition")?.startsWith("attachment;"),
      dl.res.headers.get("content-disposition"));
    check("download: still the same bytes", sha256(dl.body) === small.sha256);

    const unsafe = await get(small, { mime: "text/html" });
    check("an executable type is never inline",
      unsafe.res.headers.get("content-disposition")?.startsWith("attachment;") &&
        unsafe.res.status === 200,
      `${unsafe.res.status} / ${unsafe.res.headers.get("content-disposition")}`);

    const quoted = await get(small, { download: 'evil"; filename="x.txt' });
    const disposition = quoted.res.headers.get("content-disposition") ?? "";
    const quotes = (disposition.match(/"/g) ?? []).length;
    check("a filename cannot add a header parameter",
      quotes === 2 && !disposition.includes("\\"),
      disposition);
  }

  /* --- 5. every extracted object answers its own link --------------------- */
  {
    let served = 0;
    const wrong = [];
    for (const object of manifest.objects) {
      const { res, body } = await get(object, { seconds: 30 });
      if (res.status === 200 && sha256(body) === object.sha256) served += 1;
      else wrong.push(`${object.bucket}/${object.path.slice(-24)}:${res.status}`);
    }
    check(`all ${manifest.objects.length} extracted objects serve their bytes`,
      served === manifest.objects.length, `missed: ${wrong.join(", ") || "none"}`);
  }

  /* --- 6. refusals: forged, absent, and indistinguishable ----------------- */
  {
    const { token } = await get(pdf, { seconds: 30 });
    const last = token.at(-1);
    const forged = `${token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    const res = await fetch(`${BASE}/api/files/f/${forged}`);
    const body = await res.json().catch(() => null);
    check("a token with one character changed is refused", res.status === 404, `got ${res.status}`);
    check("the refusal is the uniform message",
      body?.error === "That link has expired or the file is gone.", JSON.stringify(body));

    const gone = await fetch(`${BASE}/api/files/f/${mintFileLink({
      bucket: "candidate-cvs",
      path: "applications/never-uploaded.pdf",
      seconds: 30,
      mime: "application/pdf",
    })}`);
    check("a well-formed key with no object is refused the same way",
      gone.status === 404, `got ${gone.status}`);

    const empty = await fetch(`${BASE}/api/files/f/not-a-token-at-all`);
    check("garbage in the token slot is refused", empty.status === 404, `got ${empty.status}`);
  }

  console.log(`\n${pass} check(s) passed, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
