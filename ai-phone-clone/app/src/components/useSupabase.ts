"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

export type SessionState =
  | { status: "loading"; supabase: SupabaseClient<Database> | null; user: null }
  | { status: "unconfigured"; supabase: null; user: null }
  | { status: "signed-out"; supabase: SupabaseClient<Database>; user: null }
  | { status: "signed-in"; supabase: SupabaseClient<Database>; user: User };

/** Browser Supabase client + current user (RLS applies to every query). */
export function useSupabaseSession(): SessionState {
  const [state, setState] = useState<SessionState>(() =>
    isSupabaseConfigured()
      ? { status: "loading", supabase: null, user: null }
      : { status: "unconfigured", supabase: null, user: null },
  );
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setState(data.user ? { status: "signed-in", supabase, user: data.user } : { status: "signed-out", supabase, user: null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setState(session?.user ? { status: "signed-in", supabase, user: session.user } : { status: "signed-out", supabase, user: null });
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export function useBalance(session: SessionState): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (session.status !== "signed-in") return;
    session.supabase
      .from("credit_balances")
      .select("balance_seconds")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setBalance(data?.balance_seconds ?? 0));
  }, [session]);
  return balance;
}
