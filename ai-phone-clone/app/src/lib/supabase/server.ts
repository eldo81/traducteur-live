import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ConfigError, isSupabaseConfigured, publicEnv } from "@/lib/env";
import type { Database } from "./types";

/** Server client bound to the request cookies (user session, RLS applies). */
export async function getServerSupabase(): Promise<SupabaseClient<Database>> {
  if (!isSupabaseConfigured()) throw new ConfigError(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** Verified user (getUser hits Supabase Auth, unlike getSession). */
export async function getUser(supabase: SupabaseClient<Database>): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
