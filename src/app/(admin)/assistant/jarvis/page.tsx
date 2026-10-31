import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { jarvisSettingsHref } from "@/modules/settings/domain/settingsNav";

export const metadata = {
  title: "JARVIS · Assistant",
  description: "JARVIS settings now live in Settings → Assistant",
};

/** Auth-gated route: the address it hands over is one person's own console. */
export const instant = false;

/** The half of the moved page an old bookmark asked for. */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The old JARVIS page: one line that says where the two halves went.
 *
 * `/assistant/jarvis?tab=appearance` was a page with two tabs; both are now
 * sections of the Settings dock, so the tab name becomes a section and the `state`
 * a deep link carried travels with the half that edits colours. The translating
 * mapper lives in `settingsNav` because the chat, the alerts and this redirect all
 * have to write the same address.
 *
 * A `permanent: true` redirect in `next.config` could not do this: the destination
 * renames a parameter, and a config redirect that drops the query would send every
 * bookmark to Presence. The address is also the post-login return, so someone
 * signed out on this URL comes back to the section they asked for.
 */
export default async function AssistantJarvisPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const href = jarvisSettingsHref(
    typeof params.tab === "string" ? params.tab : null,
    typeof params.state === "string" ? params.state : null
  );

  await requireStaff(href);
  redirect(href);
}
