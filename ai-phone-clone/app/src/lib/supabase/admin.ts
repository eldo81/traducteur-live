import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError, publicEnv, serverEnv } from "@/lib/env";
import type { Database } from "./types";

let admin: SupabaseClient<Database> | null = null;

/**
 * Service-role client: bypasses RLS. Server code only (webhooks, guest join,
 * status changes). Never import from a client component.
 */
export function getAdminSupabase(): SupabaseClient<Database> {
  if (!publicEnv.supabaseUrl) throw new ConfigError(["NEXT_PUBLIC_SUPABASE_URL"]);
  if (!admin) {
    admin = createClient<Database>(publicEnv.supabaseUrl, serverEnv().supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export async function getBalanceSeconds(db: SupabaseClient<Database>, userId: string): Promise<number> {
  const { data, error } = await db.from("credit_balances").select("balance_seconds").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.balance_seconds ?? 0;
}
