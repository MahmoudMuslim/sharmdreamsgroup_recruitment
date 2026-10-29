/**
 * What the assistant's presence is doing, shared by the surfaces that show it.
 *
 * The orb lives in the shell, the conversation lives in the dock, and the dock can
 * also be the full page — so the three of them cannot own this state between them
 * without prop drilling through every admin page. Same shape as `rail.ts` and
 * `alert-ack.ts`: a module store, `useSyncExternalStore` on the reading side.
 *
 * Nothing here decides reach. Whether the microphone may arm comes from the
 * person's own row through `canArmAmbient`, and this file only reports that the
 * microphone is actually open in this browser right now.
 */

export interface JarvisUtterance {
  text: string;
  /** Increases with every hand-off, so a listener can tell a new one from a re-render. */
  token: number;
}

export type JarvisCommandRequest =
  | { type: "tool"; commandId: string; title: string }
  | { type: "ask"; prompt: string };

export interface JarvisUiState {
  pendingCommand: (JarvisCommandRequest & { token: number }) | null;
  commandNote: string | null;
  /** The conversation surface — dock or page — is open. */
  open: boolean;
  /** The ambient microphone is open in this browser, right now. */
  ambientArmed: boolean;
  /** The conversation is waiting for the next thing said out loud. */
  awaiting: boolean;
  /** A change is waiting for a click, in words, or null when none is. */
  pendingApproval: string | null;
  /** The conversation is working on a turn — the orb masks the latency with this. */
  thinking: boolean;
  /** The conversation is reading aloud — the chat's own voice, not the presence's. */
  speaking: boolean;
  pendingUtterance: JarvisUtterance | null;
  /** Increases when the person's saved preferences changed and the presence should re-read them. */
  prefsEpoch: number;
}

const IDLE: JarvisUiState = {
  pendingCommand: null,
  commandNote: null,
  open: false,
  ambientArmed: false,
  awaiting: false,
  pendingApproval: null,
  thinking: false,
  speaking: false,
  pendingUtterance: null,
  prefsEpoch: 0,
};

let state: JarvisUiState = IDLE;
const listeners = new Set<() => void>();
let utteranceToken = 0;
/** The newest turn a conversation has taken. A second listener cannot take it again. */
let consumedToken = 0;

function emit(next: JarvisUiState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

export function readJarvisUi(): JarvisUiState {
  return state;
}

/** The server has no presence running in it, and the first client render matches. */
export const jarvisUiOnServer = (): JarvisUiState => IDLE;

export function subscribeJarvisUi(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function setJarvisOpen(open: boolean): void {
  if (state.open === open) return;
  emit({ ...state, open });
}

export function toggleJarvisOpen(): void {
  emit({ ...state, open: !state.open });
}

/**
 * Reports the microphone's own state, not a wish.
 *
 * The orb calls this from the effect that starts and stops the capture, so an
 * app-bar indicator that says "listening" is true only while something is
 * listening — a saved switch that the browser refused to honour would otherwise
 * advertise a microphone that never opened.
 *
 * A microphone cannot be armed in two windows at once, because the capture that
 * owns it lets go the moment its tab is hidden — so this never needs broadcasting.
 * An indicator that read a shared value would risk showing "listening" for a
 * capture another window had already released.
 */
export function setJarvisAmbient(armed: boolean): void {
  if (state.ambientArmed === armed) return;
  emit({ ...state, ambientArmed: armed });
}

/** The conversation is working on a turn; the orb masks the latency with this. */
export function setJarvisThinking(thinking: boolean): void {
  if (state.thinking === thinking) return;
  emit({ ...state, thinking });
}

/**
 * Hands words heard in the room to the conversation.
 *
 * Only the presence listens while ambient is armed, so the chat's own capture is
 * stood down and this is how a turn reaches it. The text is the gateway's own
 * transcript, not a question: the conversation still decides what it means —
 * whether it names the wake phrase, answers a live approval card, or asks something
 * — because that judgement is the chat's and is already proved there. Silence is not
 * a turn: an empty transcript would open a blank question.
 */
export function handToJarvisChat(text: string): void {
  const spoken = text.trim();
  if (!spoken) return;
  utteranceToken += 1;
  emit({ ...state, pendingUtterance: { text: spoken, token: utteranceToken } });
}

/**
 * Take the turn the presence handed over, or nothing if no turn is waiting.
 *
 * A delivery is consumed, not observed: two panels could otherwise read the same
 * store slot, and a dock closed and reopened would replay a question the assistant
 * already answered — a second turn, a second quota spend, and a duplicated thread.
 * The token is what makes this safe to call twice from the same render pass.
 */
export function takePendingUtterance(): JarvisUtterance | null {
  const handed = state.pendingUtterance;
  if (!handed || handed.token <= consumedToken) return null;
  consumedToken = handed.token;
  emit({ ...state, pendingUtterance: null });
  return handed;
}

/** The conversation is reading aloud; the orb turns green with this, not with a guess. */
export function setJarvisSpeaking(speaking: boolean): void {
  if (state.speaking === speaking) return;
  emit({ ...state, speaking });
}

/**
 * Whether the conversation has asked for a follow-up and not yet heard one.
 *
 * The chat sets this when the wake phrase arrives on its own — "Listening…" — and
 * clears it when a turn is consumed. The presence reads it to know that the next
 * thing said in the room belongs to the assistant, so nobody has to repeat the wake
 * word mid-conversation.
 */
export function setJarvisAwaiting(awaiting: boolean): void {
  if (state.awaiting === awaiting) return;
  emit({ ...state, awaiting });
}

/** What the orb is waiting for a click on, or nothing. */
export function setJarvisApproval(summary: string | null): void {
  if (state.pendingApproval === summary) return;
  emit({ ...state, pendingApproval: summary });
}

/**
 * Tells a mounted presence that the person's saved row changed.
 *
 * The settings console writes the row; the orb read it once when the shell
 * mounted, and the shell survives every in-app navigation. Without this, a saved
 * switch would only take effect after a full reload of the portal.
 */
export function refreshJarvisPresence(): void {
  emit({ ...state, prefsEpoch: state.prefsEpoch + 1 });
}

function requestCommand(request: JarvisCommandRequest): void {
  if (state.pendingCommand) {
    setJarvisCommandNote("A command is already waiting. Let it finish before asking again.");
    return;
  }
  emit({ ...state, open: true, commandNote: null, pendingCommand: { ...request, token: ++utteranceToken } });
}

export function requestJarvisCommand(commandId: string, title: string): void {
  requestCommand({ type: "tool", commandId, title });
}

export function requestJarvisQuestion(prompt: string): void {
  if (!prompt.trim()) return;
  requestCommand({ type: "ask", prompt: prompt.trim() });
}

export function takeJarvisCommandRequest(): JarvisCommandRequest | null {
  const request = state.pendingCommand;
  if (!request) return null;
  emit({ ...state, pendingCommand: null });
  return request;
}

export function setJarvisCommandNote(commandNote: string | null): void {
  if (state.commandNote === commandNote) return;
  emit({ ...state, commandNote });
}
