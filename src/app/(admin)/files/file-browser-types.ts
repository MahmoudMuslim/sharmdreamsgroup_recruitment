/**
 * The private buckets this portal stores candidate files in, and what the
 * `public.files` policies actually permit.
 *
 * This is one module because the truth is scattered across SQL policies: staff
 * may list and read every bucket, and `staff delete candidate cvs` plus
 * `staff delete candidate media` together cover a delete in the first four, so the
 * File Manager describes each bucket by what its policies actually permit. A
 * descriptor the storage layer does not back is a promise nobody can keep, and a
 * control the page's own permission check does not cover is the same lie in the
 * other direction.
 *
 * `candidate-photos` is the fifth, and its delete policy is stricter: 043's
 * `staff delete candidate photos` wants `candidates.delete` on top of `is_staff()`,
 * where the sibling policies ask for staff alone. The control this page offers is
 * gated on `settings.manage_platform`, which the seed grants to SUPER_ADMIN — a role
 * the seed also grants `candidates.delete`.
 *
 * Say plainly what the policies are worth here: no door in this app deletes a
 * `files` row through the session client. `disk-store.ts` unlinks the byte and then
 * deletes the row on the direct database pool, so the File Manager, the record's
 * attachment door and the erasure engine all step around RLS on the way out — the
 * button's real gate is the page's own permission check. The browse is the one
 * `files` query that does travel through REST, so the read and list policies are
 * live. `deletable` and `deleteRequires` describe the SQL, never this portal's
 * enforcement, and they are the answer the storage layer gives the day a delete
 * does go through a session.
 */

export type BucketKey =
  | "candidate-cvs"
  | "candidate-videos"
  | "candidate-audio"
  | "resumes"
  | "candidate-photos";

export interface BucketInfo {
  key: BucketKey;
  label: string;
  /** Which code path writes here — including "nothing", when that is the answer. */
  writtenBy: string;
  /** Whether the `files` RLS policies let a staff session delete an object. */
  deletable: boolean;
  /**
   * What the delete policy asks for beyond `is_staff()`, when it asks for more.
   *
   * Purely a reading of the SQL. Every delete this app offers removes the row on
   * the direct pool, so this never decides what a staff session sees or is refused
   * today; it is the condition that would refuse one if its delete went through
   * the session client, which is the door the browse already uses.
   */
  deleteRequires: string | null;
}

export const BUCKETS: readonly BucketInfo[] = [
  {
    key: "candidate-cvs",
    label: "Candidate CVs",
    writtenBy:
      "The career-site apply form (POST /api/careers/upload), stored as applications/<job id>/<random id>-<filename>.",
    deletable: true,
    deleteRequires: null,
  },
  {
    key: "candidate-videos",
    label: "Video pitches",
    writtenBy:
      "The assessment runner (POST /api/attempt/[token]/video), stored as <attempt token>/<question id>-<timestamp>.<ext>.",
    deletable: true,
    deleteRequires: null,
  },
  {
    key: "resumes",
    label: "Staff resume uploads",
    writtenBy:
      "The candidate record (POST /api/files/upload, from Files added by staff), stored as applications/<application id>/<random id>-<filename> and owned by an application_attachments row.",
    deletable: true,
    deleteRequires: null,
  },
  {
    key: "candidate-audio",
    label: "Voice notes",
    writtenBy:
      "The same door on the candidate record (POST /api/files/upload). WebM, MP3 or M4A up to 20 MB, owned by an application_attachments row.",
    deletable: true,
    deleteRequires: null,
  },
  {
    key: "candidate-photos",
    label: "Candidate photos",
    writtenBy:
      "Nothing writes here yet. The record door that stores a profile photo is the next task of this slice; when it lands, staff upload from the candidate record, stored as persons/<person id>/<random id>.<ext> and named by person_profiles.photo_path.",
    deletable: true,
    deleteRequires: "the Delete candidates permission",
  },
] as const;

export function bucketInfo(key: string | null | undefined): BucketInfo | null {
  return BUCKETS.find((bucket) => bucket.key === key) ?? null;
}

/** The application, attempt or attachment row that references an exact storage key. */
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

// `displayName` and `isStoredPath` used to live at the bottom of this file.
// Plan 2 moved them to `src/lib/files/paths.ts`, where the disk store resolves
// a byte with them — a lib cannot import a page module's type file, and one
// copy of the rule is the point. Importers now point straight at `@/lib/files/paths`.
