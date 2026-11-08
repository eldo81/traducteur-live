import { apiError, apiOk, handleApiError, isUuid } from "@/lib/api";
import { closeRoom } from "@/lib/livekit/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase, getUser } from "@/lib/supabase/server";

/** POST /api/rooms/:id/end : host hangs up. Idempotent. */
export async function POST(_req: Request, ctx: RouteContext<"/api/rooms/[id]/end">) {
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return apiError("not_found");

    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    const { data: room, error } = await supabase.from("call_rooms").select("id, host_id, status").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!room || room.host_id !== user.id) return apiError("not_found");

    // Status is server-written only (no RLS update policy): use the service role.
    const admin = getAdminSupabase();
    if (room.status === "waiting" || room.status === "live") {
      const { error: upErr } = await admin
        .from("call_rooms")
        .update({ status: "ended", end_reason: "host_hangup", ended_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["waiting", "live"]);
      if (upErr) throw upErr;
    }
    await admin.from("participants").update({ left_at: new Date().toISOString() }).eq("room_id", id).is("left_at", null);

    // Disconnects everyone, the agent included; the agent then writes utterances + summary.
    await closeRoom(id).catch(() => undefined);

    const { data: after } = await admin.from("call_rooms").select("billed_seconds").eq("id", id).single();
    return apiOk({ billed_seconds: after?.billed_seconds ?? 0 });
  } catch (err) {
    return handleApiError(err);
  }
}
