// One section of the assistant's tool registry — see ./shared.ts and ../tools.ts.

import type { AssistantTool, MasterPayload } from "./shared";
import {
  FILED_ENTITIES,
  MASTER_ENTITIES,
  ToolArgumentError,
  bool,
  createMasterRecord,
  filedEntity,
  masterEntity,
  optionalStr,
  refileFiling,
  report,
  str,
  updateMasterRecord,
  updateRolePermission,
} from "./shared";

/* Master data tools. */

export const masterData: readonly AssistantTool[] = [
  {
    name: "save_master_record",
    label: "Saving a master-data record",
    description:
      "Add or edit one entry in a controlled vocabulary — a company, department, location, role family, skill or currency. Jobs and prospects can only use values that exist here. A name the list already carries is refused however it is spelled: two rows that read alike are decided by the list's own order everywhere else in the portal, so edit the row you mean rather than adding a second copy. This is also the way to bring a retired row back into use: send fields {\"is_active\": true}, the switch the console's Reactivate button writes.",
    args: {
      entity: `string — one of ${MASTER_ENTITIES.join(", ")}`,
      id: "string — optional, the record being edited",
      fields:
        'object — the columns to write, e.g. {"name":"Housekeeping"} or {"label":"US Dollar"} for a currency. Only the columns sent are written, so an edit never quietly re-activates a retired row; send {"is_active":true} when it should come back, or {"is_active":false} to retire it.',
    },
    run: async (args) => {
      const entity = masterEntity(str(args, "entity"));
      const fields = args.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new ToolArgumentError('"fields" must be an object of column names to values.');
      }
      const payload = fields as MasterPayload;
      const id = optionalStr(args, "id");
      return report(
        id
          ? await updateMasterRecord(entity, id, payload)
          : await createMasterRecord(entity, payload)
      );
    },
  },
  {
    name: "refile_filing",
    label: "Refileing openings onto a master-data row",
    description:
      "Move every job opening currently filed under one value onto a row the master-data list holds and has in use — the bulk repair behind the Settings → Organisation drift desk, and the only way to clear the spellings the seeds left. `from` is the text the openings carry, exactly as get_filing_drift names it (send it empty for the openings that carry nothing); `to` is one live row: a company id, a department or location name, a currency code. A destination the list does not hold in use is refused, so a refile cannot create new drift or move a role onto a retired row. One write over the matched openings, recorded in the change trail, and it changes what the public board offers applicants.",
    args: {
      entity: `string — one of ${FILED_ENTITIES.join(", ")}`,
      from: "string — the value the openings carry now, as get_filing_drift reports it; empty when they carry no value at all",
      to: "string — the live row to move them onto: company id, department or location name, currency code",
    },
    run: async (args) => {
      const entity = filedEntity(str(args, "entity"));
      const from = args.from;
      if (typeof from !== "string") {
        throw new ToolArgumentError(
          '"from" must be a string — the value the openings carry, exactly as get_filing_drift names it, or "" for the ones that carry nothing.'
        );
      }
      return report(await refileFiling(entity, from, str(args, "to")));
    },
  },
  {
    name: "set_role_permission",
    label: "Granting or revoking a permission",
    description:
      "Turn one permission on or off for one role. This changes what every account with that role — and this assistant — is allowed to do.",
    args: {
      role_key: "string — role key from get_settings",
      permission_key: "string — permission key, e.g. candidates.write",
      granted: "boolean",
    },
    run: async (args) =>
      report(
        await updateRolePermission(
          str(args, "role_key") as Parameters<typeof updateRolePermission>[0],
          str(args, "permission_key"),
          bool(args, "granted", true)
        )
      ),
  },

];
