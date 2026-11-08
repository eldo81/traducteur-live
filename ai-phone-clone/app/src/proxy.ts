import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets, the guest page, API routes (they check auth themselves) and PWA files.
  matcher: ["/((?!_next/static|_next/image|api/|j/|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|icon\\.svg).*)"],
};
