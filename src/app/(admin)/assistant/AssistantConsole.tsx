"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, History, Loader2, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Card, EmptyState } from "@/modules/analytics/presentation/ui";
import { whenLabel } from "@/modules/assistant/presentation/whenLabel";
import { cn } from "@/lib/utils";
import { AssistantChat } from "./AssistantChat";
import {
  deleteSavedSession,
  getAssistantSessions,
  renameSavedSession,
  type AssistantSessionSummary,
} from "./actions";

/**
 * The Assistant page: the same conversation the docked panel has, at full size,
 * with every saved conversation of yours in a rail beside it.
 *
 * The rail is the point. A question that read five screens and changed two
 * records used to end when the panel closed; here it has a title, a place in the
 * list, and opens again with its tool steps and links to the records it touched.
 *
 * Selection is a URL (`/assistant?session=<id>`), so a conversation is something
 * you can hand a colleague a link to and land back on from the dock.
 */

export function AssistantConsole({
  initialSessionId,
  initialQuery = "",
}: {
  initialSessionId: string | null;
  /**
   * Words the address came with (`/assistant?q=pipeline`), so an answer that
   * named a conversation can hand over a rail already narrowed to its name.
   */
  initialQuery?: string;
}) {
  const router = useRouter();

  const [sessions, setSessions] = useState<AssistantSessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSessionId);
  const [query, setQuery] = useState(initialQuery);
  const [listError, setListError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const request = useRef(0);
  const reportedSession = useRef(initialSessionId);

  async function refresh() {
    const token = ++request.current;
    try {
      const rows = await getAssistantSessions();
      if (token === request.current) {
        setSessions(rows);
        setListError(null);
      }
    } catch {
      if (token === request.current) {
        setListError("Your saved conversations could not be loaded.");
      }
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await getAssistantSessions();
        if (active) setSessions(rows);
      } catch {
        if (active) setListError("Your saved conversations could not be loaded.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function open(id: string | null) {
    reportedSession.current = id;
    setSelected(id);
    setConfirmingId(null);
    setEditingId(null);
    router.replace(id ? `/assistant?session=${encodeURIComponent(id)}` : "/assistant", {
      scroll: false,
    });
  }

  /**
   * A turn just landed in a conversation — including the first one, which the
   * server named. The rail needs the new row and its message count without a
   * reload of the page, which would throw away the composer state.
   */
  function onSessionChange(sessionId: string) {
    if (reportedSession.current !== sessionId) {
      reportedSession.current = sessionId;
      setSelected(sessionId);
      router.replace(`/assistant?session=${encodeURIComponent(sessionId)}`, { scroll: false });
    }
    void refresh();
  }

  async function commitRename(id: string) {
    const result = await renameSavedSession(id, titleDraft);
    setActionError(result.ok ? null : result.error ?? null);
    setEditingId(null);
    if (result.ok) void refresh();
  }

  async function commitDelete(id: string) {
    const result = await deleteSavedSession(id);
    setActionError(result.ok ? null : result.error ?? null);
    setConfirmingId(null);
    if (!result.ok) return;
    if (selected === id) open(null);
    void refresh();
  }

  const active = sessions?.find((session) => session.id === selected) ?? null;

  // The rail narrows over the rows it already holds — your 60 most recent
  // conversations, newest first — so the box never claims to search older ones.
  const words = query.trim().toLowerCase();
  const shown = words
    ? (sessions ?? []).filter((session) => session.title.toLowerCase().includes(words))
    : sessions ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="min-w-0">
        <Card className="flex max-h-[34rem] flex-col overflow-hidden lg:max-h-[calc(100vh-8rem)]">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-brand-line px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
              <History className="h-3.5 w-3.5" aria-hidden />
              Saved conversations
            </p>
            <button
              type="button"
              onClick={() => open(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2 py-1 text-[11px] font-bold text-brand-ink/60 transition hover:bg-brand-sand"
            >
              <Plus className="h-3 w-3" aria-hidden />
              New
            </button>
          </div>

          <div className="shrink-0 border-b border-brand-line px-2 pb-2">
            <label className="flex items-center gap-2 rounded-lg border border-brand-line bg-brand-cream/70 px-2 py-1.5 focus-within:border-brand-gold">
              <Search className="h-3.5 w-3.5 shrink-0 text-brand-ink/35" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name"
                aria-label="Search saved conversations by name"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-brand-ink/40"
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear the search"
                  className="shrink-0 rounded-md p-1 text-brand-ink/45 transition hover:bg-white hover:text-brand-ink"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </label>
          </div>

          <div className="rail-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {listError && (
              <p role="alert" className="p-3 text-xs font-semibold text-rose-700">
                {listError}
              </p>
            )}

            {actionError && (
              <p role="alert" className="p-3 text-xs font-semibold text-rose-700">
                {actionError}
              </p>
            )}

            {sessions === null && !listError && (
              <p className="flex items-center gap-2 p-3 text-xs text-brand-ink/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading…
              </p>
            )}

            {sessions && sessions.length === 0 && !listError && (
              <EmptyState
                icon={<Sparkles className="h-6 w-6" aria-hidden />}
                title="Nothing saved yet"
                description="Ask the assistant something and the conversation appears here, ready to open again."
              />
            )}

            {words !== "" && sessions !== null && sessions.length > 0 && shown.length === 0 && (
              <p className="p-3 text-xs leading-relaxed text-brand-ink/55">
                None of your {sessions.length} saved {sessions.length === 1 ? "name" : "names"} hold
                “{query.trim()}”. Clear the box to see the whole rail again.
              </p>
            )}

            {words !== "" && shown.length > 0 && (
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-brand-gold-dark">
                {shown.length} of {sessions?.length ?? 0} names match
              </p>
            )}

            <ul className="space-y-1" aria-label="Your saved conversations">
              {shown.map((session) => {
                const isActive = session.id === selected;
                const isEditing = session.id === editingId;

                return (
                  <li
                    key={session.id}
                    className={cn(
                      "group rounded-xl border px-2.5 py-2 transition",
                      isActive
                        ? "border-brand-gold bg-brand-gold/10"
                        : "border-transparent hover:bg-brand-cream"
                    )}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={titleDraft}
                          autoFocus
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitRename(session.id);
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          aria-label="Conversation name"
                          className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2 py-1 text-xs outline-none focus:border-brand-gold"
                        />
                        <button
                          type="button"
                          onClick={() => void commitRename(session.id)}
                          aria-label="Save the name"
                          className="rounded-md p-1 text-brand-ink/55 transition hover:bg-white"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label="Cancel renaming"
                          className="rounded-md p-1 text-brand-ink/55 transition hover:bg-white"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => open(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-xs font-bold text-brand-ink">{session.title}</p>
                          <p className="mt-0.5 text-[11px] text-brand-ink/50">
                            {session.messageCount} message{session.messageCount === 1 ? "" : "s"} ·{" "}
                            {whenLabel(session.updatedAt)}
                            {session.engine ? ` · ${session.engine}` : ""}
                          </p>
                        </button>

                        {confirmingId === session.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void commitDelete(session.id)}
                              className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold uppercase text-brand-on-accent transition hover:bg-rose-700"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              className="rounded-md px-2 py-1 text-[10px] font-bold uppercase text-brand-ink/55 transition hover:bg-white"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(session.id);
                                setTitleDraft(session.title);
                              }}
                              aria-label={`Rename ${session.title}`}
                              className="rounded-md p-1 text-brand-ink/45 transition hover:bg-white hover:text-brand-ink"
                            >
                              <Pencil className="h-3 w-3" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(session.id)}
                              aria-label={`Delete ${session.title}`}
                              className="rounded-md p-1 text-brand-ink/45 transition hover:bg-white hover:text-rose-700"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <p className="mt-3 px-1 text-[11px] leading-relaxed text-brand-ink/45">
          Only you see these. The rail lists your 60 most recent conversations newest first, and the
          box narrows those rows — an older one is not searched away, it simply is not on this list.
          A conversation records what was asked, what the assistant did to answer it and which model
          replied — it is not the audit trail of the changes themselves, which stays with the screens
          they were made from.
        </p>
      </aside>

      {/*
        The conversation is the tall half of this page: the messages scroll inside
        the box and the composer stays at its foot. The rail above carries the same
        offset, so the two columns end level.
      */}
      <Card className="flex h-[calc(100vh-8rem)] min-h-[42rem] flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-line bg-brand-cream px-5 py-3">
          <p className="min-w-0 truncate font-display text-sm font-bold text-brand-ink">
            {active ? active.title : "New conversation"}
          </p>
          {selected && (
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              className="shrink-0 rounded-lg border border-brand-line bg-white px-2 py-1 text-[11px] font-bold text-brand-ink/55 transition hover:bg-brand-sand"
              title="Reload this conversation from where it was saved"
            >
              Reload
            </button>
          )}
        </div>

        <AssistantChat
          key={reloadToken}
          variant="page"
          voiceMode="console"
          sessionId={selected}
          onSessionChange={onSessionChange}
          onNewConversation={() => open(null)}
        />
      </Card>
    </div>
  );
}
