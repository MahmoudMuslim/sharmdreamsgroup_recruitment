import { NextResponse, type NextRequest } from "next/server";
import { getFileStore } from "@/lib/files/store";
import { getSessionUser, isStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { bucketInfo } from "@/app/(admin)/files/file-browser-types";
import { displayName, isStoredPath } from "@/lib/files/paths";

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

  const files = await getFileStore();
  const { url, error } = await files.signedUrl({
    bucket: bucket.key,
    path,
    seconds: LINK_LIFETIME_SECONDS,
    // Only an explicit download asks for one. Anything a browser cannot safely
    // render inline is offered as a download by the link itself, which reads the
    // stored content type — the rule is in `signed-link.ts`, not here, so a mint
    // site cannot forget it.
    download: wantsDownload ? displayName(path) : undefined,
  });

  if (error || !url) {
    console.error("[files] signed link refused:", error ?? "no url", path);
    return NextResponse.json({ error: "That file is no longer in storage." }, { status: 404 });
  }

  // The store mints a same-origin path, because a link that named a host would
  // break the moment the portal is reached by another one. A redirect needs
  // absolute, so this request's own origin supplies it.
  return NextResponse.redirect(new URL(url, request.url), {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
