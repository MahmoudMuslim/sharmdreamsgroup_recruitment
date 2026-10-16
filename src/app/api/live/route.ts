/**
 * The portal's live channel.
 *
 * An open admin page holds one of these connections. Every few seconds the
 * watched hiring tables are fingerprinted — newest stamp and row count, or a
 * hash of the watched columns where a table keeps no update stamp — and when a
 * fingerprint moves, the areas it feeds are named on the stream. The browser
 * then reloads just the data of the page it is standing on.
 *
 * That is the whole contract, and it is worth stating plainly because it is
 * narrower than "database push": no row content crosses here, only which part
 * of the portal moved, so the page re-reads it through its own RLS-scoped
 * queries. What it buys is the part recruiters actually feel — a candidate who
 * applies while you watch the list appears in it without anyone pressing F5.
 *
 * The probe runs on the viewer's own session client, so a Hiring Manager's
 * fingerprint covers the rows that person may see, not the whole company.
 */

import { getSessionUser, isStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  diffLiveFingerprints,
  readLiveFingerprints,
  type LiveFingerprints,
  LIVE_WATCH,
} from "@/modules/live/infrastructure/changeWatch";

/**
 * One probe per connection per interval, each probe a handful of one-row reads.
 * Long enough that ten open consoles cost the database almost nothing, short
 * enough that a change lands before a recruiter looks up from their work.
 */
const POLL_MS = 5_000;

/** Consecutive failed probes before the page admits the channel has gone quiet. */
const STALLED_AFTER = 2;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) {
    return new Response(JSON.stringify({ error: "Staff session required." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Read the cookie jar once, here: the stream outlives the render pass, and
  // `cookies()` is only callable while answering the request.
  const supabase = await createSupabaseServerClient();

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          // Enqueue throws once the browser has gone; the loop ends on it.
          closed = true;
          return false;
        }
      };

      /** A comment line keeps proxies from closing an idle stream. */
      const beat = (): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(": beat\n\n"));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      let seen: LiveFingerprints = await readLiveFingerprints(supabase);
      // The browser is told which areas exist and which pages they feed, so the
      // watch list lives in one place and a page cannot be left out by accident.
      if (
        !send("hello", {
          everyMs: POLL_MS,
          watch: LIVE_WATCH.map((w) => ({ area: w.area, paths: w.paths })),
        })
      ) {
        return;
      }

      let failures = 0;
      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (closed) break;

        // A table that cannot be read comes back `undefined`; every one of them
        // unreadable is the database being unreachable, not a permissions
        // question — RLS hides rows, it does not hide a table.
        const next = await readLiveFingerprints(supabase);
        const unreadable = LIVE_WATCH.filter((w) => next[w.area] === undefined).length;

        if (unreadable === LIVE_WATCH.length) {
          failures += 1;
          if (failures === STALLED_AFTER && !send("stalled", { at: new Date().toISOString() })) {
            break;
          }
          continue;
        }

        if (failures >= STALLED_AFTER) send("recovered", { at: new Date().toISOString() });
        failures = 0;

        const moved = diffLiveFingerprints(seen, next);
        seen = next;

        if (moved.length > 0 && !send("change", { areas: moved, at: new Date().toISOString() })) {
          break;
        }
        if (!beat()) break;
      }

      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // The stream is this recruiter's session, and it must never be buffered
      // by a proxy on the way to the browser.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
