/* src/lib/files/upload-guard.ts
 * Refuses an oversize multipart body before it is read into memory.
 *
 * Every upload door in this app buffers the whole body first — `await
 * request.formData()`, then a size check on the File — so the check only runs
 * after the bytes are already in Node. That was harmless while the front door
 * refused at 25 MB; `docker/nginx/nginx.conf` now allows 52 MB through so the
 * app's own 50 MB video limit stays the one a candidate reads, which means a
 * 52 MB body reaches Node and gets buffered before anything objects. This is the
 * door that stops it: the transport ceiling and the app ceiling can only agree
 * if something looks at `Content-Length` before the buffer.
 *
 * What this is NOT: `Content-Length` is absent on a chunked upload (`curl -T`,
 * some fetch callers), and a client that types a small length and streams more
 * is lying. So this bounds the ordinary case and nothing else — every door keeps
 * its post-buffer check, unchanged, and that check stays the real one.
 *
 * The envelope is why the ceiling gets a little room. A multipart body is the
 * file plus its part headers and boundaries: measured across the five doors with
 * `node --input-type=module -e` (build a `FormData`, serialize it through
 * `new Request(url, { method: "POST", body: form }).arrayBuffer()` and subtract
 * the file size), the overhead is 182 bytes for `video`, 295 for `file` + `jobId`,
 * 397 for `file` + `applicationId` + `bucket`, 420 for `jobId` + `link` + `file`.
 * Refusing at exactly `maxBytes` would turn a file 300 bytes under the limit into
 * a 413 from this door while the post-buffer door would have accepted it, and two
 * doors that disagree about what is acceptable is a bug a candidate hits. So the
 * first line refuses only bodies that could not possibly pass the real check.
 */
import { NextResponse } from "next/server";

/** The largest measured multipart envelope above, rounded up to the next KiB. */
const MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 1_024;

/**
 * A 413 for a body that is too big to have been declared, `null` for anything
 * else — including a request with no `Content-Length` at all, which is the
 * chunked case this line cannot see.
 *
 * `message` is the whole body's `error` sentence. Each door passes its own so the
 * words a candidate reads are the ones that door has always used: this helper says
 * "That file is larger than N MB." for the four CV/attachment doors by default,
 * which is what `cvSizeError()` (`src/modules/careers/cv-rules.ts:70`) and the
 * staff upload route already return, and the video door overrides it with its own
 * "Video exceeds the 50MB limit".
 */
export function oversizeUploadResponse(
  request: Request,
  maxBytes: number,
  message?: string
): NextResponse | null {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return null;
  if (declared <= maxBytes + MULTIPART_ENVELOPE_ALLOWANCE_BYTES) return null;
  const mb = Math.round(maxBytes / (1024 * 1024));
  return NextResponse.json(
    { error: message ?? `That file is larger than ${mb} MB.` },
    { status: 413 }
  );
}
