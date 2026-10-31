"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CornerUpLeft,
  FileText,
  History,
  ListTree,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RichReply } from "@/modules/assistant/presentation/RichReply";
import { ReplyChart } from "@/modules/assistant/presentation/ReplyChart";
import { cardsOfTurn } from "@/modules/assistant/presentation/turnCards";
import type { AssistantEngine } from "@/modules/assistant/domain/engine";
import type { AssistantApproval } from "@/modules/assistant/domain/approvals";
import {
  ATTACHMENT_INPUT_ACCEPT,
  MATERIAL_NOTE_ROOM,
  MAX_HISTORY_ATTACHMENT_CHARS,
  MAX_MATERIAL_CHARS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  READABLE_FORMAT_LABEL,
  clipMaterial,
  materialFence,
  uploadTooLarge
} from "@/modules/assistant/domain/attachments";
import {
  GENERATED_FORMAT_LABEL
} from "@/modules/assistant/domain/generatedFiles";
import type { AssistantStep } from "@/modules/assistant/infrastructure/agent";
import {
  approveAssistantChange,
  extractAssistantAttachmentText,
  getAssistantModelChoices,
  openAssistantSession,
  runJarvisCommand,
  sendAssistantMessage,
  type AssistantAttachment,
  type AssistantModelChoice
} from "./actions";
import { AssistantSettings } from "./AssistantSettings";
import { ApprovalCard } from "./AssistantApprovalCard";
import { Capabilities } from "./AssistantCapabilities";
import { GeneratedFileCard, chartOf, filesOf } from "./AssistantFiles";
import { ENGINES, STARTERS, nextId, readDraft, readStoredEngine, readStoredModel, readStoredSpeechRate, readStoredSpeak, readStoredVoiceId, readStoredWeb, subscribeVoicePrefs, writeDraft, writeStoredEngine, writeStoredModel, writeStoredSpeak, writeStoredWeb } from "./AssistantPrefs";
import { QuestionChoices, TypedAnswerNote, askBubble } from "./AssistantQuestions";
import { SessionList } from "./AssistantSessions";
import { FailureNote, StepChips } from "./AssistantSteps";
import { VoiceButton } from "@/modules/assistant/presentation/voice/VoiceButton";
import { transcribeClip } from "@/modules/assistant/presentation/voice/transcribe";
import { useRecorder } from "@/modules/assistant/presentation/voice/useRecorder";
import { useSpeech } from "@/modules/assistant/presentation/voice/useSpeech";
import { useWakeListening, useMicrophoneAvailable } from "@/modules/assistant/presentation/voice/useWakeListening";
import { useJarvisMeter } from "@/modules/assistant/presentation/useJarvisMeter";
import { useJarvisAwaitingWriter, useJarvisHandoff } from "@/modules/assistant/presentation/voice/useJarvisHandoff";
import { VoiceStrip } from "@/modules/assistant/presentation/voice/VoiceStrip";
import {
  DEFAULT_SPEECH_RATE,
  matchWakePhrase,
  spokenApproval,
  spokenCodeIn,
  spokenSummary,
  wakeRemainder,
} from "@/modules/assistant/domain/voice";
import { DEFAULT_WAKE_PHRASE_TEXT } from "@/modules/assistant/domain/jarvis";
import {
  getJarvisPresence,
  type PresenceRead,
} from "@/app/(admin)/settings/jarvis-actions";
import {
  jarvisUiOnServer,
  readJarvisUi,
  setJarvisCommandNote,
  setJarvisStageTurns,
  takeJarvisCommandRequest,
  subscribeJarvisUi,
} from "@/lib/jarvis-ui";

/**
 * The assistant's conversation: transcript, tool-step chips, cards awaiting a
 * click, composer, engine picker, capability list and — in the dock — the list of
 * saved conversations.
 *
 * Both doors into the assistant render this — the panel docked to every admin
 * screen, and the full Assistant page with its history rail. The chat itself is
 * the same in each, so an answer cannot read differently depending on where it
 * was asked. Only the dock adds the saved-conversations panel, since the page
 * already carries that list beside the box.
 *
 * The presence orb is a third door, and it is deliberately not a third
 * conversation: it owns the microphone while ambient listening is armed and owns
 * no interpretation at all. What it hears arrives here through
 * `useJarvisHandoff`, into the same `hearUtterance` the console's own listener
 * calls, so "Hey Jarvis" means the same thing whoever carried it. What the orb
 * shows — amber for a turn in flight, green for an answer being read, violet for a
 * card owed a click — is this component's state, mirrored there and nowhere else.
 *
 * The transcript is stored as it is written (`sessionId` names the saved
 * conversation), which is what lets a question asked in the dock be picked up
 * tomorrow on the page. `sessionId` is owned by the caller: the dock keeps the
 * last one it used, the page keeps whichever row of the rail is selected.
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: AssistantStep[];
  model?: string;
  provider?: string;
  /** Shown when the preferred engine failed and the other one answered. */
  note?: string;
  /** Held so later turns can still read the file the recruiter attached. */
  attachmentName?: string;
  /** What the shared table calls the format, so a replayed turn names it. */
  attachmentLabel?: string;
  attachmentText?: string;
}

export interface AssistantChatProps {
  /** The saved conversation the transcript is written to, or null for a new one. */
  sessionId: string | null;
  /** Called with the id of a conversation the first turn just created. */
  onSessionChange: (sessionId: string) => void;
  onNewConversation: () => void;
  /** `stage` is the full-viewport surface: the same body, kept clear of the orb. */
  variant: "docked" | "page" | "stage";
  /** `dictate` adds a microphone; `console` also offers opt-in hands-free controls. */
  voiceMode?: "dictate" | "console";
}

export function AssistantChat({
  sessionId,
  onSessionChange,
  onNewConversation,
  variant,
  voiceMode = "dictate",
}: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraftState] = useState(() => readDraft());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allowDestructive, setAllowDestructive] = useState(false);
  /**
   * Lets this assistant leave the portal for a lookup. Remembered in
   * `localStorage`, and sent whichever engine or model answers the turn — the
   * search is the portal's own tool, not a capability one engine happens to have.
   */
  const [allowWeb, setAllowWeb] = useState(false);
  /** The approval card being applied, so its button cannot fire twice. */
  const [approving, setApproving] = useState<string | null>(null);
  const [showCapabilities, setShowCapabilities] = useState(false);
  /** The docked panel's own way back into a saved conversation. */
  const [showSessions, setShowSessions] = useState(false);
  // The stored preference is applied in the restore effect below: reading it here
  // would make the first client render disagree with the server's, because the
  // server has no localStorage to read.
  const [engine, setEngine] = useState<AssistantEngine>("auto");
  /** "" means the routing table answers; anything else is this conversation's model. */
  const [model, setModel] = useState("");
  /** null while the catalogue is still being read, an empty list when it failed. */
  const [models, setModels] = useState<AssistantModelChoice[] | null>(null);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [routedModel, setRoutedModel] = useState("");
  const [attachment, setAttachment] = useState<AssistantAttachment | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [opening, setOpening] = useState(sessionId !== null);

  /** Console-only: what the strip shows and whether the listener is armed. */
  const [caption, setCaption] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  /*
   * The remaining voice preferences live in the browser, so they are read through the
   * external store the strip writes to: the server render shows the defaults and
   * the saved values apply once hydrated. Restoring them with `setState` in an
   * effect is what the React lint rules refuse, and reading `localStorage` in a
   * `useState` initialiser would make the first client render disagree with the
   * markup the server sent.
   */
  const speakReplies = useSyncExternalStore(
    subscribeVoicePrefs,
    () => readStoredSpeak() ?? false,
    () => false
  );
  // Which of this machine's voices reads an answer, and how fast. Same browser
  // preference the presence orb speaks with, so one person hears one assistant.
  const voiceId = useSyncExternalStore(subscribeVoicePrefs, readStoredVoiceId, () => "");
  const speechRate = useSyncExternalStore(
    subscribeVoicePrefs,
    readStoredSpeechRate,
    () => DEFAULT_SPEECH_RATE
  );
  /**
   * The wake phrase lives on the account now, so the console reads the row the orb
   * reads rather than this browser's `localStorage`. `prefsEpoch` is what the Settings
   * console bumps after a save, so a phrase edited there reaches an open conversation
   * without a reload.
   */
  const jarvisUi = useSyncExternalStore(subscribeJarvisUi, readJarvisUi, jarvisUiOnServer);
  const [presence, setPresence] = useState<PresenceRead | null>(null);
  useEffect(() => {
    let alive = true;
    void getJarvisPresence().then((read) => {
      if (alive) setPresence(read);
    });
    return () => {
      alive = false;
    };
  }, [jarvisUi.prefsEpoch]);

  /**
   * The orb steps aside when this surface has something to read, and goes back to the
   * middle when it has nothing. Unmounting resets it: leaving the stage must not leave
   * a corner orb standing over the portal.
   */
  useEffect(() => {
    if (variant !== "stage") return;
    setJarvisStageTurns(messages.length);
    return () => setJarvisStageTurns(0);
  }, [variant, messages.length]);
  const wakePhrase = presence?.ok
    ? presence.prefs.wakePhrase?.trim() || DEFAULT_WAKE_PHRASE_TEXT
    : DEFAULT_WAKE_PHRASE_TEXT;

  const speech = useSpeech({ voiceId, rate: speechRate });
  const recorder = useRecorder({
    onClip: async (clip) => {
      setVoiceError(null);
      setCaption("Transcribing…");
      const result = await transcribeClip(clip);
      if ("error" in result) {
        setVoiceError(result.error);
        setCaption("");
        return;
      }
      setCaption(result.text);
      insertTranscript(result.text);
    },
    onError: (message) => setVoiceError(message),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Which conversation the transcript on screen belongs to.
   *
   * Starts empty so mounting always reads the session the caller named — a
   * remount is exactly what "reload this from storage" means. A first turn then
   * makes the session and reports its id back, and that arriving here must not
   * trigger a reload of the exchange the panel just wrote.
   */
  const shownSession = useRef<string | null>(null);

  /**
   * The half-typed question, kept in the browser.
   *
   * Closing the docked panel unmounts this component, and so does walking to
   * another screen, so the composer's text would otherwise be thrown away and the
   * recruiter would retype it. One slot rather than one per conversation: the
   * question being written belongs to the person, not to the thread it will
   * land in, and a first turn renames the thread while the box is still empty.
   */
  const draftRef = useRef(draft);

  /**
   * Whether a turn or a released approval is in flight, seen from outside React.
   *
   * A hands-free listener can deliver two utterances back to back in the same
   * synchronous pass, before any state those calls set is visible. `pending` alone
   * cannot stop the second one, and two turns at once means double quota and an
   * interleaved transcript.
   * This is the same fact as `pending`, written where synchronous code can read
   * it: set before the first await, cleared when the run ends.
   */
  const inFlightRef = useRef(false);

  /**
   * Whether the console is waiting for the utterance after the wake phrase.
   *
   * The same synchronous pass that makes `pending` unusable for a second turn
   * makes it unusable here: a batch carrying "Hey Jarvis" and then the question
   * would arm the wait on the first final and read the state as it was on the
   * second, so the question would be dropped. Nothing on screen renders this, so
   * it is only ever a ref — written where it is decided, read where the finals
   * land. Write it through `markAwaiting`, which mirrors it to the orb.
   */
  const awaitingRef = useRef(false);
  const markAwaiting = useJarvisAwaitingWriter(awaitingRef);

  /**
   * Whether this composer is on screen.
   *
   * A dictation already in flight when the dock closes resolves after this
   * component unmounts; its words must not reach the saved draft the person
   * never saw. Set in the effect rather than the initialiser so a StrictMode
   * remount (cleanup then setup) leaves it true.
   */
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function setDraft(text: string) {
    draftRef.current = text;
    setDraftState(text);
    writeDraft(text);
  }

  // Keep the newest exchange in view, including while an answer is still coming.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, pending, showCapabilities]);

  // Restore a conversation when the caller names one that is not on screen.
  useEffect(() => {
    let active = true;

    const load = async () => {
      if (shownSession.current === sessionId) return;

      if (!sessionId) {
        shownSession.current = null;
        setMessages([]);
        setError(null);
        setSaveError(null);
        setOpening(false);
        setEngine(readStoredEngine());
        return;
      }

      setOpening(true);
      try {
        const opened = await openAssistantSession(sessionId);
        if (!active) return;

        // Only claimed once the turns are actually on screen. A load that gets
        // discarded on unmount must leave the next one free to fetch, or the
        // panel sits on "Opening…" for a conversation it never read.
        shownSession.current = sessionId;
        setMessages(
          (opened?.messages ?? []).map((message) => ({
            id: message.id,
            role: message.role,
            text: message.content,
            steps: message.steps,
            model: message.model ?? undefined,
            provider: message.provider ?? undefined,
            note: message.note ?? undefined,
            attachmentName: message.attachmentName ?? undefined,
            attachmentText: message.attachmentText ?? undefined,
          }))
        );
        setError(null);
        setSaveError(null);
        // The engine this thread was answered by wins over the stored default.
        if (opened?.engine) setEngine(opened.engine);
      } catch {
        if (active) setError("That conversation could not be opened.");
      } finally {
        if (active) setOpening(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [sessionId]);

  function chooseEngine(next: AssistantEngine) {
    setEngine(next);
    writeStoredEngine(next);
  }

  /**
   * A named model is served by the gateway, which is the engine that takes a
   * model id, so the control above moves with the choice rather than leaving a
   * selected Qoder that would quietly answer with something else.
   */
  function chooseModel(next: string) {
    setModel(next);
    writeStoredModel(next);
    if (next && engine !== "gateway") chooseEngine("gateway");
  }

  // Read the catalogue this panel is allowed to offer, once, and restore whatever
  // this browser session was already using.
  useEffect(() => {
    let active = true;

    const load = async () => {
      setModel(readStoredModel());
      setAllowWeb(readStoredWeb());

      try {
        const result = await getAssistantModelChoices();
        if (!active) return;
        if (result.ok) {
          setModels(result.models);
          setRoutedModel(result.defaultModel);
          setModelListError(
            result.degraded
              ? "Some providers did not answer just now, so this list may be shorter than usual."
              : null
          );
        } else {
          setModels([]);
          setModelListError(result.error ?? "The model list could not be read.");
        }
      } catch {
        if (active) {
          setModels([]);
          setModelListError("The model list could not be read.");
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function attachFile(file: File) {
    // The size line and the format list come from the table the server reads the
    // file through, so a refusal in this panel is the refusal that code would give.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(uploadTooLarge());
      return;
    }
    setError(null);
    setExtracting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await extractAssistantAttachmentText(body);
      if (!result.ok || !result.text) {
        setError(result.error ?? `Attach ${READABLE_FORMAT_LABEL}.`);
        return;
      }
      setAttachment({
        name: result.name ?? file.name,
        label: result.label,
        text: result.text,
      });
    } catch {
      setError("The file could not be read.");
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * The turn as the model sees it: the question with any attached text under it.
   *
   * A file from an earlier turn is replayed at the history limit, so reopening a
   * thread gives the model the same amount it was given live and no more. The cut
   * allows for `MATERIAL_NOTE_ROOM` because the text it clips already carries the
   * note from the first cut at the end of it: without the room, this clip would
   * chop that note in half and leave a number that no longer matches the file.
   */
  function contentOf(message: ChatMessage): string {
    if (message.role !== "user" || !message.attachmentText) return message.text;
    const name = message.attachmentName ?? "file";
    return `${message.text}\n\n${materialFence(
      name,
      clipMaterial(message.attachmentText, name, MAX_HISTORY_ATTACHMENT_CHARS + MATERIAL_NOTE_ROOM),
      message.attachmentLabel
    )}`;
  }

  /**
   * A transcript lands where typing would: at the cursor, with the existing text
   * kept. Dictation never replaces a draft that is already being written.
   */
  function insertTranscript(text: string) {
    if (!mountedRef.current) return;
    const box = inputRef.current;
    const current = draftRef.current;
    if (!box) {
      setDraft(current ? `${current} ${text}` : text);
      return;
    }
    const start = box.selectionStart ?? current.length;
    const end = box.selectionEnd ?? current.length;
    setDraft(`${current.slice(0, start)}${text}${current.slice(end)}`);
    requestAnimationFrame(() => {
      box.focus();
      const at = start + text.length;
      box.setSelectionRange(at, at);
    });
  }

  /**
   * Put a question that was already sent back into the composer — after a failed
   * answer, or to ask the same thing of a different candidate. Only the click
   * does this: a turn that failed leaves the question where it is and nothing is
   * typed into the recruiter's box unasked.
   */
  function reuse(message: ChatMessage) {
    setDraft(message.text);
    if (message.attachmentName && message.attachmentText) {
      setAttachment({
        name: message.attachmentName,
        label: message.attachmentLabel,
        text: message.attachmentText,
      });
    }
    setError(null);
    requestAnimationFrame(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }

  async function send(promptRaw?: string) {
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt || pending || extracting || inFlightRef.current) return;

    // Snapshot before appending: the question being asked is sent separately.
    const history = messages.map((message) => ({
      role: message.role,
      content: contentOf(message),
    }));
    const attached = attachment;

    setMessages((current) => [
      ...current,
      {
        id: nextId(),
        role: "user",
        text: prompt,
        attachmentName: attached?.name,
        attachmentLabel: attached?.label,
        attachmentText: attached?.text,
      },
    ]);
    setDraft("");
    setAttachment(null);
    setError(null);
    setSaveError(null);
    setPending(true);
    setShowCapabilities(false);
    setShowSessions(false);
    inFlightRef.current = true;

    try {
      const result = await sendAssistantMessage({
        history,
        prompt,
        allowDestructive,
        allowWeb,
        engine,
        model: model || null,
        attachment: attached ?? undefined,
        sessionId,
      });
      if (!result.ok) {
        setError(result.error ?? "The assistant could not answer that.");
        return;
      }
      if (result.sessionId) {
        shownSession.current = result.sessionId;
        onSessionChange(result.sessionId);
      }
      setSaveError(result.saveError ?? null);
      const answer = result.reply ?? "";
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: answer,
          steps: result.steps,
          model: result.model,
          provider: result.provider,
          note: result.note,
        },
      ]);
      if (speakReplies && answer) {
        speech.speak(spokenSummary(answer));
      }
    } catch {
      setError("The assistant could not be reached. Check the AI keys in Settings and try again.");
    } finally {
      inFlightRef.current = false;
      setPending(false);
      inputRef.current?.focus();
    }
  }

  /**
   * Run the one change an approval card was holding.
   *
   * Only the id travels. The server keeps the arguments it minted the card with,
   * so this click cannot be steered at another record, and the outcome is
   * appended as its own turn — which is what makes the card stop being clickable.
   */
  async function approve(
    approval: AssistantApproval,
    code = "",
    via: "assistant" | "assistant voice" = "assistant"
  ) {
    if (approving || pending || inFlightRef.current) return;
    setApproving(approval.id);
    inFlightRef.current = true;
    setError(null);

    try {
      const result = await approveAssistantChange({
        approvalId: approval.id,
        sessionId: sessionId ?? null,
        spokenCode: code.trim() || undefined,
        via,
      });
      if (!result.reply) {
        setError(result.error ?? "The approval could not be applied. Nothing has changed.");
        return;
      }
      const outcome = result.reply;
      if (result.saveError) setSaveError(result.saveError);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: outcome,
          steps: result.steps,
        },
      ]);
    } catch {
      setError("The approval could not be applied. Nothing has changed.");
    } finally {
      inFlightRef.current = false;
      setApproving(null);
    }
  }

  const wide = variant !== "docked";

  /**
   * The change this transcript is waiting for a click on, or null.
   *
   * Only the newest assistant turn carries a live card: releasing one appends its
   * outcome, so a card from an older turn has already been answered or expired. Both
   * the spoken verdict in `hearUtterance` and the orb's amber state read this one
   * value, so a person looking at the reactor and a person speaking at it are talking
   * about the same card.
   */
  const newest = messages[messages.length - 1];
  const liveApproval =
    newest?.role === "assistant"
      ? newest.steps?.find((step) => step.approval)?.approval ?? null
      : null;

  /**
   * Why a spoken turn cannot be sent right now, or null when nothing is at risk.
   *
   * `send` empties the composer and detaches the file, so a spoken question
   * would silently throw away anything typed or attached. It would also be
   * dropped by the in-flight guard without a word. Both cases are refused here
   * with the reason, before a caption can make the turn look sent.
   */
  function spokenTurnBlocked(): string | null {
    if (draftRef.current.trim() || attachment) {
      return "Not sent — clear or send what you typed first.";
    }
    if (pending || extracting || inFlightRef.current) {
      return "Not sent — the assistant is still answering.";
    }
    return null;
  }

  useEffect(() => {
    const consume = async () => {
      if (opening || pending || extracting || approving || inFlightRef.current) return;
      const request = takeJarvisCommandRequest();
      if (!request) return;
      if (liveApproval) {
        setJarvisCommandNote("Not sent — answer the pending approval before running another command.");
        return;
      }
      const blocked = spokenTurnBlocked();
      if (blocked) {
        setJarvisCommandNote(blocked);
        return;
      }
      markAwaiting(false);
      if (request.type === "ask") {
        await send(request.prompt);
        return;
      }
      inFlightRef.current = true;
      setPending(true);
      setError(null);
      setSaveError(null);
      setShowCapabilities(false);
      setShowSessions(false);
      try {
        const result = await runJarvisCommand({ commandId: request.commandId, sessionId });
        if (!result.ok) {
          setJarvisCommandNote(result.error);
          setError(result.error);
          return;
        }
        if (result.sessionId) {
          shownSession.current = result.sessionId;
          onSessionChange(result.sessionId);
        }
        setSaveError(result.saveError ?? null);
        setMessages(current => [...current,
          { id: nextId(), role: "user", text: `Command: ${result.title}` },
          { id: nextId(), role: "assistant", text: result.reply, steps: result.steps },
        ]);
        if (speakReplies) speech.speak(spokenSummary(result.reply));
      } catch {
        setError("The command result could not be received. Check the conversation before retrying.");
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
    };
    void consume();
  });

  /**
   * One final utterance from the hands-free listener.
   *
   * The wake phrase may carry the question ("Hey Jarvis, who is waiting?") or
   * stand alone, in which case the next utterance is the question. While a card
   * is live, an approve/cancel phrase is a verdict instead — but only for a card
   * minted under `code` or `open`. A `confirm` card is released by a click, so a
   * spoken "approve" is acknowledged and nothing else.
   */
  function hearUtterance(text: string) {
    // The account's phrase already carries the default when the row has none, so
    // what is matched here is the same sentence the strip shows.
    const phrase = wakePhrase;
    const wake = matchWakePhrase(text, phrase);
    if (wake.matched) {
      markAwaiting(false);
      if (wake.remainder) {
        // The folded remainder is the phrase-level match; the turn that is
        // sent and stored is the person's own words after the phrase.
        const question = wakeRemainder(text, phrase) || wake.remainder;
        const blocked = spokenTurnBlocked();
        if (blocked) {
          setCaption(blocked);
          speech.speakNow(blocked, "en");
          return;
        }
        setCaption(question);
        void send(question);
      } else {
        markAwaiting(true);
        setCaption("Listening…");
        speech.speakNow("Listening", "en");
      }
      return;
    }
    if (!awaitingRef.current) return;
    // The console speaks while the listener is armed, so a final can be the
    // assistant hearing itself: the cue it said, a refusal it read out, or the
    // answer it just summarised aloud. `speaking` only covers the utterance
    // still in flight; an echo that lands after it ended is caught by comparing
    // the heard words to the strings spoken recently. `awaitingRef` stays true so
    // the person's own next utterance is still heard.
    if (speech.speaking || speech.echoedOwnVoice(text)) return;
    markAwaiting(false);

    const live = liveApproval;
    if (live) {
      const verdict = spokenApproval(text, live.code ?? null);
      if (verdict === "cancel") {
        setCaption("Cancelled — the card stays live until it expires or you click it.");
        speech.speakNow("Cancelled. The card has not been released.", "en");
        return;
      }
      if (verdict === "approve") {
        // A card minted under `confirm` is released by a click and never by a
        // word, so saying "approve" only asks whether the card was heard. The
        // card rehydrated from an older transcript carries no level, and an
        // unknown level behaves like the safe one.
        if ((live.autonomy ?? "confirm") === "confirm") {
          setCaption(`Waiting for your click: ${live.summary}`);
          speech.speakNow("That change is waiting for your click.", "en");
          return;
        }
        // `code` reaches here only with the code said in the same utterance
        // (`spokenApproval` refused it otherwise); `open` carries no code. The
        // server compares one token, not a sentence, so the code is extracted
        // from "approve K7Q2" rather than the whole phrase being sent as it was.
        const saidCode = live.code ? spokenCodeIn(text, live.code) : null;
        if (live.code && !saidCode) {
          setCaption("Approval not sent — the code was not heard.");
          speech.speakNow("Approval not sent. The code was not heard.", "en");
          return;
        }
        // One release at a time: the listener can hand two verdicts in a
        // single batch, and the second must not caption itself as though the
        // change it names had run.
        if (inFlightRef.current) {
          setCaption("Not released — the first approval is still running.");
          speech.speakNow("Not released. The first approval is still running.", "en");
          return;
        }
        setCaption(`Approved: ${live.summary}`);
        void approve(live, saidCode ?? "", "assistant voice");
        return;
      }
    }

    // "Send" spoken after dictating submits the composer rather than asking the
    // assistant about the word "send".
    if (/^(send|send it|أرسل|ارسال|إرسال)$/i.test(text.trim()) && draftRef.current.trim()) {
      void send();
      return;
    }

    const blocked = spokenTurnBlocked();
    if (blocked) {
      setCaption(blocked);
      speech.speakNow(blocked, "en");
      return;
    }
    setCaption(text);
    void send(text);
  }

  /**
   * The conversation the orb is having, mirrored outward and handed inward.
   *
   * The reactor is mounted by the shell, several components above this one, and the
   * dock may be closed while a turn runs — so it cannot read any of this from here.
   * These three values are the only things it can honestly show: a question in
   * flight, an answer being read aloud, and a card owed a click.
   */
  const { ambientArmed } = useJarvisHandoff({
    onUtterance: hearUtterance,
    thinking: pending || approving !== null,
    speaking: speech.speaking,
    approvalSummary: liveApproval?.summary ?? null,
  });

  const meter = useJarvisMeter({
    enabled: voiceMode === "console" && handsFree && !ambientArmed,
  });

  const wake = useWakeListening({
    // One microphone per tab. While the orb's ambient listening is running it owns the
    // capture and delivers every utterance through the handoff above; a second
    // recorder here would hear the same person twice and ask twice.
    enabled: voiceMode === "console" && handsFree && !ambientArmed,
    meter,
    // Quiet hours govern the orb that speaks on its own, not a conversation the
    // person opened on this page.
    quiet: false,
    onUtterance: hearUtterance,
  });
  const microphoneAvailable = useMicrophoneAvailable();

  /** The question a failure can put back in the box, newest first. */
  const lastQuestion = [...messages].reverse().find((message) => message.role === "user") ?? null;

  return (
    <>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-2 border-b border-brand-line bg-white px-3 py-2",
          variant === "page" && "px-4"
        )}
      >
        <div role="group" aria-label="Answering engine" className="flex items-center gap-0.5 rounded-lg border border-brand-line bg-brand-cream p-0.5">
          {ENGINES.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              onClick={() => chooseEngine(option.id)}
              aria-pressed={engine === option.id}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-bold transition",
                engine === option.id
                  ? "bg-brand-ink text-brand-cream"
                  : "text-brand-ink/55 hover:bg-brand-sand"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2 py-1 text-[11px] font-bold text-brand-ink/60 transition hover:bg-brand-sand"
          title="Start another conversation — this one stays in your history"
        >
          <Plus className="h-3 w-3" aria-hidden />
          New
        </button>

        {/*
          The page has a rail beside the chat; the panel floats over someone's
          work and had no way back into a conversation it saved. Only the dock
          gets this button — on the page the list would sit twice on screen.
        */}
        {variant === "docked" && (
          <button
            type="button"
            onClick={() => {
              setShowSessions((current) => !current);
              setShowCapabilities(false);
            }}
            aria-label="Your saved conversations"
            title="Your saved conversations"
            aria-pressed={showSessions}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition",
              showSessions
                ? "border-brand-gold bg-brand-gold/20 text-brand-gold-dark"
                : "border-brand-line text-brand-ink/60 hover:bg-brand-sand"
            )}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setShowCapabilities((current) => !current);
            setShowSessions(false);
          }}
          aria-label="What can the assistant do?"
          title="What can the assistant do?"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand"
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {showSessions ? (
        <SessionList
          current={sessionId}
          onSelect={(id) => {
            onSessionChange(id);
            setShowSessions(false);
          }}
          onClose={() => setShowSessions(false)}
        />
      ) : showCapabilities ? (
        <Capabilities onClose={() => setShowCapabilities(false)} />
      ) : (
        <div
          ref={scrollRef}
          className={cn("rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain", variant !== "docked" ? "px-6 py-5" : "p-4")}
        >
          <div className={cn("space-y-3", wide && "mx-auto max-w-3xl")}>
            {messages.length === 0 && !pending && !opening && (
              <div>
                <p className="text-xs leading-relaxed text-brand-ink/55">
                  I read and change the same data the screens do — openings, candidates, screening,
                  assessments, interviews, onboarding, the apply questions, sourcing, stored files,
                  the message outbox, the analytics report, the row-level reports, the settings,
                  team, model-routing, API-keys and change-trail consoles, the hiring-data
                  activity trail and the hours people logged in the Time Tracker — by calling the
                  very actions those pages call, so the permissions on your role apply here
                  unchanged. The “What can the assistant do?” button
                  above lists every one.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-ink/55">
                  Attach a file and I read it — {READABLE_FORMAT_LABEL}, up to {MAX_UPLOAD_MB} MB. Ask
                  me about it afterwards and I keep answering from what I read: {MAX_MATERIAL_CHARS.toLocaleString("en-GB")}{" "}
                  characters reach me on the turn you send it, and {MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString("en-GB")}{" "}
                  on every turn after, with the text telling me where it was cut. A Word or Excel file
                  saved in the 1997-2003 format, an image or a scanned PDF I cannot read at all, and
                  the file is never stored — only its text sits in this conversation. Say the word and
                  I can build one back for you in {GENERATED_FORMAT_LABEL}; the download is the whole
                  of it, so a rebuilt file after a reload is the same rows, not a saved link.
                  Anything I change comes back with a link to where you can see it: the record when
                  the page opens one, the page itself otherwise.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-brand-ink/45">
                  <Sparkles className="mr-1 inline h-3 w-3 text-brand-gold" aria-hidden />
                  Every conversation you start here is saved — open an older one from{" "}
                  {variant === "docked"
                    ? "the saved-conversations button above"
                    : "the rail beside this box"}
                  , or close this panel and carry on where you left off. Anything you have typed but
                  not sent comes back with it, and when a request could mean several records I ask
                  and put the choices under the question for you to click.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {STARTERS.map((starter) => (
                    <li key={starter}>
                      <button
                        type="button"
                        onClick={() => void send(starter)}
                        className="w-full rounded-xl border border-brand-line bg-brand-cream px-3 py-2 text-left text-xs font-semibold text-brand-ink/75 transition hover:bg-brand-sand"
                      >
                        {starter}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {opening && (
              <p className="flex items-center gap-2 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Opening this conversation…
              </p>
            )}

            {messages.map((message, index) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="ml-auto max-w-[85%] space-y-1">
                    <p className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-ink px-3 py-2 text-sm text-brand-cream">
                      {message.text}
                    </p>
                    {message.attachmentName && (
                      <p className="flex items-center justify-end gap-1.5 pr-1 text-[11px] font-semibold text-brand-ink/50">
                        <FileText className="h-3 w-3" aria-hidden />
                        {message.attachmentLabel ? `${message.attachmentLabel} · ` : ""}
                        {message.attachmentName}
                      </p>
                    )}
                    <p className="flex justify-end pr-1">
                      <button
                        type="button"
                        onClick={() => reuse(message)}
                        disabled={pending || extracting}
                        title="Put this question back in the box to edit and send again"
                        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold text-brand-ink/40 transition hover:bg-brand-sand hover:text-brand-ink/70 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CornerUpLeft className="h-3 w-3" aria-hidden />
                        Edit and send again
                      </button>
                    </p>
                  </div>
                );
              }

              // Every card this turn raised, not only the last — see turnCards.
              const live = !pending && index === messages.length - 1;
              const { cards, asks, bubbleAsk, needsTypedAnswer } = cardsOfTurn(
                message.text,
                message.steps,
                live
              );
              const chart = chartOf(message.steps);
              const answered = asks.length
                ? (messages.slice(index + 1).find((entry) => entry.role === "user")?.text ?? null)
                : null;

              return (
                <div key={message.id} className="max-w-[92%]">
                  <StepChips steps={message.steps ?? []} />
                  <div className="rounded-2xl rounded-bl-sm border border-brand-line bg-brand-cream px-3 py-2.5 text-sm leading-relaxed text-brand-ink">
                    <RichReply text={bubbleAsk ? askBubble(bubbleAsk) : message.text} />
                    {chart && !bubbleAsk && (
                      <>
                        <ReplyChart chart={chart} className="mt-2.5" />
                        <p className="mt-1.5 text-[10px] leading-snug text-brand-ink/40">
                          These bars are drawn by the portal from the figures this answer read —
                          the model chose the view, not the numbers.
                        </p>
                      </>
                    )}
                  </div>
                  {filesOf(message.steps).map((file, fileIndex) => (
                    <GeneratedFileCard
                      key={`${file.fileName}-${fileIndex}`}
                      file={file}
                    />
                  ))}
                  {cards.map((step, cardIndex) =>
                    step.ask ? (
                      <QuestionChoices
                        key={`${step.tool}-${cardIndex}`}
                        ask={step.ask}
                        showQuestion={step.ask !== bubbleAsk}
                        live={live}
                        answered={answered}
                        pending={pending}
                        onChoose={(option) => void send(option)}
                      />
                    ) : step.approval ? (
                      <ApprovalCard
                        key={`${step.tool}-${cardIndex}`}
                        approval={step.approval}
                        live={live}
                        busy={approving === step.approval.id}
                        onApprove={(entry, entered) => void approve(entry, entered)}
                      />
                    ) : null
                  )}
                  {needsTypedAnswer && <TypedAnswerNote />}
                  {message.note && (
                    <p className="mt-1 pl-1 text-[11px] leading-relaxed text-amber-700">
                      {message.note}
                    </p>
                  )}
                  {message.model && (
                    <p className="mt-1 pl-1 text-[10px] uppercase tracking-wide text-brand-ink/35">
                      {message.provider ? `${message.provider} · ${message.model}` : message.model}
                    </p>
                  )}
                </div>
              );
            })}

            {pending && (
              <p className="flex items-center gap-2 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Working…
              </p>
            )}
          </div>
        </div>
      )}

      {!showCapabilities && !showSessions && (
        <footer className={cn("shrink-0 border-t border-brand-line bg-white", variant !== "docked" ? "px-6 py-4" : "p-3")}>
          <div className={cn(wide && "mx-auto max-w-3xl")}>
            {error && (
              <FailureNote
                message={error}
                action={
                  lastQuestion
                    ? { label: "Put my question back in the box", run: () => reuse(lastQuestion) }
                    : null
                }
              />
            )}

            {saveError && (
              <FailureNote
                tone="soft"
                message={saveError}
                hint="The answer above is real — it is only missing from the list you open tomorrow."
              />
            )}

            {voiceMode === "console" && (
              <VoiceStrip
                pushToTalk={() => {
                  setVoiceError(null);
                  if (recorder.state === "recording") recorder.stop();
                  else void recorder.start();
                }}
                recording={recorder.state === "recording"}
                transcribing={recorder.state === "transcribing" || recorder.state === "requesting"}
                secondsLeft={recorder.secondsLeft}
                hitLimit={recorder.hitLimit}
                supported={microphoneAvailable}
                handsFree={handsFree}
                onHandsFree={(next) => {
                  setHandsFree(next);
                  markAwaiting(false);
                  setCaption("");
                  if (!next) speech.stop();
                }}
                listening={wake.listening}
                ambientArmed={ambientArmed}
                wakePhrase={wakePhrase}
                speakReplies={speakReplies}
                onSpeakReplies={(next) => {
                  writeStoredSpeak(next);
                  if (!next) speech.stop();
                }}
                speaking={speech.speaking}
                onStopSpeaking={speech.stop}
                caption={caption}
                error={voiceError ?? wake.error ?? meter.error ?? speech.error}
              />
            )}

            {attachment && (
              <p className="mb-2 flex items-center gap-2 rounded-xl border border-brand-gold bg-brand-gold/15 px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink">
                <FileText className="h-3.5 w-3.5 shrink-0 text-brand-gold-dark" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.label ? `${attachment.label} · ` : ""}
                  {attachment.name} — {attachment.text.length.toLocaleString("en-GB")} characters the
                  assistant will read
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label={`Remove ${attachment.name}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-brand-ink/55 transition hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </p>
            )}

            {/*
              The model choice and the two switches used to sit above the box, and
              their copy is long enough to push the transcript out of a short dock.
              They are behind a button now — same controls, same words.
            */}
            <AssistantSettings
              model={model}
              routedModel={routedModel}
              models={models}
              onChooseModel={chooseModel}
              allowWeb={allowWeb}
              onAllowWeb={(next) => {
                setAllowWeb(next);
                writeStoredWeb(next);
              }}
              allowDestructive={allowDestructive}
              onAllowDestructive={setAllowDestructive}
              speak={voiceMode === "console" ? null : {
                on: speakReplies,
                speaking: speech.speaking,
                set: (next) => {
                  writeStoredSpeak(next);
                  if (!next) speech.stop();
                },
                stop: speech.stop,
              }}
            />

            {voiceMode !== "console" && speakReplies && speech.error && (
              <p role="status" className="mb-2 text-[10px] leading-relaxed text-brand-ink/45">
                {speech.error}
              </p>
            )}

            {modelListError && (
              <FailureNote
                tone="soft"
                message={modelListError}
                hint="Leave the choice on default routing and the model named in Settings → AI models answers — that route does not depend on this list."
              />
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ATTACHMENT_INPUT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attachFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending || extracting}
                aria-label="Attach a file for the assistant to read"
                title={`Attach ${ATTACHMENT_INPUT_ACCEPT} — up to ${MAX_UPLOAD_MB} MB`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-line text-brand-ink/60 transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-40"
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="h-4 w-4" aria-hidden />
                )}
              </button>
              {voiceMode === "dictate" && (
                <VoiceButton
                  onTranscript={insertTranscript}
                  disabled={pending || extracting}
                />
              )}
              <textarea
                ref={inputRef}
                rows={wide ? 3 : 2}
                value={draft}
                disabled={pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={attachment ? "Ask about the attached file…" : "Ask or instruct…"}
                aria-label="Message the assistant"
                className="rail-scroll min-h-[2.75rem] flex-1 resize-none rounded-xl border border-brand-line bg-white px-3 py-2 text-sm outline-none transition placeholder:text-brand-ink/35 focus:border-brand-gold disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={pending || extracting || draft.trim().length === 0}
                aria-label="Send"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-ink text-brand-cream transition hover:bg-brand-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            {draft.trim().length > 0 && !pending && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-brand-ink/40">
                {draft.trim().length.toLocaleString()} characters kept in this browser — close the
                panel or go and look at another screen, and this question is still here when you
                come back. An attached file is not.
              </p>
            )}
          </div>
        </footer>
      )}
    </>
  );
}
