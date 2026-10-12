"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/config";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/** Browser Supabase client (anon key, RLS enforced). */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseConfig.url, supabaseConfig.anonKey);
  }
  return browserClient;
}
