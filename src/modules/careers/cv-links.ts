/**
 * Access to the CV a candidate uploaded.
 *
 * CVs live in the private `candidate-cvs` bucket (migration 010), readable only
 * by staff, so a link is minted per request on the session client: the storage
 * policy is what authorises a reader, the URL expires, and the bucket path never
 * reaches a browser.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFileStore } from "@/lib/files/store";

type StaffClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
 * Returns nulls rather than throwing when the file cannot be signed — a CV
 * uploaded before the bucket existed is a missing attachment, not a failed page.
 */
export async function createCvLinks(supabase: StaffClient, path: string): Promise<CvLinks> {
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
