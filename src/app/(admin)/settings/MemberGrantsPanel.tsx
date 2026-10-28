"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { setStaffPermission, type StaffPermissionLine } from "@/modules/settings/application/user-actions";
import {
  editorState,
  grantRows,
  groupGrantRows,
  OVERRIDE_NOTE_MAX_LENGTH,
  type CataloguePermission,
} from "@/modules/settings/domain/accountGrants";
import type { OverrideSource } from "@/modules/settings/domain/accountGrants";
import type { PermissionKey, RoleGrant } from "@/modules/settings/domain/types";

/**
 * One person's own lines on the portal's permissions.
 *
 * The role matrix above answers "what may a recruiter do"; this answers "what may
 * *this* recruiter do". The two are drawn side by side on purpose: a row that only
 * showed the line would hide the role's decision behind it, and a reviewer could
 * not tell a revocation from a permission the role never had.
 *
 * The rows come from the catalogue rather than from the override table, so every
 * permission the matrix offers appears here once — including the ones this account
 * has never been given a line for, which is most of them. `grantRows` decides the
 * three answers and `editorState` decides what may be claimed about the layer, so
 * nothing here repeats a rule the domain already owns.
 */
export function MemberGrantsPanel({
  profileId,
  memberName,
  roleKey,
  permissions,
  grants,
  lines,
  source,
  canManageRoles,
  onSaved,
}: {
  profileId: string;
  memberName: string;
  roleKey: string;
  permissions: CataloguePermission[];
  /** Every role's rows, as the matrix holds them — this panel takes its own role out of them. */
  grants: RoleGrant[];
  lines: StaffPermissionLine[];
  source: OverrideSource;
  canManageRoles: boolean;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { editable, note: stateNote } = editorState(source);
  const mayWrite = editable && canManageRoles;

  const groups = useMemo(() => {
    const roleGrants = new Set(
      grants
        .filter((grant) => grant.role_key === roleKey && grant.granted)
        .map((grant) => grant.permission_key as PermissionKey)
    );
    const lineMap = new Map(
      lines.map((line) => [line.permission_key as PermissionKey, line.granted])
    );
    return groupGrantRows(grantRows(permissions, roleGrants, lineMap));
  }, [grants, roleKey, lines, permissions]);

  const ownLines = lines.length;

  function write(permissionKey: PermissionKey, granted: boolean | null) {
    setSavingKey(permissionKey);
    setError(null);
    startTransition(async () => {
      const result = await setStaffPermission(
        profileId,
        permissionKey,
        granted,
        note.trim() ? note.trim() : null
      );
      setSavingKey(null);
      if (!result.ok) {
        setError(result.error ?? "The line was not saved.");
        return;
      }
      setNote("");
      onSaved();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-brand-line bg-brand-cream/60 p-3.5">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {memberName}&rsquo;s own permissions
        </h3>
        <span className="text-[11px] text-brand-ink/45">
          {source === "applied"
            ? `${ownLines} line${ownLines === 1 ? "" : "s"} of their own`
            : "lines unavailable"}
        </span>
      </header>

      {stateNote && (
        <p
          role="status"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
        >
          {stateNote}
        </p>
      )}

      {!canManageRoles && editable && (
        <p className="mb-3 text-[11px] leading-relaxed text-brand-ink/50">
          Read-only — editing a person&rsquo;s own lines needs the{" "}
          <code className="rounded bg-brand-sand px-1 py-0.5 font-mono">settings.manage_roles</code>{" "}
          permission the role matrix gates on.
        </p>
      )}

      <div className="space-y-3">
        {groups.map(([groupName, rows]) => (
          <div key={groupName}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-brand-ink/40">
              {groupName}
            </p>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-line bg-white px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{row.label}</span>
                    <span className="block text-[10px] text-brand-ink/45">
                      role: {row.fromRole ? "granted" : "not granted"}
                      {row.line === null
                        ? " · no line of their own"
                        : ` · this account: ${row.line ? "granted" : "revoked"}`}
                    </span>
                  </span>
                  <span
                    className={
                      row.effective
                        ? "rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
                        : "rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700"
                    }
                  >
                    {row.effective ? "holds it" : "does not"}
                  </span>
                  {mayWrite && (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isPending || savingKey === row.key}
                        title={row.line === true ? "Saving…" : "Grant for this account alone"}
                        onClick={() => write(row.key, true)}
                        className={
                          row.line === true
                            ? "inline-flex h-6 w-6 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 disabled:opacity-50"
                            : "inline-flex h-6 w-6 items-center justify-center rounded-md border border-brand-line bg-white text-brand-ink/40 hover:bg-brand-sand disabled:opacity-50"
                        }
                      >
                        {savingKey === row.key ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <ShieldCheck className="h-3 w-3" aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isPending || savingKey === row.key}
                        title={row.line === false ? "Saving…" : "Revoke for this account alone"}
                        onClick={() => write(row.key, false)}
                        className={
                          row.line === false
                            ? "inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-300 bg-rose-50 text-rose-700 disabled:opacity-50"
                            : "inline-flex h-6 w-6 items-center justify-center rounded-md border border-brand-line bg-white text-brand-ink/40 hover:bg-brand-sand disabled:opacity-50"
                        }
                      >
                        {savingKey === row.key ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <span className="text-sm leading-none" aria-hidden>
                            &minus;
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isPending || savingKey === row.key || row.line === null}
                        title="Clear the line, so the role's answer stands again"
                        onClick={() => write(row.key, null)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-brand-line bg-white text-brand-ink/40 hover:bg-brand-sand disabled:opacity-40"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {mayWrite && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
          Note for the next line
          <input
            className="min-w-0 flex-1 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal focus:border-brand-gold focus:outline-none"
            value={note}
            maxLength={OVERRIDE_NOTE_MAX_LENGTH}
            placeholder="Why — written into the change trail (optional)"
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="font-normal normal-case tracking-normal text-brand-ink/40">
            {note.length}/{OVERRIDE_NOTE_MAX_LENGTH}
          </span>
        </label>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
