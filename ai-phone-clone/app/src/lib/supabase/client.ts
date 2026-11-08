import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import type { Database } from "./types";

let client: SupabaseClient<Database> | null = null;

/** Browser client (anon key + user session, RLS applies). Null when not configured. */
export function getBrowserSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
