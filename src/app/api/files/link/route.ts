import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFileStore } from "@/lib/files/store";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { bucketInfo, displayName, isStoredPath } from "@/app/(admin)/files/file-browser-types";
import { objectMetadata } from "@/app/(admin)/files/storage-list";

/** Long enough to open a PDF or play a recording, short enough to be worthless later. */
const LINK_LIFETIME_SECONDS = 15 * 60;

/**
 * Turns a storage key into a short-lived link and redirects to it.
 *
 * The browser never receives a signed URL for another staff member's session:
 * every open goes through this route, which checks the session and the
 * permission first, and the link it hands back expires on its own.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const bucket = bucketInfo(searchParams.get("bucket"));
  const path = searchParams.get("path") ?? "";
  const wantsDownload = searchParams.get("mode") === "download";

  if (!bucket || !isStoredPath(path)) {
    return NextResponse.json({ error: "Unknown file." }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent("/files")}`, request.url)
    );
  }

  if (!(await hasPermissionForUser("candidates.read"))) {
    return NextResponse.json(
      { error: "Opening stored files needs the View candidates permission." },
      { status: 403 }
    );
  }

  /*
   * An object keeps whatever content type its upload declared, so only formats
   * a browser cannot execute inline are opened directly. Anything else is
   * offered as a download instead of being rendered on this origin.
   */
  const { mimeType } = await objectMetadata(bucket.key, path);
  const inline = !wantsDownload && isSafeToView(mimeType);

  const supabase = await createSupabaseServerClient();
  const files = await getFileStore(supabase);
  const { url, error } = await files.signedUrl({
    bucket: bucket.key,
    path,
    seconds: LINK_LIFETIME_SECONDS,
    // The inline branch sends no disposition; only a download asks for one.
    download: inline ? undefined : displayName(path),
  });

  if (error || !url) {
    console.error("[files] signed link refused:", error ?? "no url", path);
    return NextResponse.json({ error: "That file is no longer in storage." }, { status: 404 });
  }

  return NextResponse.redirect(url, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}

function isSafeToView(mimeType: string | null): boolean {
  if (!mimeType) return false;
  const type = mimeType.toLowerCase();
  return (
    type === "application/pdf" ||
    type === "text/plain" ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type.startsWith("image/")
  );
}
