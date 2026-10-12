import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 * Only import from server-side code (route handlers, server actions, scripts).
 * Never expose the resulting instance to the browser bundle.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (!supabaseConfig.serviceRoleKey) {
    throw new Error("[supabase] SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  if (!serviceClient) {
    serviceClient = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return serviceClient;
}
