// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool, AssignableStaffRole } from "./shared";
import {
  STAFF_ROLES,
  ToolArgumentError,
  bool,
  loadSettings,
  optionalStr,
  report,
  setStaffActive,
  str,
  updateStaffCompany,
  updateStaffDetails,
  updateStaffRole,
} from "./shared";

/* Team tools. */

export const team: readonly AssistantTool[] = [
  {
    name: "edit_staff_member",
    label: "Editing a team record",
    description:
      "Change a staff member's name, email or phone, their role, or the company they belong to. Only the fields sent are written. Sign-in is blocked with set_staff_active, not here.",
    args: {
      profile_id: "string — from list_team",
      full_name: "string — optional",
      email: "string — optional",
      phone: "string — optional",
      role: `string — optional, one of ${STAFF_ROLES.join(", ")}`,
      company_id: "string — optional company id, or blank to clear",
    },
    run: async (args) => {
      const profileId = str(args, "profile_id");
      const results: Record<string, unknown> = { ok: true, profile_id: profileId };

      const name = optionalStr(args, "full_name");
      const email = optionalStr(args, "email");
      if (name || email) {
        const bundle = await loadSettings();
        const member = bundle.staff.find((each) => each.id === profileId);
        if (!member) return { ok: false, error: "No staff account has that profile id." };
        const written = report(
          await updateStaffDetails(profileId, {
            full_name: name ?? member.full_name,
            email: email ?? member.email,
            phone: optionalStr(args, "phone") ?? member.phone ?? null,
          })
        );
        if (!written.ok) return written;
        results.details = written;
      }

      const role = optionalStr(args, "role");
      if (role) {
        const upper = role.toUpperCase();
        if (!STAFF_ROLES.includes(upper as AssignableStaffRole)) {
          throw new ToolArgumentError(`"role" must be one of: ${STAFF_ROLES.join(", ")}.`);
        }
        results.role = report(await updateStaffRole(profileId, upper as AssignableStaffRole));
      }

      if (args.company_id !== undefined) {
        results.company = report(
          await updateStaffCompany(profileId, optionalStr(args, "company_id") ?? null)
        );
      }

      if (!results.details && !results.role && !results.company) {
        return { ok: false, error: "Nothing to change — send full_name, email, role or company_id." };
      }
      return results;
    },
  },
  {
    name: "set_staff_active",
    label: "Activating or blocking a staff account",
    description:
      "Let a team member sign in, or block them. Blocking keeps their answers, applications and interview attribution — it is the offered path over deleting a person.",
    args: {
      profile_id: "string — from list_team",
      active: "boolean — true to allow sign-in, false to block",
    },
    run: async (args) =>
      report(await setStaffActive(str(args, "profile_id"), bool(args, "active", true))),
  },

];
