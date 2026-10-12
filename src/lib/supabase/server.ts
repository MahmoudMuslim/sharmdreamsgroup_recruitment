import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/config";

/**
 * Server-side Supabase client bound to the request cookie jar.
 * Used by Server Components and Server Actions that act on behalf of the
 * signed-in recruiter/admin (anon key + user JWT — RLS enforced).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component render pass — safe to ignore
          // because the session cannot be refreshed from a layout render.
        }
      },
    },
  });
}
