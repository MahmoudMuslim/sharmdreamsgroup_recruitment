"use client";

import { useState } from "react";
import {
  Download,
  FileText,
  Loader2,
  RotateCcw
} from "lucide-react";
import type { AssistantChart } from "@/modules/assistant/domain/charts";
import {
  formatBytes,
  isGeneratedFile,
  type GeneratedFileManifest
} from "@/modules/assistant/domain/generatedFiles";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";
import {
  rebuildAssistantFile
} from "./actions";

/**
 * The chart this turn earned, walked backwards: a turn can read the metrics more
 * than once, and the last read is the one the answer below it is built on.
 */
export function chartOf(steps: AssistantStep[] | undefined): AssistantChart | null {
  if (!steps) return null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const chart = steps[index].chart;
    if (chart) return chart;
  }
  return null;
}

/** Every file this turn built, in the order they were made — a turn can build two. */
export function filesOf(steps: AssistantStep[] | undefined): GeneratedFileManifest[] {
  if (!steps) return [];
  return steps.map((step) => step.file).filter(isGeneratedFile);
}

/**
 * Hand the bytes to the browser.
 *
 * The file exists only as base64 carried inside this answer, so the download is
 * made here: decode, wrap in a Blob under the content type the server named, and
 * click an anchor on the user's behalf. The object URL is revoked after a delay
 * rather than at once — Safari cancels a download whose URL is gone before it
 * starts — and nothing here is a link anybody could open later.
 */
function saveGeneratedFile(manifest: GeneratedFileManifest) {
  const binary = atob(manifest.data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: manifest.contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = manifest.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The card for a file the assistant built.
 *
 * It says what is inside (`contents`), names every ceiling the writer applied
 * (`notes`), and offers exactly one of two honest buttons: Download while the
 * bytes are still on the page, Build again once a reload has dropped them. A
 * rebuilt file is handed over in the same click — it is not stored anywhere
 * either, so a card that said "built, find it in the file manager" would be
 * describing a row that does not exist.
 */
export function GeneratedFileCard({ file }: { file: GeneratedFileManifest }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function buildAgain() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await rebuildAssistantFile(file.spec);
      if (result.ok) {
        saveGeneratedFile(result.file);
        setStatus(`Built again just now as ${result.file.fileName}.`);
      } else {
        setStatus(result.error);
      }
    } catch {
      setStatus("That file could not be built again. Ask for it in a new message.");
    } finally {
      setBusy(false);
    }
  }

  const held = file.contents.length;
  const unit = file.spec.format.shape === "table" ? "sheet" : "section";

  return (
    <div className="mt-1.5 rounded-xl border border-brand-gold bg-brand-gold/10 px-3 py-2.5">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-bold text-brand-ink">
        <FileText className="h-3.5 w-3.5 shrink-0 self-center text-brand-gold-dark" aria-hidden />
        <span className="min-w-0 break-all">{file.fileName}</span>
        <span className="font-semibold text-brand-ink/55">
          {file.label} · {formatBytes(file.bytes)} · {held} {held === 1 ? unit : `${unit}s`}
        </span>
      </p>

      <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-brand-ink/65">
        {file.contents.map((line, index) => (
          <li key={`${line}-${index}`}>· {line}</li>
        ))}
      </ul>

      {file.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-amber-700">
          {file.notes.map((note, index) => (
            <li key={`${note}-${index}`}>· {note}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {file.data ? (
          <button
            type="button"
            onClick={() => saveGeneratedFile(file)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-2.5 py-1.5 text-[11px] font-bold text-brand-cream transition hover:bg-brand-ink/85"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download {file.fileName}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void buildAgain()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-ink/25 bg-white px-2.5 py-1.5 text-[11px] font-bold text-brand-ink transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            )}
            Build again
          </button>
        )}
        <p className="text-[10px] leading-snug text-brand-ink/45">
          {file.data
            ? "This file is not stored anywhere — the download is the whole of it."
            : "Its bytes were not kept when this conversation was saved, so this rebuilds it from the same rows."}
        </p>
      </div>

      {status && (
        <p className="mt-1.5 text-[11px] leading-snug text-brand-ink/65">{status}</p>
      )}
    </div>
  );
}
