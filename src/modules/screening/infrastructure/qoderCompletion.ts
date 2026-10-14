import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { ChatCompletionMessage } from "@/types";

/**
 * Qoder as a completion provider.
 *
 * Qoder exposes no endpoint that answers a chat completion: the stored personal
 * access token authorises its agent API, and the only thing in this repository
 * that turns a prompt into Qoder text is the Agent SDK runtime. This is that
 * runtime with the portal tools taken away — one prompt in, one reply out.
 *
 * Two behaviours found by probing the live account shape the code below.
 * Folding the system message into the prompt makes the agent answer as a coding
 * assistant ("give me something concrete") because its own persona prompt is
 * still in front of it, so the system block has to go through
 * `options.systemPrompt`. And a systemPrompt that is nothing but a bare
 * instruction gets acknowledged instead of obeyed, so the actual task always
 * stays in the prompt.
 */

/**
 * The runtime's own tools. A name here that does not exist is ignored, so the
 * list is deliberately wider than what the current build initialises. Shared
 * with the assistant engine: both must run Qoder with nothing but their own
 * reachable surface.
 */
export const QODER_BUILTIN_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "TodoWrite",
  "AskUserQuestion",
  "ExitPlanMode",
  "Plan",
];

/** Raised when Qoder cannot serve this completion, so the gateway can move on. */
export class QoderCompletionError extends Error {}

/** Cached: the answer cannot change during one process's life. */
let runtimeStatus: { ok: boolean; reason: string } | null = null;

/** Where the SDK looks for the runtime it starts by default. */
const WORKER_RUNTIME = ["dist", "_worker", "qoder-worker-runtime.obf.mjs"];

/**
 * The SDK is kept out of the server bundle (`serverExternalPackages`), so it is
 * resolved from `node_modules` at call time — which is also where its downloaded
 * runtime would have to be.
 */
function packageRoot(): string | null {
  try {
    const req = createRequire(path.join(process.cwd(), "noop.js"));
    return path.dirname(path.dirname(req.resolve("@qoder-ai/qoder-agent-sdk")));
  } catch {
    return null;
  }
}

function detectRuntimeStatus(): { ok: boolean; reason: string } {
  const root = packageRoot();
  if (!root) {
    return { ok: false, reason: "the Qoder SDK is not installed on this host" };
  }

  const runtime = path.join(root, ...WORKER_RUNTIME);
  if (!fs.existsSync(runtime) || fs.statSync(runtime).size === 0) {
    return {
      ok: false,
      reason:
        `this host has no Qoder agent runtime (${WORKER_RUNTIME.join("/")} is missing). ` +
        "The SDK's install script downloads one per platform, and a serverless bundle carries only " +
        "the package's own JavaScript — run this engine on a host that installs the runtime.",
    };
  }

  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(path.dirname(runtime), "runtime-info.json"), "utf8")
    ) as { target?: string };
    const here = `${process.platform}-${process.arch}`;
    if (info.target && info.target !== here) {
      return {
        ok: false,
        reason: `the Qoder runtime on this host was built for ${info.target}, not ${here}`,
      };
    }
  } catch {
    // A runtime without a manifest still gets the chance to start and speak.
  }

  return { ok: true, reason: "" };
}

/**
 * Whether this process can start Qoder at all, before a turn is spent finding
 * out the hard way.
 *
 * Qoder's default transport is not an HTTP call: the SDK starts a ~33 MB worker
 * runtime that its postinstall script downloads into the package's own
 * `dist/_worker`, built for the OS and CPU of the machine that ran
 * `npm install`. On a serverless host that runtime is absent, and the worker
 * dies with exit code 1 — which the SDK documents as "general or unclassified
 * failure, investigate stderr".
 */
export function qoderRuntimeStatus(): { ok: boolean; reason: string } {
  runtimeStatus ??= detectRuntimeStatus();
  return runtimeStatus;
}

/**
 * Where the Qoder runtime is allowed to keep its state.
 *
 * The worker resolves its directory in this order — `QODER_CONFIG_DIR`, else
 * `QODER_CLI_HOME`/`os.homedir()` joined with `.qoder` — and creates whatever it
 * picked. Vercel's home (`/home/sbx_user1051`) does not exist and cannot be
 * created, so the worker dies on that `mkdirSync` before it speaks, and all the
 * admin sees is exit code 1. Redirecting it to `/tmp`, the one directory a
 * serverless host guarantees writable, is what makes the difference: the
 * environment is the only lever that reaches a worker thread, because the SDK's
 * in-process override is a `globalThis` symbol and every worker starts with its
 * own. A host whose home already works is left exactly as it was.
 */
let statePrepared = false;

export function prepareQoderState(): void {
  if (statePrepared) return;
  statePrepared = true;
  // An operator who mounted a writable volume told the runtime where to live.
  if (process.env.QODER_CONFIG_DIR) return;

  const intended = path.join(process.env.QODER_CLI_HOME ?? os.homedir(), ".qoder");
  if (isWritable(intended)) return;

  const fallback = path.join(os.tmpdir(), "qoder-state");
  if (!isWritable(fallback)) return;

  process.env.QODER_CONFIG_DIR = fallback;
  process.env.QODER_CLI_HOME = fallback;
  process.env.HOME = fallback;
  process.env.USERPROFILE = fallback;
}

function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The SDK's transport errors carry the worker's own stderr on the error object
 * but keep it out of `message`, so the cause of an exit code is exactly the part
 * that would be thrown away. The message is read structurally, not by
 * `instanceof Error`: an error that crossed a worker-thread boundary is not an
 * `Error` on this side of it. Truncated because a crashing runtime can print a
 * lot, and this text reaches the admin's screen.
 */
export function describeQoderFailure(error: unknown): string {
  const reported = (error as { message?: unknown } | null)?.message;
  const message =
    typeof reported === "string" && reported.trim()
      ? reported.trim()
      : "The Qoder runtime could not be reached.";
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr !== "string") return message;
  const tail = stderr.replace(/\s+/g, " ").trim().slice(-1_200);
  return tail ? `${message} — runtime stderr: ${tail}` : message;
}

/** One text-only agent turn; a few extra in case the runtime needs to settle. */
const MAX_COMPLETION_TURNS = 4;

/**
 * Bound the way the assistant engine bounds its turns: this runtime starts a
 * worker per call, so a wedged one must not hold a screening request open
 * forever. Longer than the other providers' hops because it is an agent, not a
 * completion — measured live at roughly ten seconds for a scored answer.
 */
export const QODER_COMPLETION_TIMEOUT_MS = 120_000;

export async function callQoderCompletion(
  model: string,
  messages: ChatCompletionMessage[],
  token: string,
  controller: AbortController
): Promise<{ content: string; model: string }> {
  let sdk: typeof import("@qoder-ai/qoder-agent-sdk");
  try {
    sdk = await import("@qoder-ai/qoder-agent-sdk");
  } catch (error) {
    throw new QoderCompletionError(
      `The Qoder runtime could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  const runtime = qoderRuntimeStatus();
  if (!runtime.ok) {
    throw new QoderCompletionError(`Qoder cannot be started here: ${runtime.reason}.`);
  }
  prepareQoderState();

  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();

  if (!prompt) throw new QoderCompletionError("Qoder was given nothing to answer.");

  // A scratch directory only: the runtime's file tools are blocked, and this way
  // nothing it does incidentally can touch the application's own tree.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sdg-completion-"));

  try {
    const query = sdk.query({
      prompt,
      options: {
        auth: sdk.accessToken(token),
        cwd,
        model,
        ...(systemPrompt ? { systemPrompt } : {}),
        allowedTools: [],
        disallowedTools: QODER_BUILTIN_TOOLS,
        maxTurns: MAX_COMPLETION_TURNS,
        abortController: controller,
        canUseTool: async () => ({
          behavior: "deny" as const,
          message: "Completions run without tools.",
        }),
      },
    });

    let servedModel = "";
    let reply = "";

    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "init") {
          servedModel = message.model ?? "";
        }

        if (message.type === "assistant") {
          const blocks: { type?: unknown; text?: unknown }[] =
            (message as { message?: { content?: { type?: unknown; text?: unknown }[] } }).message
              ?.content ?? [];
          const text = blocks
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("\n")
            .trim();
          if (text) reply = text;
        }

        if (message.type === "result") {
          const result = message as {
            subtype?: string;
            is_error?: boolean;
            errors?: string[];
          };
          if (result.is_error || (result.subtype && result.subtype !== "success")) {
            throw new QoderCompletionError(
              result.errors?.join(" ").trim() ||
                `Qoder ended the completion with "${result.subtype ?? "error"}".`
            );
          }
        }
      }
    } catch (error) {
      // A runtime that dies on the way in reports an exit code; its stderr, which
      // says why, sits on the error object and would otherwise be discarded.
      if (error instanceof QoderCompletionError) throw error;
      throw new QoderCompletionError(describeQoderFailure(error));
    } finally {
      await query.close().catch(() => undefined);
    }

    if (!reply.trim()) throw new QoderCompletionError("Qoder answered without any text.");

    return {
      content: reply.trim(),
      // The routing table holds the alias the admin picked; the runtime reports
      // the model behind it, and both belong in the answer's provenance.
      model: servedModel ? `${model} (${servedModel})` : model,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
