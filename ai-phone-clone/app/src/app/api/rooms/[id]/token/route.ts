import { apiError, apiOk, handleApiError, isUuid } from "@/lib/api";
import { MIN_START_SECONDS } from "@/lib/billing";
import { buildRoomMetadata, IDENTITY_HOST } from "@/lib/contract";
import { appOrigin } from "@/lib/env";
import { createJoinToken, ensureRoom, publicLivekitUrl } from "@/lib/livekit/server";
import { isRoomOpen } from "@/lib/rooms";
import { getAdminSupabase, getBalanceSeconds } from "@/lib/supabase/admin";
import { getServerSupabase, getUser } from "@/lib/supabase/server";

/** GET /api/rooms/:id/token : LiveKit token for the host (owner only, balance >= 30 s). */
export async function GET(req: Request, ctx: RouteContext<"/api/rooms/[id]/token">) {
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return apiError("not_found");

    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    // RLS: only the owner can read the row.
    const { data: room, error } = await supabase.from("call_rooms").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!room || room.host_id !== user.id) return apiError("not_found");
    if (!isRoomOpen(room)) return apiError("gone", "room closed");

    const balance = await getBalanceSeconds(supabase, user.id);
    if (balance < MIN_START_SECONDS) {
      return apiError("payment_required", "insufficient balance", { extra: { balance_seconds: balance } });
    }

    const metadata = buildRoomMetadata(room);
    await ensureRoom(metadata);

    // Track the host as participant (one active row per role; ignore if already there).
    const admin = getAdminSupabase();
    const { data: active } = await admin
      .from("participants")
      .select("id")
      .eq("room_id", room.id)
      .eq("role", "host")
      .is("left_at", null)
      .maybeSingle();
    if (!active) {
      await admin.from("participants").insert({
        room_id: room.id,
        role: "host",
        user_id: user.id,
        user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      });
    }

    const token = await createJoinToken({ roomName: room.id, identity: IDENTITY_HOST });
    return apiOk({
      livekit_url: publicLivekitUrl(),
      token,
      balance_seconds: balance,
      url: `${appOrigin(req)}/j/${room.link_token}`,
      room: {
        id: room.id,
        status: room.status,
        host_lang: room.host_lang,
        guest_lang: room.guest_lang,
        mute_original_host: room.mute_original_host,
        mute_original_guest: room.mute_original_guest,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
