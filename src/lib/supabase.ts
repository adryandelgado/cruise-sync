import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Lazy Supabase client. Throws if env vars aren't set — callers should check
 * `env.supabaseConfigured` before calling for UX that degrades gracefully.
 */
export function supabase(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = env.requireSupabase();
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
