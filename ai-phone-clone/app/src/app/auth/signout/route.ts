import { NextResponse } from "next/server";
import { appOrigin, isSupabaseConfigured } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";

/** POST /auth/signout : ends the session on every device (scope global). */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) {
    const supabase = await getServerSupabase();
    await supabase.auth.signOut({ scope: "global" });
  }
  return NextResponse.redirect(`${appOrigin(req)}/`, { status: 303 });
}
