import { HardDrive } from "lucide-react";
import { connection } from "next/server";
import { getFileBrowserData } from "./actions";
import { FileBrowser } from "./FileBrowser";
import { requireStaff } from "@/lib/auth/session";
import { hasPermissionForUser } from "@/modules/settings/infrastructure/permissions";
import { AdminShell } from "@/modules/analytics/presentation/AdminShell";
import { Card, EmptyState, PageHeader } from "@/modules/analytics/presentation/ui";

export const metadata = {
  title: "Files · Sharm Dreams Talent Cloud",
  description:
    "Browse the private buckets that hold candidate CVs, pitch recordings and the files staff attach to a candidate record",
};

/** Auth-gated route: every listing is a storage RLS read for this session. */
export const instant = false;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function FilesPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const user = await requireStaff("/files");
  // Which folder to open on arrival is read here, not in the browser, so the
  // listing the page hands over is the one the address bar names — the same
  // folder an assistant answer read when it searched for a file.
  const params = await searchParams;
  // A repeated parameter (`?bucket=a&bucket=b`) arrives as an array, which is not
  // a folder anyone asked for, so only a single value travels into the read.
  const bucket = typeof params.bucket === "string" ? params.bucket : null;
  const prefix = typeof params.prefix === "string" ? params.prefix : null;

  const canRead = await hasPermissionForUser("candidates.read");

  const [canDelete, data] = await Promise.all([
    hasPermissionForUser("settings.manage_platform"),
    canRead ? getFileBrowserData(bucket, prefix) : Promise.resolve(null),
  ]);

  const view = data?.view ?? null;

  return (
    <AdminShell user={user}>
      <PageHeader
        eyebrow="Storage"
        title="File manager"
        description="Walk the buckets folder by folder, see which application, attempt or staff upload each file belongs to, and open it through a signed link that expires instead of a permanent URL."
      />

      {!canRead ? (
        <Card>
          <EmptyState
            title="Files need the View candidates permission"
            description="Stored CVs and recordings are candidate data, so browsing them follows the same permission as the candidates board. Ask an administrator for the View candidates permission."
            icon={<HardDrive className="h-8 w-8" aria-hidden />}
          />
        </Card>
      ) : (
        <FileBrowser
          buckets={data?.buckets ?? []}
          initialListing={view && view.ok ? view.listing : null}
          initialError={view && !view.ok ? view.error : null}
          canDelete={canDelete}
        />
      )}
    </AdminShell>
  );
}
