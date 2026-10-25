/**
 * The private buckets this portal stores candidate files in, and what the
 * `public.files` policies actually permit.
 *
 * This is one module because the truth is scattered across SQL policies: staff
 * may list and read every bucket, and `staff delete candidate cvs` plus
 * `staff delete candidate media` together authorise a delete in all four — so
 * the File Manager offers the control everywhere it can actually be honoured.
 * A button the database would refuse is a false promise, and a policy added
 * here without the SQL behind it is the same lie in the other direction.
 *
 * `candidate-photos` is the fifth, and its SQL is 043's `staff delete candidate
 * photos`, which asks for `candidates.delete` the same way its siblings do.
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
    key: "resumes",
    label: "Staff resume uploads",
    writtenBy:
      "The candidate record (POST /api/files/upload, from Files added by staff), stored as applications/<application id>/<random id>-<filename> and owned by an application_attachments row.",
    deletable: true,
  },
  {
    key: "candidate-audio",
    label: "Voice notes",
    writtenBy:
      "The same door on the candidate record (POST /api/files/upload). WebM, MP3 or M4A up to 20 MB, owned by an application_attachments row.",
    deletable: true,
  },
  {
    key: "candidate-photos",
    label: "Candidate photos",
    writtenBy:
      "Staff from the record door (043), stored as persons/<person id>/<random id>.<ext> and named by person_profiles.photo_path; in a later slice (044) applicants upload here from the public form.",
    deletable: true,
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
