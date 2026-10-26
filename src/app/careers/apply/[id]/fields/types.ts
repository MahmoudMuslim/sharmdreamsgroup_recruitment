"use client";

/**
 * What every field renderer is given.
 *
 * Only the public projection's own vocabulary: a label, the author's help and
 * placeholder, whether it is required, the offered option labels, and the
 * derived `accept`/`maxBytes` for the two upload types. No `systemKey`, no
 * `config` and no field id — a renderer cannot tell, or write, anything the
 * resolve step did not project (spec §5).
 */
export interface UploadDoor {
  jobId: string;
  fieldKey: string;
  uploadId: string | null;
  fileName: string | null;
  /** `null` clears the attachment. */
  onUploaded: (uploadId: string | null, fileName: string | null) => void;
  /**
   * The bytes themselves, handed to the wizard beside the ledger id.
   *
   * The candidate is about to attach the file that says who they are, so the same
   * file answers the other questions on the page. Only this box ever sees the
   * `File`, so only its door can pass it on; `null` is the remove button.
   */
  onFile?: (file: File | null) => void;
}

/** A translation function, as `translate` is bound by the wizard. */
export type T = (key: string, vars?: Record<string, string | number>) => string;

export interface RendererProps {
  /** Stable DOM id for the label/box association. */
  id: string;
  label: string;
  help: string | null;
  placeholder: string | null;
  required: boolean;
  options?: readonly string[];
  accept?: string;
  maxBytes?: number;
  /** The closed units a `duration` field offers. */
  units?: readonly string[];
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | null;
  upload: UploadDoor;
  t: T;
}
