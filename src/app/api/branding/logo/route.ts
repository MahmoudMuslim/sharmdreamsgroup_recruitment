import { getStringSetting } from "@/modules/settings/infrastructure/settingsReader";
import { NextResponse } from "next/server";

/** The shipped wordmark asset, used when the setting is empty or unusable. */
const DEFAULT_LOGO_PATH = "/sdg-icon.png";

/**
 * Serves the group wordmark from Settings → Organisation & branding.
 *
 * Every header and sign-in card points here instead of at the asset directly,
 * so the configured path takes effect on all surfaces at once and without a
 * rebuild. `no-store` keeps a settings change visible on the next page view.
 */
export async function GET(request: Request) {
  const configured = await getStringSetting("branding.logo_url", DEFAULT_LOGO_PATH);
  const isSameOriginPath = configured.startsWith("/") && !configured.startsWith("//");
  const isAbsoluteUrl = /^https?:\/\//i.test(configured);
  const target = isSameOriginPath || isAbsoluteUrl ? configured : DEFAULT_LOGO_PATH;

  const url = target.startsWith("/")
    ? new URL(target, new URL(request.url).origin)
    : new URL(target);

  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
