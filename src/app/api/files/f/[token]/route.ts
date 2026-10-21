/*
 * Serves one object, authorised by nothing but the token in the URL.
 *
 * This is the door that replaces `storage.createSignedUrl` + the vendor's CDN.
 * There is deliberately no session check here: a link is minted behind one (the
 * File Manager's `/api/files/link` checks staff identity and the
 * `candidates.read` permission; the assessment and CV panels sit behind their
 * own guards), and what it hands out is a bearer of exactly one file for exactly
 * one way of opening it. That is also why the token carries its own expiry and
 * why the minted lifetime is capped at an hour — the URL is the credential, and
 * a URL is copied, pasted into chat, and kept in browser history.
 *
 * Two things the vendor gave us for free and this file has to do itself:
 *
 * 1. **Range requests.** A pitch recording is played in a `<video>` tag, and the
 *    player seeks by asking for byte ranges. Serve the whole file every time and
 *    scrubbing either fails or re-downloads the clip; a staff reviewer then
 *    hears a recording that will not move past the first seconds. So `206` with
 *    `Content-Range` is the load-bearing part of this handler, not a nicety.
 * 2. **The content type.** It comes from the token, which took it from the
 *    `files` row at mint time, because a directory entry has no type of its own.
 *    A wrong type is not cosmetic: `video/webm` labelled as octet-stream will not
 *    play, and an SVG labelled as an image is a script running on our origin — so
 *    the inline decision was already made in `signed-link.ts` and is honoured,
 *    never re-derived, here.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveObjectPath, displayName } from "@/lib/files/paths";
import { verifyFileLink, contentDisposition } from "@/lib/files/signed-link";

/** Candidate files are PII. Nothing of this response belongs in a cache. */
const CACHE = "private, no-store, max-age=0, must-revalidate";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serve(request, await params, true);
}

/**
 * HEAD is the same answer without the bytes.
 *
 * Not decoration: `<video>` and `<audio>` probe a source to learn its length and
 * type before they fetch a range, and a 405 on that probe is what makes a
 * recording show as unplayable in Safari while working everywhere else.
 */
export async function HEAD(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serve(request, await params, false);
}

async function serve(request: Request, { token }: { token: string }, withBody: boolean) {
  const link = verifyFileLink(token);
  if (!link) return missing("link");

  // `resolveObjectPath` refuses a key that resolves outside its bucket, and a
  // token that was minted by an older build is exactly the thing that check is
  // for: the signature proves we signed it, not that this build would sign it.
  let file: string;
  try {
    file = resolveObjectPath(link.bucket, link.path);
  } catch {
    return missing("path");
  }

  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) return missing("file");
  const size = Number(info.size);

  const headers = new Headers({
    "Content-Type": link.mime ?? (link.inline ? "text/plain" : "application/octet-stream"),
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE,
    "X-Content-Type-Options": "nosniff",
  });
  if (!link.inline) {
    headers.set("Content-Disposition", contentDisposition(link.filename ?? displayName(link.path)));
  }

  const range = withBody ? parseRange(request.headers.get("range"), size) : "none";
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  // `size - 1` for a zero-byte object gives `end < start`, which the length below
  // clamps to 0 rather than reporting the single byte `[0,0]` would send.
  const [start, end] = range === "none" ? [0, size - 1] : [range.start, range.end];
  const length = Math.max(end - start + 1, 0);
  headers.set("Content-Length", String(length));
  if (range !== "none") headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  if (!withBody) return new Response(null, { status: range === "none" ? 200 : 206, headers });
  if (length === 0) return new Response(null, { status: 200, headers });

  // The stream is opened after the token, the containment and the file type have
  // all been agreed, so nothing above can leave a half-sent response behind.
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status: range === "none" ? 200 : 206, headers });
}

/**
 * One answer for "no": an expired link, a forged one, a deleted file and a
 * well-formed key that was never uploaded are indistinguishable to the client.
 *
 * They are distinguishable in the code, and that difference is exactly what an
 * attacker probes for — "404 but 410 when the token parses" tells them the
 * signing scheme is worth attacking. The `reason` is the only place that
 * distinction survives: it goes to the server log, never to the response, and it
 * names the branch and nothing else. Not the token — a live bearer credential has
 * no business in a log file that outlives the link.
 */
function missing(reason: "link" | "path" | "file") {
  console.warn("[files] link refused:", reason);
  return new Response(JSON.stringify({ error: "That link has expired or the file is gone." }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": CACHE },
  });
}

/**
 * The one range a media player asks for, or none at all.
 *
 * Only single ranges are honoured, and anything else falls back to the whole
 * body rather than failing: a multi-range request needs a
 * `multipart/byteranges` response with a boundary, no player in this portal sends
 * one, and serving 200 is a legal decline. A malformed header is treated the same
 * way — a byte range is an optimisation, and the wrong answer to it must not be
 * "this file cannot be opened".
 */
function parseRange(header: string | null, size: number): { start: number; end: number } | "none" | "unsatisfiable" {
  if (!header || size === 0) return "none";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "none";

  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return "none";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]) - 1, size - 1);
  return end < start ? "unsatisfiable" : { start, end };
}
