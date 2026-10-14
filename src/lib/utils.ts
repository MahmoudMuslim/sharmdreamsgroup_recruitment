import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined, locale = "en"): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Compact human size for stored files: `990 B`, `1.4 MB`, `566 KB`. */
export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;

  const units = ["KB", "MB", "GB", "TB"] as const;
  let size = value / 1024;
  let unit: string = units[0];
  for (const candidate of units.slice(1)) {
    if (size < 1024) break;
    size /= 1024;
    unit = candidate;
  }

  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${unit}`;
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function generateTrackingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SDG-";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-slate-400";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-rose-400";
}

export function stageLabel(stage: string): string {
  return stage
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

const SOURCE_LABELS: Record<string, string> = {
  CAREER_SITE: "Career site",
  JOB_BOARD: "Job board",
  REFERRAL: "Referral",
  LINKEDIN: "LinkedIn sourcing",
  WHATSAPP: "WhatsApp",
  ATS_IMPORT: "Imported",
};

/** Where an application came from, phrased the way a recruiter reads it. */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? stageLabel(source);
}

export function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
