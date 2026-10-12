import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth 2.0 (Google) sign-in entry point.
 * Exchanges the `code` query param for a session cookie, then bounces back to
 * the originally requested page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Only allow same-origin relative redirects (open-redirect protection).
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  redirect(`/login?error=${encodeURIComponent("oauth_callback_failed")}`);
}