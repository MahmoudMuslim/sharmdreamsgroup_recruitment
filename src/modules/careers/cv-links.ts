/**
 * Access to the CV a candidate uploaded.
 *
 * CVs are bytes on the disk store under `candidate-cvs` (the bucket named in
 * migration 010; the vendor's `storage` schema that used to hold them was retired
 * in 4458cb7).
 *
 * What authorises a reader is NOT this file. The header here used to claim the
 * link is minted "on the session client: the storage policy is what authorises a
 * reader", and both halves stopped being true with that commit — there is no
 * storage policy left to enforce, and the session client passed in as an argument
 * was never read. So the argument is gone, and the real gate is stated plainly:
 * each caller selects `applications.cv_file_path` through the RLS-scoped session
 * client (`src/app/(admin)/candidates/dossier-actions.ts`,
 * `src/app/(admin)/candidates/[id]/profile.ts`,
 * `src/app/(admin)/jobs/applicant-actions.ts`), so a path a session may not see
 * never reaches this module.
 *
 * What this mints is a short-lived HMAC capability — `CV_URL_LIFETIME_SECONDS` of
 * it, over `src/lib/files/signed-link.ts` — and nothing more. Not even the key is
 * secret: `mintFileLink` base64url-encodes `{bucket, path, …}` into the token the
 * browser is handed at `/api/files/f/<token>` (`src/lib/files/disk-store.ts:183`),
 * so anyone holding a live link can decode which object it opens. That is what a
 * bearer URL is. The controls are the expiry and the RLS-scoped read that minted
 * it, not the obscurity of the path.
 */

import { getFileStore } from "@/lib/files/store";

const CV_BUCKET = "candidate-cvs";

/** Signed links are read once, immediately after the panel opens. */
const CV_URL_LIFETIME_SECONDS = 15 * 60;

export interface CvLinks {
  /** Short-lived link that opens the original file in the browser. */
  cv_url: string | null;
  /** Same file with a `Content-Disposition`, so the browser saves it. */
  cv_download_url: string | null;
}

/**
 * The upload route stores `applications/<jobId>/<uuid>-<original name>`; the
 * random prefix is ours, so it is stripped to show the candidate their own
 * filename rather than a storage key.
 */
export function cvDisplayName(path: string | null): string | null {
  if (!path) return null;
  const leaf = path.split("/").pop() ?? "";
  const stripped = leaf.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    ""
  );
  return stripped || leaf || null;
}

/**
 * Mints the view and download links for one stored CV.
 *
 * Takes a path and nothing else: the caller already decided, through RLS, that
 * this session may read the row that names it. Signing is a stat plus an HMAC, so
 * there is no client to hand.
 *
 * Returns nulls rather than throwing when the file cannot be signed — a CV
 * uploaded before the bucket existed is a missing attachment, not a failed page.
 */
export async function createCvLinks(path: string): Promise<CvLinks> {
  const name = cvDisplayName(path) ?? "cv";

  const files = await getFileStore();
  const [view, download] = await Promise.all([
    files.signedUrl({ bucket: CV_BUCKET, path, seconds: CV_URL_LIFETIME_SECONDS }),
    files.signedUrl({ bucket: CV_BUCKET, path, seconds: CV_URL_LIFETIME_SECONDS, download: name }),
  ]);

  if (!view.url) {
    console.error(
      "[careers] CV link failed:",
      view.error ?? download.error ?? "unknown"
    );
    return { cv_url: null, cv_download_url: null };
  }

  return { cv_url: view.url, cv_download_url: download.url ?? null };
}
