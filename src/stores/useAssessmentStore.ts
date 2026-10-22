"use client";

import { create } from "zustand";
import type { SpreadsheetCellData } from "@/types";

export interface AttemptQuestionClient {
  id: string;
  question_type: "EXCEL_MODEL" | "VIDEO_PITCH" | "CASE_STUDY" | "MULTIPLE_CHOICE";
  title: string;
  prompt: string;
  config: {
    initial_sheet?: { data: (string | number | null)[][]; col_widths?: number[] };
    expected_outputs?: { cell: string; formula_hint?: string; description: string }[];
    max_duration_seconds?: number;
    min_duration_seconds?: number;
    context?: string;
    min_words?: number;
    options?: { label: string; text: string }[];
  };
  points: number;
  position: number;
}

export interface AttemptPayload {
  attempt: {
    id: string;
    status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "EXPIRED";
    time_limit_minutes: number;
    expires_at: string | null;
    submitted_at: string | null;
    draft_saved_at: string | null;
  };
  template_name: string;
  application_name: string;
  job_title: string;
  questions: AttemptQuestionClient[];
  draft: AttemptDraftClient | null;
  /**
   * Settings → Assessments, resolved server-side when the test is opened.
   *
   * These arrive with the payload rather than in a separate request because the
   * candidate is already holding this connection, and a mid-test settings change
   * should not move the rules under their feet.
   */
  settings: AttemptSettings;
}

export interface AttemptSettings {
  autosave_interval_seconds: number;
  track_focus_changes: boolean;
  lock_on_expiry: boolean;
}

export interface AttemptDraftClient {
  current_question_index: number;
  time_remaining_seconds: number;
  spreadsheet_data_map: Record<string, Record<string, SpreadsheetCellData>>;
  case_study_answers_map: Record<string, string>;
  choice_answers_map: Record<string, string>;
  video_paths_map: Record<string, string>;
}

interface AssessmentState {
  attemptToken: string | null;
  payload: AttemptPayload | null;
  isLoading: boolean;
  loadError: string | null;
  currentQuestionIndex: number;
  timeRemainingSeconds: number;
  spreadsheetDataMap: Record<string, Record<string, SpreadsheetCellData>>;
  videoBlobMap: Record<string, Blob>;
  videoPathsMap: Record<string, string>;
  caseStudyAnswersMap: Record<string, string>;
  choiceAnswersMap: Record<string, string>;
  isRecordingVideo: boolean;
  isSubmitting: boolean;
  isSyncingDraft: boolean;
  draftSavedAt: Date | null;
  submitError: string | null;
  submittedAt: Date | null;
  timerStarted: boolean;

  loadAttempt: (token: string) => Promise<void>;
  startAttempt: () => Promise<void>;
  nextQuestion: () => void;
  prevQuestion: () => void;
  goToQuestion: (index: number) => void;
  updateSpreadsheetData: (questionId: string, cells: Record<string, SpreadsheetCellData>) => void;
  setVideoBlob: (questionId: string, blob: Blob) => void;
  clearVideoBlob: (questionId: string) => void;
  setVideoPath: (questionId: string, path: string) => void;
  setCaseStudyAnswer: (questionId: string, text: string) => void;
  setChoiceAnswer: (questionId: string, label: string) => void;
  setRecordingVideo: (recording: boolean) => void;
  decrementTimer: () => void;
  syncDraft: () => Promise<void>;
  submitAttempt: () => Promise<void>;
}

function initialState() {
  return {
    attemptToken: null,
    payload: null,
    isLoading: false,
    loadError: null,
    currentQuestionIndex: 0,
    timeRemainingSeconds: 0,
    spreadsheetDataMap: {},
    videoBlobMap: {},
    videoPathsMap: {},
    caseStudyAnswersMap: {},
    choiceAnswersMap: {},
    isRecordingVideo: false,
    isSubmitting: false,
    isSyncingDraft: false,
    draftSavedAt: null,
    submitError: null,
    submittedAt: null,
    timerStarted: false,
  };
}

export const useAssessmentStore = create<AssessmentState>((set, get) => ({
  ...initialState(),

  async loadAttempt(token: string) {
    set({ isLoading: true, loadError: null, attemptToken: token });
    try {
      const response = await fetch(`/api/attempt/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to load assessment (${response.status})`);
      }
      const payload = (await response.json()) as AttemptPayload;

      const draft = payload.draft;
      set({
        isLoading: false,
        payload,
        currentQuestionIndex: draft?.current_question_index ?? 0,
        timeRemainingSeconds:
          draft?.time_remaining_seconds ?? payload.attempt.time_limit_minutes * 60,
        spreadsheetDataMap: draft?.spreadsheet_data_map ?? {},
        videoPathsMap: draft?.video_paths_map ?? {},
        caseStudyAnswersMap: draft?.case_study_answers_map ?? {},
        choiceAnswersMap: draft?.choice_answers_map ?? {},
        submittedAt: payload.attempt.submitted_at ? new Date(payload.attempt.submitted_at) : null,
        draftSavedAt: payload.attempt.draft_saved_at ? new Date(payload.attempt.draft_saved_at) : null,
      });
    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : "Failed to load assessment" });
    }
  },

  async startAttempt() {
    const { attemptToken, payload } = get();
    if (!attemptToken || !payload) return;
    if (payload.attempt.status !== "NOT_STARTED") {
      set({ timerStarted: true });
      return;
    }
    try {
      const response = await fetch(`/api/attempt/${encodeURIComponent(attemptToken)}/start`, { method: "POST" });
      if (!response.ok) throw new Error("start failed");
      set({ timerStarted: true, payload: { ...payload, attempt: { ...payload.attempt, status: "IN_PROGRESS" } } });
    } catch {
      set({ timerStarted: true });
    }
  },

  nextQuestion() {
    const { payload, currentQuestionIndex } = get();
    const max = (payload?.questions.length ?? 1) - 1;
    set({ currentQuestionIndex: Math.min(max, currentQuestionIndex + 1) });
    void get().syncDraft();
  },

  prevQuestion() {
    set({ currentQuestionIndex: Math.max(0, get().currentQuestionIndex - 1) });
    void get().syncDraft();
  },

  goToQuestion(index: number) {
    const { payload } = get();
    const max = (payload?.questions.length ?? 1) - 1;
    set({ currentQuestionIndex: Math.max(0, Math.min(max, index)) });
  },

  updateSpreadsheetData(questionId, cells) {
    set((state) => {
      const previous = state.spreadsheetDataMap[questionId];
      // Idempotent: a grid component can emit on every render, and replacing
      // an identical snapshot would loop forever (store write -> re-render ->
      // emit -> store write). Returning `state` keeps the reference stable.
      if (previous && JSON.stringify(previous) === JSON.stringify(cells)) return state;
      return { spreadsheetDataMap: { ...state.spreadsheetDataMap, [questionId]: cells } };
    });
  },

  setVideoBlob(questionId, blob) {
    set((state) => ({ videoBlobMap: { ...state.videoBlobMap, [questionId]: blob } }));
  },

  clearVideoBlob(questionId) {
    set((state) => {
      const next = { ...state.videoBlobMap };
      delete next[questionId];
      return { videoBlobMap: next };
    });
  },

  setVideoPath(questionId, path) {
    set((state) => ({ videoPathsMap: { ...state.videoPathsMap, [questionId]: path } }));
  },

  setCaseStudyAnswer(questionId, text) {
    set((state) => ({ caseStudyAnswersMap: { ...state.caseStudyAnswersMap, [questionId]: text } }));
  },

  setChoiceAnswer(questionId, label) {
    set((state) => ({ choiceAnswersMap: { ...state.choiceAnswersMap, [questionId]: label } }));
  },

  setRecordingVideo(recording) {
    set({ isRecordingVideo: recording });
  },

  decrementTimer() {
    const { timeRemainingSeconds, isSubmitting, submittedAt, payload } = get();
    if (isSubmitting || submittedAt) return;
    const next = Math.max(0, timeRemainingSeconds - 1);
    set({ timeRemainingSeconds: next });
    // Only auto-submit when the setting says so; otherwise the timer just hits zero.
    if (next === 0 && payload?.settings.lock_on_expiry) {
      void get().submitAttempt();
    }
  },

  async syncDraft() {
    const state = get();
    const { attemptToken, payload, isSubmitting, submittedAt } = state;
    if (!attemptToken || !payload || isSubmitting || submittedAt) return;
    if (payload.attempt.status === "NOT_STARTED") return;

    set({ isSyncingDraft: true });
    try {
      const response = await fetch(`/api/attempt/${encodeURIComponent(attemptToken)}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_question_index: state.currentQuestionIndex,
          time_remaining_seconds: state.timeRemainingSeconds,
          spreadsheet_data_map: state.spreadsheetDataMap,
          case_study_answers_map: state.caseStudyAnswersMap,
          choice_answers_map: state.choiceAnswersMap,
          video_paths_map: state.videoPathsMap,
        }),
      });
      if (response.ok) {
        set({ draftSavedAt: new Date() });
      }
    } catch {
      // Draft sync is best-effort; the next tick retries.
    } finally {
      set({ isSyncingDraft: false });
    }
  },

  async submitAttempt() {
    const state = get();
    const { attemptToken, payload, isSubmitting, submittedAt } = state;
    if (!attemptToken || !payload || isSubmitting || submittedAt) return;

    set({ isSubmitting: true, submitError: null });
    try {
      // Upload any recorded-but-not-yet-uploaded videos first.
      for (const [questionId, blob] of Object.entries(state.videoBlobMap)) {
        if (state.videoPathsMap[questionId]) continue;
        const formData = new FormData();
        formData.append("video", blob, `pitch-${questionId}.webm`);
        const uploadResponse = await fetch(`/api/attempt/${encodeURIComponent(attemptToken)}/video?questionId=${questionId}`, {
          method: "POST",
          body: formData,
        });
        if (uploadResponse.ok) {
          const body = (await uploadResponse.json()) as { path: string };
          get().setVideoPath(questionId, body.path);
        }
      }

      const fresh = get();
      const response = await fetch(`/api/attempt/${encodeURIComponent(attemptToken)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheet_data_map: fresh.spreadsheetDataMap,
          case_study_answers_map: fresh.caseStudyAnswersMap,
          choice_answers_map: fresh.choiceAnswersMap,
          video_paths_map: fresh.videoPathsMap,
          time_remaining_seconds: fresh.timeRemainingSeconds,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Submission failed");
      }
      set({ submittedAt: new Date(), isSubmitting: false });
    } catch (error) {
      set({
        isSubmitting: false,
        submitError: error instanceof Error ? error.message : "Submission failed",
      });
    }
  },
}));
