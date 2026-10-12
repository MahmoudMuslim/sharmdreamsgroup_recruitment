"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateRolePermission } from "@/app/(admin)/settings/actions";
import { Card } from "@/modules/analytics/presentation/ui";
import { cn } from "@/lib/utils";
import type { Permission, Role, RoleGrant } from "@/modules/settings/domain/types";

/**
 * Role × permission matrix.
 *
 * Lives in its own panel rather than under every platform tab — it used to be
 * appended to each tab, which pushed the actual controls below the fold.
 */
export function PermissionMatrixCard({
  roles,
  permissions,
  grants,
  editable,
}: {
  roles: Role[];
  permissions: Permission[];
  grants: RoleGrant[];
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const grantedMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const grant of grants) map.set(`${grant.role_key}:${grant.permission_key}`, grant.granted);
    return map;
  }, [grants]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const list = byGroup.get(permission.group_name) ?? [];
      list.push(permission);
      byGroup.set(permission.group_name, list);
    }
    return Array.from(byGroup.entries());
  }, [permissions]);

  function toggle(roleKey: string, permissionKey: string, current: boolean) {
    const key = `${roleKey}:${permissionKey}`;
    setSavingKey(key);
    startTransition(async () => {
      await updateRolePermission(roleKey as never, permissionKey, !current);
      setSavingKey(null);
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg font-bold">Roles &amp; permissions</h2>
        <p className="mt-1 text-sm text-brand-ink/60">
          Granular access control across the platform. Super Admin always holds every
          permission.
        </p>
      </header>

      <div className="space-y-4">
        {!editable && (
          <p className="rounded-xl border border-brand-line bg-brand-cream px-4 py-3 text-xs text-brand-ink/60">
            You can view the permission matrix, but editing requires the
            <code className="mx-1 rounded bg-brand-sand px-1 py-0.5 font-mono">
              settings.manage_roles
            </code>
            permission.
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-brand-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-sand/70 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50">
              <tr>
                <th className="px-4 py-3">Permission</th>
                {roles.map((role) => (
                  <th key={role.key} className="px-3 py-3 text-center">
                    {role.label.replace(/\s+/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {groups.map(([group, items]) => (
                // Fragment carries the key — a bare <> cannot, which previously
                // produced a React key warning on every group heading.
                <Fragment key={group}>
                  <tr className="bg-brand-cream">
                    <td
                      colSpan={roles.length + 1}
                      className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-ink/50"
                    >
                      {group}
                    </td>
                  </tr>
                  {items.map((permission) => (
                    <tr key={permission.key} className="transition hover:bg-brand-cream/60">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{permission.label}</p>
                        <p className="font-mono text-[11px] text-brand-ink/40">{permission.key}</p>
                      </td>
                      {roles.map((role) => {
                        const key = `${role.key}:${permission.key}`;
                        const granted = grantedMap.get(key) ?? false;
                        const locked = role.key === "SUPER_ADMIN" || !editable || pending;
                        return (
                          <td key={role.key} className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => toggle(role.key, permission.key, granted)}
                              aria-label={`${permission.label} for ${role.label}`}
                              aria-pressed={granted}
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-md border transition",
                                granted
                                  ? "border-brand-gold bg-brand-gold text-white"
                                  : "border-brand-line bg-white hover:bg-brand-sand",
                                locked && "cursor-not-allowed opacity-70"
                              )}
                            >
                              {savingKey === key ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : granted ? (
                                <Check className="h-3.5 w-3.5" aria-hidden />
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}