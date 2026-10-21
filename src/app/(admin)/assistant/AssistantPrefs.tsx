"use client";

import type { AssistantEngine } from "@/modules/assistant/domain/engine";

export const STARTERS = [
  "How is the pipeline looking this fortnight?",
  "Which openings have no applicants?",
  "Screen the newest applicant on my busiest role",
  "Show the interview-stage candidates as a table",
  "What model is resume screening using?",
] as const;

export const ENGINES: readonly { id: AssistantEngine; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Qoder when this host can run it, the model gateway otherwise." },
  {
    id: "qoder",
    label: "Qoder",
    hint: "Always the Qoder agent. Needs a stored token and the Qoder agent runtime installed on the server.",
  },
  {
    id: "gateway",
    label: "Gateway",
    hint: "Always the model gateway — either the one routed in Settings → AI models, or the one picked below.",
  },
];

const ENGINE_KEY = "sdg-assistant-engine";

/*
 * The file box, its size line and the clip an old turn's attachment is replayed at
 * all come from `domain/attachments` — the same table the server reads the file
 * through. They used to be three numbers written again here, and they had already
 * drifted: the box offered `.doc`, which the reader refuses.
 */

export function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Read lazily rather than in an effect: a stored engine can be applied on the
 * first render instead of flashing the default.
 */
export function readStoredEngine(): AssistantEngine {
  try {
    const raw = window.localStorage.getItem(ENGINE_KEY);
    return raw === "qoder" || raw === "gateway" || raw === "auto" ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function writeStoredEngine(value: AssistantEngine): void {
  try {
    window.localStorage.setItem(ENGINE_KEY, value);
  } catch {
    // Storage blocked (private mode) — the choice simply applies to this panel.
  }
}

/* ------------------------------- Web search ------------------------------- */

const WEB_KEY = "sdg-assistant-web";

/**
 * Whether this browser's assistant may leave the portal to look something up.
 *
 * A preference, like the engine, so it lives in `localStorage` and survives a new
 * conversation: switching it on to ask about pay bands should not have to be
 * re-clicked tomorrow. It is still never applied to a write — the switch only
 * opens the two read-only lookups, and the deletion switch is separate.
 */
export function readStoredWeb(): boolean {
  try {
    return window.localStorage.getItem(WEB_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStoredWeb(value: boolean): void {
  try {
    window.localStorage.setItem(WEB_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked — the choice applies to this panel only.
  }
}

/* ----------------------------- Model override ----------------------------- */

const MODEL_KEY = "sdg-assistant-model";

/**
 * The model chosen for this conversation.
 *
 * `sessionStorage`, not `localStorage`, and nothing written to Settings: a model
 * picked to try an answer is a decision about this sitting-down, and closing the
 * tab hands the routing table back its authority. The engine the recruiter chose
 * is a preference and does live in `localStorage` — this is not.
 */
export function readStoredModel(): string {
  try {
    return window.sessionStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredModel(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(MODEL_KEY, value);
    else window.sessionStorage.removeItem(MODEL_KEY);
  } catch {
    // Storage blocked — the choice simply applies to this panel.
  }
}

/* ------------------------------ Draft notes ------------------------------ */

const DRAFT_KEY = "sdg-assistant-draft";
/** Past a month the browser stops carrying it; it is a note, not a record. */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Exactly the longest question the server will accept, so nothing kept here is unsendable. */
const MAX_DRAFT_CHARS = 4_000;

export function readDraft(): string {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { text?: unknown; at?: unknown };
    if (typeof parsed?.text !== "string" || typeof parsed.at !== "number") return "";
    if (Date.now() - parsed.at > DRAFT_TTL_MS || parsed.text.length > MAX_DRAFT_CHARS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return "";
    }
    return parsed.text;
  } catch {
    return "";
  }
}

/** An empty or over-long box stores nothing: the first is sent, the second refused. */
export function writeDraft(text: string): void {
  try {
    if (text.trim().length === 0 || text.length > MAX_DRAFT_CHARS) {
      window.localStorage.removeItem(DRAFT_KEY);
    } else {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, at: Date.now() }));
    }
  } catch {
    // Storage blocked or full — the draft simply lives only in this panel.
  }
}
