/**
 * The private buckets this portal stores candidate files in, and what the
 * storage policies actually permit.
 *
 * This is one module because the truth is scattered across SQL policies: staff
 * may list and read every bucket, and `staff delete candidate cvs` plus
 * `staff delete candidate media` together authorise a delete in all four — so
 * the File Manager offers the control everywhere it can actually be honoured.
 * A button the database would refuse is a false promise, and a policy added
 * here without the SQL behind it is the same lie in the other direction.
 */

export type BucketKey = "candidate-cvs" | "candidate-videos" | "candidate-audio" | "resumes";

export interface BucketInfo {
  key: BucketKey;
  label: string;
  /** Which code path writes here — including "nothing", when that is the answer. */
  writtenBy: string;
  /** Whether storage.objects RLS lets a staff session delete an object. */
  deletable: boolean;
}

export const BUCKETS: readonly BucketInfo[] = [
  {
    key: "candidate-cvs",
    label: "Candidate CVs",
    writtenBy:
      "The career-site apply form (POST /api/careers/upload), stored as applications/<job id>/<random id>-<filename>.",
    deletable: true,
  },
  {
    key: "candidate-videos",
    label: "Video pitches",
    writtenBy:
      "The assessment runner (POST /api/attempt/[token]/video), stored as <attempt token>/<question id>-<timestamp>.<ext>.",
    deletable: true,
  },
  {
    key: "candidate-audio",
    label: "Audio answers",
    writtenBy:
      "Nothing in this portal yet — the bucket ships with size and MIME limits, but no code path writes to it.",
    deletable: true,
  },
  {
    key: "resumes",
    label: "Resumes (legacy)",
    writtenBy:
      "Nothing in this portal yet — CVs go to Candidate CVs instead, so this bucket stays empty.",
    deletable: true,
  },
] as const;

export function bucketInfo(key: string | null | undefined): BucketInfo | null {
  return BUCKETS.find((bucket) => bucket.key === key) ?? null;
}

/** The application or attempt that references an exact storage key. */
export interface FileOwner {
  label: string;
  detail: string;
}

export interface StoredFile {
  /** Full storage key, e.g. `applications/<job id>/<random id>-cv.pdf`. */
  path: string;
  /** Leaf name with our random id prefix stripped, so staff recognise the file. */
  name: string;
  bytes: number | null;
  mimeType: string | null;
  modifiedAt: string | null;
  owner: FileOwner | null;
}

export interface StoredFolder {
  name: string;
  /** Prefix for the next listing call, always ending in `/`. */
  prefix: string;
}

export interface FolderListing {
  bucketKey: BucketKey;
  bucketLabel: string;
  /** Path below the bucket root; an empty string is the root listing. */
  prefix: string;
  folders: StoredFolder[];
  files: StoredFile[];
  /** True when the folder holds more items than this listing read. */
  truncated: boolean;
  /** False when owner records could not be read, so links may be missing. */
  ownersLoaded: boolean;
  /** False for buckets no table references, where "unlinked" means nothing. */
  ownersTrackable: boolean;
}

export interface BucketStat {
  key: BucketKey;
  label: string;
  files: number;
  bytes: number;
  /** False when the bounded walk hit its ceiling, making the count a lower bound. */
  exact: boolean;
}

export type ViewResult = { ok: true; listing: FolderListing } | { ok: false; error: string };

export type DeleteResult =
  | { ok: true; name: string; note?: string }
  | { ok: false; error: string };

/**
 * Upload paths prefix the leaf with a random uuid; what follows it is the
 * filename the candidate chose.
 */
export function displayName(path: string): string {
  const leaf = path.split("/").pop() || path;
  return leaf.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || leaf;
}

/** Storage keys are plain object names, never paths that escape a bucket. */
export function isStoredPath(value: string): boolean {
  if (!value || value.length > 1024) return false;
  if (value.startsWith("/") || value !== value.trim()) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000-\u001f]/.test(value)) return false;
  return !value.split("/").includes("..");
}
