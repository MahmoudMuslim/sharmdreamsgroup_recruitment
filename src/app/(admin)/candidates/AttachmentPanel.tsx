"use client";

import { useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Loader2,
  Music,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { formatBytes, formatDateTime } from "@/lib/utils";
import {
  ATTACHMENT_RULES,
  type AttachmentRule,
} from "@/modules/careers/attachment-rules";
import { deleteAttachment } from "./attachment-actions";
import { readAttachmentAsCv } from "./cv-actions";
import type { DossierAttachment } from "./dossier-actions";

const CONTROL =
  "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

/** The parser reads text out of documents only, so a voice note offers no CV control. */
function readableAsCv(attachment: DossierAttachment): boolean {
  const mime = (attachment.mime_type ?? "").toLowerCase();
  if (mime === "application/pdf" || mime.includes("wordprocessingml") || mime === "text/plain") {
    return true;
  }
  return /\.(pdf|docx|txt|md)$/i.test(attachment.name);
}

/**
 * The files a recruiter adds to a candidate after the application landed.
 *
 * Each control writes into a real private bucket whose limits are printed on the
 * button, so what is chosen is what storage accepts. Every row here is also what
 * the File Manager resolves as the object's owner, which is what makes its delete
 * in there safe and this one meaningful.
 */
export function AttachmentPanel({
  applicationId,
  attachments,
  canWrite,
  onChanged,
}: {
  applicationId: string;
  attachments: DossierAttachment[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(rule: AttachmentRule, file: File) {
    if (file.size > rule.maxBytes) {
      setMessage({
        tone: "error",
        text: `“${file.name}” is ${formatBytes(file.size)} — ${rule.hint}`,
      });
      return;
    }

    setUploading(rule.bucket);
    setMessage(null);

    const body = new FormData();
    body.append("file", file);
    body.append("applicationId", applicationId);
    body.append("bucket", rule.bucket);

    try {
      const response = await fetch("/api/files/upload", { method: "POST", body });
      const json = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            cv?: { state: "filled" | "kept" | "unreadable" | "none"; note?: string };
          }
        | null;

      if (!response.ok || !json?.ok) {
        setMessage({ tone: "error", text: json?.error ?? "The file could not be uploaded. Please try again." });
        return;
      }

      // A stored CV file is not by itself a screenable CV — the engine reads the
      // text held on the row. So the upload reports what happened to that text,
      // rather than leaving "Attached" to imply the record can now be screened.
      const cv = json.cv;
      if (cv?.state === "unreadable") {
        setMessage({ tone: "error", text: `Attached “${file.name}”. ${cv.note ?? ""}`.trim() });
      } else if (cv?.state === "kept") {
        setMessage({
          tone: "ok",
          text: `Attached “${file.name}”. ${cv.note ?? ""} Use Read as CV to put this file in front of the engine instead.`.trim(),
        });
      } else if (cv?.state === "filled") {
        setMessage({ tone: "ok", text: `Attached “${file.name}”. ${cv.note ?? ""}`.trim() });
      } else {
        setMessage({ tone: "ok", text: `Attached “${file.name}”.` });
      }
      onChanged();
    } catch {
      setMessage({ tone: "error", text: "The upload did not reach the portal. Check your connection and try again." });
    } finally {
      setUploading(null);
      const input = inputs.current[rule.bucket];
      if (input) input.value = "";
    }
  }

  async function remove(attachment: DossierAttachment) {
    const confirmed = window.confirm(
      `Permanently delete “${attachment.name}”?\n\nThe file is removed from storage with its record, so the File Manager will no longer list it. This cannot be undone.`
    );
    if (!confirmed) return;

    setRemoving(attachment.id);
    setMessage(null);
    try {
      const result = await deleteAttachment(attachment.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: result.note ?? `Deleted “${attachment.name}”.` });
      onChanged();
    } catch {
      setMessage({ tone: "error", text: "Something went wrong while deleting the attachment." });
    } finally {
      setRemoving(null);
    }
  }

  /**
   * Parses this file and stores the text on the candidate row, which is what the
   * screening engine reads. Attaching alone does not — the file sits in storage
   * while the record still reports no CV.
   */
  async function readAsCv(attachment: DossierAttachment) {
    setReading(attachment.id);
    setMessage(null);
    try {
      let result = await readAttachmentAsCv({ applicationId, attachmentId: attachment.id });

      // The record may hold text the candidate typed or whose CV the site parsed.
      // The action refuses rather than overwriting it, and only a confirmed
      // Replace goes ahead.
      if (!result.ok && result.needsReplace) {
        if (!window.confirm(`${result.error}\n\nThe text already on file is lost.`)) return;
        result = await readAttachmentAsCv({
          applicationId,
          attachmentId: attachment.id,
          replace: true,
        });
      }

      if (!result.ok) {
        setMessage({ tone: "error", text: result.error ?? "The file could not be read." });
        return;
      }
      setMessage({ tone: "ok", text: result.note ?? `Read “${attachment.name}” into the record.` });
      onChanged();
    } catch {
      setMessage({ tone: "error", text: "Something went wrong reading the file." });
    } finally {
      setReading(null);
    }
  }

  return (
    <div className="space-y-3">
      {attachments.length > 0 && (
        <>
        <p className="text-[11px] leading-relaxed text-brand-ink/45">
          Attaching a file stores it on the record. AI screening reads the CV text held on the row,
          so use Read as CV to put a staff-attached document in front of the engine.
        </p>
        <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
          {attachments.map((attachment) => {
            const href = `/api/files/link?bucket=${encodeURIComponent(attachment.bucket)}&path=${encodeURIComponent(attachment.path)}`;
            return (
              <li key={attachment.id} className="flex flex-wrap items-start gap-3 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-brand-gold-dark">
                  {(attachment.mime_type ?? "").startsWith("audio/") ? (
                    <Music className="h-4 w-4" aria-hidden />
                  ) : (
                    <FileIcon className="h-4 w-4" aria-hidden />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={attachment.name}>
                    {attachment.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-brand-ink/50">
                    <span>{attachment.label}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{formatBytes(attachment.bytes)}</span>
                    <span aria-hidden>·</span>
                    <span>added {formatDateTime(attachment.uploaded_at)}</span>
                    {attachment.uploaded_by && (
                      <>
                        <span aria-hidden>·</span>
                        <span>by {attachment.uploaded_by}</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {canWrite && readableAsCv(attachment) && (
                    <button
                      type="button"
                      disabled={reading !== null || uploading !== null}
                      onClick={() => void readAsCv(attachment)}
                      title="Parse this file and store its text on the candidate row, so AI screening can run."
                      className={CONTROL}
                    >
                      {reading === attachment.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Read as CV
                    </button>
                  )}
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={CONTROL}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Open
                  </a>
                  <a href={`${href}&mode=download`} className={CONTROL}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download
                  </a>
                  {canWrite && (
                    <button
                      type="button"
                      disabled={removing !== null}
                      onClick={() => remove(attachment)}
                      className={`${CONTROL} text-rose-700 hover:bg-rose-50`}
                    >
                      {removing === attachment.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {attachments.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-brand-ink/50">
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Nothing has been attached to this record by staff yet.
        </p>
      )}

      {canWrite ? (
        <div className="flex flex-wrap items-start gap-3">
          {ATTACHMENT_RULES.map((rule) => (
            <div key={rule.bucket} className="min-w-0">
              <input
                ref={(node) => {
                  inputs.current[rule.bucket] = node;
                }}
                type="file"
                accept={rule.accept}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(rule, file);
                }}
              />
              <button
                type="button"
                disabled={uploading !== null}
                onClick={() => inputs.current[rule.bucket]?.click()}
                className={CONTROL}
              >
                {uploading === rule.bucket ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                {rule.action}
              </button>
              <p className="mt-1 text-[11px] leading-snug text-brand-ink/45">{rule.hint}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-brand-ink/45">
          Attaching or removing a file needs the Edit candidates permission, so these controls are
          read-only for you.
        </p>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs font-semibold ${
            message.tone === "error" ? "text-rose-700" : "text-emerald-700"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
