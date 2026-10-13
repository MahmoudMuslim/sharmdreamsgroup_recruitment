"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  File as FileIcon,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Link2,
  Link2Off,
  Loader2,
  Music,
  Search,
  Trash2,
} from "lucide-react";
import { deleteStoredFile, openFolder } from "./actions";
import { BUCKETS, bucketInfo, type BucketStat, type FolderListing, type StoredFile } from "./file-browser-types";
import { Button, Card, CardHeader, EmptyState, StatTile } from "@/modules/analytics/presentation/ui";
import { formatBytes, formatDateTime, cn } from "@/lib/utils";

/**
 * Browse the private buckets that hold candidate files.
 *
 * The listing is one folder at a time, straight from storage, so what a
 * recruiter sees is what the bucket holds — no cached index that can drift from
 * the objects. Opening and downloading go through /api/files/link, which mints
 * an expiring signed URL for the session that asked.
 */
export function FileBrowser({
  buckets,
  initialListing,
  initialError,
  canDelete,
}: {
  buckets: BucketStat[];
  initialListing: FolderListing | null;
  initialError: string | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [listing, setListing] = useState<FolderListing | null>(initialListing);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);

  async function goTo(bucket: string, prefix: string) {
    setPending(`folder:${bucket}:${prefix}`);
    setError(null);
    setNotice(null);
    setQuery("");
    setOnlyUnlinked(false);
    try {
      const result = await openFolder(bucket, prefix);
      if (result.ok) setListing(result.listing);
      else setError(result.error);
    } catch {
      setError("The folder could not be opened. Please retry.");
    } finally {
      setPending(null);
    }
  }

  async function remove(file: StoredFile) {
    if (!listing) return;
    const label = file.name;
    const confirmed = window.confirm(
      `Permanently delete “${label}” from ${listing.bucketLabel}? The candidate's record keeps its reference to the file, but the file itself cannot be recovered.`
    );
    if (!confirmed) return;

    setPending(`delete:${file.path}`);
    setError(null);
    setNotice(null);
    try {
      const result = await deleteStoredFile(listing.bucketKey, file.path);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.note ? `Deleted ${result.name}. ${result.note}` : `Deleted ${result.name} and recorded it in the audit log.`
      );
      const refreshed = await openFolder(listing.bucketKey, listing.prefix);
      if (refreshed.ok) setListing(refreshed.listing);
      else setError(refreshed.error);
      router.refresh();
    } catch {
      setError("Something went wrong while deleting the file.");
    } finally {
      setPending(null);
    }
  }

  const visible = useMemo(() => {
    if (!listing) return [] as StoredFile[];
    const needle = query.trim().toLowerCase();
    return listing.files.filter((file) => {
      if (onlyUnlinked && file.owner) return false;
      if (!needle) return true;
      return (
        file.name.toLowerCase().includes(needle) ||
        file.path.toLowerCase().includes(needle) ||
        (file.owner?.label.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [listing, query, onlyUnlinked]);

  const unlinked = listing?.files.filter((file) => !file.owner).length ?? 0;
  const sizeHere = listing?.files.reduce((sum, file) => sum + (file.bytes ?? 0), 0) ?? 0;
  const trail = listing ? splitPrefix(listing.prefix) : [];
  /*
   * A delete control the database would refuse is a false promise, so it only
   * appears in buckets whose storage policy actually permits staff deletes.
   */
  const canDeleteHere =
    canDelete && (listing ? (bucketInfo(listing.bucketKey)?.deletable ?? false) : false);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Buckets"
          value={buckets.length}
          hint="Private storage areas"
          icon={<HardDrive className="h-5 w-5" aria-hidden />}
        />
        <StatTile
          label="Folders here"
          value={listing?.folders.length ?? 0}
          hint={listing ? trail.length ? "Above the current folder" : "At the bucket root" : "Nothing loaded"}
        />
        <StatTile
          label="Files here"
          value={listing?.files.length ?? 0}
          hint={listing?.truncated ? "Showing the first 200" : "In this folder"}
          icon={<FileIcon className="h-5 w-5" aria-hidden />}
        />
        <StatTile label="Size here" value={formatBytes(sizeHere)} hint="Bytes of the files listed" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Buckets"
          meta="Counts walk every folder, so they cover the whole bucket"
        />
        <div className="flex flex-wrap gap-2 p-5 sm:p-6">
          {buckets.map((bucket) => {
            const active = listing?.bucketKey === bucket.key;
            return (
              <button
                key={bucket.key}
                type="button"
                onClick={() => goTo(bucket.key, "")}
                aria-pressed={active}
                className={cn(
                  "flex min-w-[190px] flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition",
                  active
                    ? "border-brand-gold bg-brand-gold/12"
                    : "border-brand-line bg-white hover:bg-brand-sand"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-bold">
                  <FolderOpen className="h-4 w-4 text-brand-gold-dark" aria-hidden />
                  {bucket.label}
                </span>
                <span className="text-xs text-brand-ink/55">
                  {bucket.exact ? "" : "at least "}
                  {bucket.files} {bucket.files === 1 ? "file" : "files"} · {formatBytes(bucket.bytes)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line px-5 py-4 sm:px-6">
          {listing && (
            <nav aria-label="Path" className="flex flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => goTo(listing.bucketKey, "")}
                className="font-bold text-brand-ink/70 hover:text-brand-ink"
              >
                {listing.bucketLabel}
              </button>
              {trail.map((segment, index) => (
                <span key={segment.prefix} className="flex items-center gap-1">
                  <span className="text-brand-ink/35">/</span>
                  <button
                    type="button"
                    onClick={() => goTo(listing.bucketKey, segment.prefix)}
                    className={cn(
                      "rounded-lg px-1.5 py-0.5 font-semibold hover:bg-brand-sand",
                      index === trail.length - 1 ? "text-brand-ink" : "text-brand-ink/60"
                    )}
                  >
                    {segment.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-brand-ink/40" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this folder"
              className="w-full rounded-xl border border-brand-line bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-brand-ink/40 focus:border-brand-gold sm:w-64"
            />
          </label>
        </div>

        {listing?.ownersTrackable && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-line bg-brand-cream/50 px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setOnlyUnlinked(false)}
              aria-pressed={!onlyUnlinked}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                !onlyUnlinked ? "bg-brand-ink text-brand-cream" : "text-brand-ink/60 hover:bg-brand-sand"
              )}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              All files ({listing.files.length})
            </button>
            <button
              type="button"
              onClick={() => setOnlyUnlinked(true)}
              aria-pressed={onlyUnlinked}
              disabled={unlinked === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                onlyUnlinked ? "bg-brand-gold text-brand-ink" : "text-brand-ink/60 hover:bg-brand-sand"
              )}
            >
              <Link2Off className="h-3.5 w-3.5" aria-hidden />
              Not linked to a record ({unlinked})
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 border-b border-brand-line bg-rose-500/8 px-5 py-3 text-xs font-semibold text-rose-700 sm:px-6">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-b border-brand-line bg-emerald-500/8 px-5 py-3 text-xs font-semibold text-emerald-700 sm:px-6">
            {notice}
          </p>
        )}
        {canDelete && listing && !canDeleteHere && (
          <p className="border-b border-brand-line bg-brand-cream/60 px-5 py-3 text-xs text-brand-ink/60 sm:px-6">
            Files in {listing.bucketLabel} can be opened but not removed: its storage policy grants staff read,
            never delete.
          </p>
        )}
        {listing && !listing.ownersLoaded && (
          <p className="border-b border-brand-line bg-brand-cream/60 px-5 py-3 text-xs text-brand-ink/60 sm:px-6">
            The records that reference these files could not be read, so a link shown as missing may still exist.
          </p>
        )}

        {!listing ? (
          <EmptyState
            title="Nothing to browse yet"
            description="Pick a bucket above to list the files it holds."
            icon={<FolderOpen className="h-8 w-8" aria-hidden />}
          />
        ) : listing.folders.length === 0 && visible.length === 0 ? (
          <EmptyState
            title={query || onlyUnlinked ? "No files match this filter" : "This folder is empty"}
            description={
              query || onlyUnlinked
                ? "Clear the search or the filter to see everything in the folder."
                : "Nothing has been written to this path."
            }
            icon={<Folder className="h-8 w-8" aria-hidden />}
          />
        ) : (
          <ul className="divide-y divide-brand-line">
            {listing.folders.map((folder) => {
              const key = `folder:${folder.prefix}`;
              return (
                <li key={folder.prefix}>
                  <button
                    type="button"
                    onClick={() => goTo(listing.bucketKey, folder.prefix)}
                    disabled={pending !== null}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-60 sm:px-6"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{folder.name}</span>
                    {pending === key && <Loader2 className="h-4 w-4 animate-spin text-brand-ink/40" aria-hidden />}
                    <span className="text-[11px] uppercase tracking-wide text-brand-ink/40">Folder</span>
                  </button>
                </li>
              );
            })}

            {visible.map((file) => {
              const key = `file:${file.path}`;
              const href = `/api/files/link?bucket=${encodeURIComponent(listing.bucketKey)}&path=${encodeURIComponent(file.path)}`;
              return (
                <li key={file.path} className="flex flex-wrap items-start gap-3 px-5 py-4 sm:px-6">
                  <IconFor mimeType={file.mimeType} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{file.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-brand-ink/50">
                      <span className="tabular-nums">{formatBytes(file.bytes)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDateTime(file.modifiedAt)}</span>
                      <span aria-hidden>·</span>
                      <span>{file.mimeType ?? "type unknown"}</span>
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-brand-ink/40">{file.path}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {listing.ownersTrackable ? (
                      file.owner ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                          <Link2 className="h-3 w-3" aria-hidden />
                          {file.owner.label}
                          <span className="font-semibold normal-case text-emerald-700/70">
                            {file.owner.detail}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-sand px-2.5 py-1 text-[11px] font-bold text-brand-ink/55">
                          <Link2Off className="h-3 w-3" aria-hidden />
                          Not linked to a record
                        </span>
                      )
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        Open
                      </a>
                      <a
                        href={`${href}&mode=download`}
                        className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-brand-sand"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Download
                      </a>
                      {canDeleteHere && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(file)}
                          disabled={pending !== null}
                        >
                          {pending === key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {listing?.truncated && (
          <p className="border-t border-brand-line bg-brand-cream/60 px-5 py-3 text-xs text-brand-ink/60 sm:px-6">
            This folder holds more than 200 items, so the listing stops here. Open a folder above to narrow it.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="What writes here" meta="Storage policies, not guesses" />
        <ul className="divide-y divide-brand-line">
          {BUCKETS.map((bucket) => (
            <li key={bucket.key} className="px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold">
                {bucket.label}
                <span className="ml-2 font-mono text-[11px] font-normal text-brand-ink/45">{bucket.key}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-ink/60">{bucket.writtenBy}</p>
              <p className="mt-1 text-[11px] font-semibold text-brand-ink/50">
                {bucket.deletable
                  ? "Staff deletes are authorised by the storage policy, so Delete appears here."
                  : "No storage delete policy for staff, so this portal cannot remove files from it."}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function IconFor({ mimeType }: { mimeType: string | null }) {
  const type = (mimeType ?? "").toLowerCase();
  const Icon = type.startsWith("video/") ? Film : type.startsWith("audio/") ? Music : FileIcon;

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

/** Breadcrumb segments from a storage prefix, each carrying the path it opens. */
function splitPrefix(prefix: string): { name: string; prefix: string }[] {
  return prefix
    .split("/")
    .filter(Boolean)
    .map((name, index, parts) => ({ name, prefix: `${parts.slice(0, index + 1).join("/")}/` }));
}
