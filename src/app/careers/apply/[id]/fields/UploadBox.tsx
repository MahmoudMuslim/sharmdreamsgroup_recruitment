"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { FieldFrame, inputClass } from "./FieldFrame";
import type { RendererProps } from "./types";

const MEGABYTE = 1024 * 1024;

/**
 * The one upload door for both `file` and `photo` (spec §5).
 *
 * The byte goes to `/api/careers/form-upload`, which resolves the published
 * field again and enforces the author's kinds and ceiling; the browser's size
 * check here is a courtesy, not the rule. What comes back is only a ledger id —
 * the wizard keeps it and sends it with the application, and the submit door
 * re-checks it is unattached, for this job, and for this field.
 */
export function UploadBox({
  id,
  label,
  help,
  required,
  accept,
  maxBytes,
  error,
  upload,
  t,
}: RendererProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const choose = async (file: File | null) => {
    if (!file) return;
    setNote(null);

    if (maxBytes && file.size > maxBytes) {
      setNote(t("apply.dyn.tooLarge", { mb: Math.round(maxBytes / MEGABYTE) }));
      if (input.current) input.current.value = "";
      return;
    }

    const body = new FormData();
    body.append("jobId", upload.jobId);
    body.append("fieldKey", upload.fieldKey);
    body.append("file", file);

    setUploading(true);
    try {
      const response = await fetch("/api/careers/form-upload", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as
        | { uploadId?: unknown; error?: unknown }
        | null;

      if (!response.ok || typeof payload?.uploadId !== "string") {
        setNote(
          typeof payload?.error === "string" ? payload.error : t("apply.dyn.uploadFailed"),
        );
        return;
      }
      upload.onUploaded(payload.uploadId, file.name);
    } catch {
      setNote(t("apply.dyn.uploadFailed"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error}>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept || undefined}
        className="sr-only"
        onChange={(event) => void choose(event.target.files?.[0] ?? null)}
      />

      {upload.uploadId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-line bg-brand-cream px-3 py-2.5 text-sm">
          <FileUp className="h-4 w-4 shrink-0 text-brand-gold-dark" aria-hidden />
          <span className="min-w-0 flex-1 break-all font-semibold text-brand-ink/80">
            {upload.fileName}
          </span>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="rounded-lg px-2 py-1 text-xs font-bold text-brand-gold-dark transition hover:bg-white disabled:opacity-50"
          >
            {t("apply.dyn.replaceFile")}
          </button>
          <button
            type="button"
            onClick={() => {
              setNote(null);
              upload.onUploaded(null, null);
            }}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-ink/55 transition hover:bg-white disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden />
            {t("apply.dyn.removeFile")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className={`${inputClass(error)} flex items-center justify-center gap-2 text-brand-ink/65 transition hover:border-brand-gold disabled:opacity-60`}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileUp className="h-4 w-4" aria-hidden />
          )}
          {uploading ? t("apply.dyn.uploading") : t("apply.dyn.chooseFile")}
        </button>
      )}

      {note && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
          {note}
        </p>
      )}
    </FieldFrame>
  );
}
