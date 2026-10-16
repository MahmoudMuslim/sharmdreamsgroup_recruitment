"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarClock,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserCheck,
} from "lucide-react";
import { UserCreatePanel } from "./UserCreatePanel";
import { MemberEditPanel } from "./MemberEditPanel";
import { InviteEditPanel } from "./InviteEditPanel";
import { CredentialReveal } from "./CredentialReveal";
import { Button, Badge } from "@/modules/analytics/presentation/ui";
import { ASSIGNABLE_ROLE_KEYS, ASSIGNABLE_STAFF_ROLES } from "@/modules/settings/domain/schema";
import {
  cancelInvite,
  deleteStaffAccount,
  provisionInvite,
  resetStaffPassword,
  setStaffActive,
  updateStaffCompany,
  updateStaffRole,
  type StaffActionResult,
} from "@/modules/settings/application/user-actions";
import { formatInZone } from "@/lib/timezone";
import type {
  AssignableStaffRole,
  Company,
  StaffInvite,
  StaffMember,
} from "@/modules/settings/domain/types";

interface TeamSectionProps {
  staff: StaffMember[];
  invites: StaffInvite[];
  /** profile id → the moment their ban ends, or null/absent when they can sign in. */
  access: Record<string, string | null>;
  /** Why the sign-in directory could not be read, or null. */
  accessError: string | null;
  /** Why pending invites could not be read, or null. */
  invitesError: string | null;
  companies: Company[];
  passwordMinLength: number;
  canManage: boolean;
  viewerAuthUserId: string;
  timeZone: string;
}

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 text-xs font-semibold transition hover:bg-brand-sand disabled:cursor-not-allowed disabled:opacity-50";

const FIELD =
  "rounded-lg border border-brand-line bg-brand-cream px-2.5 py-1.5 text-xs font-semibold focus:border-brand-gold focus:bg-white focus:outline-none";

const DAY_MONTH = { day: "2-digit", month: "short", year: "numeric" } as const;

function roleLabel(role: string): string {
  return ASSIGNABLE_STAFF_ROLES.find((r) => r.value === role)?.label ?? role.replace(/_/g, " ");
}

/** A read that failed, said out loud instead of drawn as an empty console. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900"
    >
      {children}
    </p>
  );
}

export function TeamSection({
  staff,
  invites,
  access,
  accessError,
  invitesError,
  companies,
  passwordMinLength,
  canManage,
  viewerAuthUserId,
  timeZone,
}: TeamSectionProps) {
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null);
  const [editingInvite, setEditingInvite] = useState<StaffInvite | null>(null);
  const router = useRouter();
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const enabledCount = staff.filter((m) => !access[m.id]).length;

  /**
   * A credential minted from an invite row lives here rather than in the row,
   * because provisioning deletes the invite — a reveal inside the row would be
   * unmounted by the refresh before anyone could copy it.
   */
  const [issued, setIssued] = useState<{ label: string; password: string } | null>(null);

  return (
    <>
      <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Team members</h2>
            <p className="mt-1 text-sm text-brand-ink/60">
              {accessError ? (
                <>Sign-in state unknown — {staff.length} account{staff.length === 1 ? "" : "s"} listed</>
              ) : (
                <>
                  {enabledCount} of {staff.length} account{staff.length === 1 ? "" : "s"} can sign in
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-lg bg-brand-cream px-3 py-1.5 text-xs font-semibold text-brand-ink/50">
              {companies.length} companies
            </span>
            {canManage && (
              <Button size="sm" onClick={() => setUserPanelOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add member
              </Button>
            )}
          </div>
        </header>

        {accessError && (
          <div className="mb-4">
            <Notice>
              Supabase Auth could not be read, so no badge below can be trusted — a disabled
              account may be showing as Active. Editing details and company still works, but
              disabling an account, deleting one, and changing a Super Admin&rsquo;s role are
              refused until the directory answers again.
            </Notice>
          </div>
        )}

        {staff.length === 0 ? (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink/60">
            No staff accounts yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {staff.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                bannedUntil={access[member.id] ?? null}
                accessUnknown={Boolean(accessError)}
                isSelf={member.auth_user_id === viewerAuthUserId}
                companies={companies}
                companyName={companyName}
                canManage={canManage}
                onEdit={() => setEditingMember(member)}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        )}

        {!canManage && (
          <p className="mt-4 text-[11px] leading-relaxed text-brand-ink/45">
            Read-only — assigning roles, resetting passwords and disabling accounts needs the
            Manage users permission.
          </p>
        )}
      </section>

      {canManage && (
        <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-soft sm:p-6">
          <header className="mb-3">
            <h2 className="font-display text-lg font-bold">Pending invites</h2>
            <p className="mt-1 text-sm text-brand-ink/60">
              {invitesError
                ? "Could not be read — see the notice below."
                : invites.length === 0
                  ? "Nothing waiting. Invites recorded here are not emailed by the platform."
                  : `${invites.length} recorded — no account exists yet, so these people cannot sign in.`}
            </p>
          </header>

          {invitesError && (
            <div className="mb-3">
              <Notice>
                The invite list could not be read, so it is shown empty rather than guessed at.
                Recording a new invite still works; it will appear once this reads again.
              </Notice>
            </div>
          )}

          {issued && (
            <CredentialReveal
              label={issued.label}
              password={issued.password}
              onDismiss={() => setIssued(null)}
            />
          )}

          {invites.length > 0 && (
            <ul className="mt-3 space-y-3">
              {invites.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  companyName={companyName}
                  timeZone={timeZone}
                  onIssued={setIssued}
                  onEdit={() => setEditingInvite(invite)}
                  onChanged={() => router.refresh()}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <UserCreatePanel
        companies={companies}
        passwordMinLength={passwordMinLength}
        open={userPanelOpen}
        onClose={() => setUserPanelOpen(false)}
        onSuccess={() => setUserPanelOpen(false)}
      />

      {editingMember && (
        <MemberEditPanel
          key={editingMember.id}
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {editingInvite && (
        <InviteEditPanel
          key={editingInvite.id}
          invite={editingInvite}
          companies={companies}
          onClose={() => setEditingInvite(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

function MemberRow({
  member,
  bannedUntil,
  accessUnknown,
  isSelf,
  companies,
  companyName,
  canManage,
  onEdit,
  onChanged,
}: {
  member: StaffMember;
  bannedUntil: string | null;
  accessUnknown: boolean;
  isSelf: boolean;
  companies: Company[];
  companyName: Map<string, string>;
  canManage: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const disabled = Boolean(bannedUntil);

  async function run(action: string, fn: () => Promise<StaffActionResult>, warning?: string) {
    if (warning && !window.confirm(warning)) return;
    setPending(action);
    setError(null);
    setNotice(null);
    setCredential(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? `Could not ${action.toLowerCase()}.`);
        return;
      }
      // Done, but not everything the button promised — the account exists and the
      // invite did not, for example. Said out loud rather than reported as clean.
      if (result.error) setNotice(result.error);
      if (result.temp_password) setCredential(result.temp_password);
      // Role and company come from the server component's props, so the panel has
      // to be re-fetched — and the revealed password survives because it is held
      // in this row's own state.
      onChanged();
    } catch {
      setError(`Something went wrong while trying to ${action.toLowerCase()}.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="rounded-xl border border-brand-line bg-white p-3.5 shadow-soft">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-dark">
          {member.full_name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="block truncate text-sm font-semibold">{member.full_name}</span>
            {isSelf && <Badge tone="info">You</Badge>}
          </span>
          <span className="block truncate text-xs text-brand-ink/50">
            {member.email}
            {member.phone ? ` · ${member.phone}` : ""}
          </span>
        </span>
        {canManage && (
          <Badge tone={disabled ? "danger" : accessUnknown ? "neutral" : "success"}>
            {disabled ? "Disabled" : accessUnknown ? "State unknown" : "Active"}
          </Badge>
        )}
      </div>

      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Role
            <select
              className={FIELD}
              value={member.role}
              disabled={pending !== null}
              aria-label={`Role for ${member.full_name}`}
              onChange={(e) =>
                run(`Change role to ${roleLabel(e.target.value)}`, () =>
                  updateStaffRole(member.id, e.target.value as AssignableStaffRole)
                )
              }
            >
              {ASSIGNABLE_STAFF_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-ink/45">
            Company
            <select
              className={FIELD}
              value={member.tenant_id ?? ""}
              disabled={pending !== null}
              aria-label={`Company for ${member.full_name}`}
              onChange={(e) =>
                run("Change company", () => updateStaffCompany(member.id, e.target.value || null))
              }
            >
              <option value="">Group-wide</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-brand-ink/45">
          {member.tenant_id ? companyName.get(member.tenant_id) ?? "—" : "Group-wide"} ·{" "}
          {roleLabel(member.role)}
        </p>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={ACTION}
            disabled={pending !== null}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit details
          </button>
          <button
            type="button"
            className={ACTION}
            disabled={pending !== null}
            onClick={() =>
              run(
                "Reset password",
                () => resetStaffPassword(member.id),
                isSelf
                  ? "Generate a new password for your own account? The current one stops working immediately, and you will need the new one to sign in again — copy it before you dismiss it."
                  : `Generate a new password for ${member.full_name}? Their current password stops working immediately.`
              )
            }
          >
            {pending === "Reset password" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
            )}
            Reset password
          </button>

          {!isSelf &&
            (disabled ? (
              <>
                <button
                  type="button"
                  className={ACTION}
                  disabled={pending !== null}
                  onClick={() => run("Re-enable", () => setStaffActive(member.id, true))}
                >
                  {pending === "Re-enable" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Re-enable
                </button>
                <button
                  type="button"
                  className={ACTION}
                  disabled={pending !== null}
                  onClick={() =>
                    run("Delete account", () => deleteStaffAccount(member.id),
                      `Delete ${member.email} permanently? Their sign-in and profile row are removed, and their name is unlinked from the interviews they booked — those records stay. Re-enable instead if they are coming back.`)
                  }
                >
                  {pending === "Delete account" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Delete account
                </button>
              </>
            ) : (
              <button
                type="button"
                className={ACTION}
                disabled={pending !== null}
                onClick={() =>
                  run("Disable", () => setStaffActive(member.id, false),
                    `Disable ${member.full_name}? They cannot sign in again until you re-enable them. Anything they already recorded stays. A session already open on their device lasts until it expires on its own.`)
                }
              >
                {pending === "Disable" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                )}
                Disable
              </button>
            ))}

          {isSelf && (
            <span className="text-[11px] text-brand-ink/45">
              You cannot disable or delete the account you are signed in with.
            </span>
          )}
        </div>
      )}

      {credential && (
        <CredentialReveal
          label={`New password for ${member.full_name}`}
          password={credential}
          onDismiss={() => setCredential(null)}
        />
      )}

      {notice && (
        <div className="mt-3">
          <Notice>{notice}</Notice>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </li>
  );
}

function InviteRow({
  invite,
  companyName,
  timeZone,
  onIssued,
  onEdit,
  onChanged,
}: {
  invite: StaffInvite;
  companyName: Map<string, string>;
  timeZone: string;
  onIssued: (credential: { label: string; password: string }) => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const assignable = ASSIGNABLE_ROLE_KEYS.has(invite.role);

  async function run(action: string, fn: () => Promise<StaffActionResult>, warning?: string) {
    if (warning && !window.confirm(warning)) return;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? `Could not ${action.toLowerCase()}.`);
        return;
      }
      if (result.error) setNotice(result.error);
      if (result.temp_password) {
        onIssued({ label: `Password for ${invite.full_name}`, password: result.temp_password });
      }
      onChanged();
    } catch {
      setError(`Something went wrong while trying to ${action.toLowerCase()}.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="rounded-xl border border-brand-line bg-brand-cream p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{invite.full_name}</p>
          <p className="truncate text-xs text-brand-ink/55">{invite.email}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-brand-ink/45">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {roleLabel(invite.role)} ·{" "}
            {invite.company_id ? companyName.get(invite.company_id) ?? "—" : "Group-wide"} ·
            expires {formatInZone(invite.expires_at, timeZone, DAY_MONTH)}
          </p>
        </div>
        <Badge tone={assignable ? "neutral" : "danger"}>Pending</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ACTION}
          disabled={pending !== null}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
        {assignable && (
          <button
            type="button"
            className={ACTION}
            disabled={pending !== null}
            onClick={() =>
              run("Create account", () => provisionInvite(invite.id),
                `Create ${invite.email}'s account now? A password is generated for you to hand over — nothing is emailed to them.`)
            }
          >
            {pending === "Create account" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserCheck className="h-3.5 w-3.5" aria-hidden />
            )}
            Create account
          </button>
        )}
        <button
          type="button"
          className={ACTION}
          disabled={pending !== null}
          onClick={() =>
            run("Cancel invite", () => cancelInvite(invite.id),
              `Discard the invite for ${invite.email}? The email is then free to invite again.`)
          }
        >
          {pending === "Cancel invite" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          )}
          Cancel invite
        </button>
      </div>

      {!assignable && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-brand-ink/50">
          This invite asks for the {roleLabel(invite.role)} role, which no account can hold yet —
          Create account stays hidden until you Edit it onto a role that is offered there.
        </p>
      )}

      {notice && (
        <div className="mt-3">
          <Notice>{notice}</Notice>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </li>
  );
}
