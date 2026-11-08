import type { Metadata } from "next";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { isRoomOpen } from "@/lib/rooms";
import { isValidLinkToken } from "@/lib/token";
import { GuestJoin, type GuestRoomInfo } from "./GuestJoin";

export const metadata: Metadata = {
  title: "Rejoindre un appel traduit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Only languages and status are read here; nothing about the host is exposed. */
async function loadRoom(token: string): Promise<GuestRoomInfo> {
  if (!isValidLinkToken(token)) return { state: "invalid" };
  try {
    const { data } = await getAdminSupabase()
      .from("call_rooms")
      .select("host_lang, guest_lang, status, expires_at")
      .eq("link_token", token)
      .maybeSingle();
    if (!data) return { state: "invalid" };
    if (!isRoomOpen(data)) return { state: "expired" };
    return { state: "open", host_lang: data.host_lang, guest_lang: data.guest_lang };
  } catch {
    // Not configured (local dev) or DB unavailable: the join call reports the real status.
    return { state: "unknown" };
  }
}

export default async function GuestPage({ params }: PageProps<"/j/[token]">) {
  const { token } = await params;
  const room = await loadRoom(token);
  return <GuestJoin token={token} room={room} />;
}
