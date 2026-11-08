import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";

/** Only same-site relative paths are accepted as ?next= (no open redirect). */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/appel";
  return value;
}

/** Magic link (PKCE ?code= or ?token_hash=) and Google OAuth return here. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = appOrigin(req);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  try {
    const supabase = await getServerSupabase();
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    }
  } catch {
    // fall through
  }
  return NextResponse.redirect(`${origin}/?erreur=connexion`);
}
