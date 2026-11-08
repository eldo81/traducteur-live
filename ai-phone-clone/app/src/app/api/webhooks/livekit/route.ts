import { apiError, apiOk, handleApiError, isUuid } from "@/lib/api";
import { IDENTITY_GUEST, IDENTITY_HOST } from "@/lib/contract";
import { webhookReceiver } from "@/lib/livekit/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * POST /api/webhooks/livekit : verified with WebhookReceiver (JWT in the
 * Authorization header, body sha256 checked).
 *  - participant_joined (guest): waiting -> live, started_at
 *  - participant_left: participants.left_at
 *  - room_finished: close orphan rooms still waiting/live (end_reason timeout)
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const auth = req.headers.get("authorization") ?? undefined;
    let event;
    try {
      event = await webhookReceiver().receive(raw, auth);
    } catch {
      return apiError("unauthorized", "invalid webhook signature");
    }

    const roomId = event.room?.name ?? "";
    if (!isUuid(roomId)) return apiOk({ ignored: true });
    const db = getAdminSupabase();
    const now = new Date().toISOString();
    const identity = event.participant?.identity;

    switch (event.event) {
      case "participant_joined": {
        if (identity === IDENTITY_GUEST) {
          // May fail on one_live_call_per_host if the host has another live call: leave it waiting.
          const { error } = await db
            .from("call_rooms")
            .update({ status: "live", started_at: now })
            .eq("id", roomId)
            .eq("status", "waiting");
          if (error && error.code !== "23505") throw error;
        }
        break;
      }
      case "participant_left":
      case "participant_connection_aborted": {
        if (identity === IDENTITY_HOST || identity === IDENTITY_GUEST) {
          const { error } = await db
            .from("participants")
            .update({ left_at: now })
            .eq("room_id", roomId)
            .eq("role", identity)
            .is("left_at", null);
          if (error) throw error;
        }
        break;
      }
      case "room_finished": {
        const { error } = await db
          .from("call_rooms")
          .update({ status: "ended", end_reason: "timeout", ended_at: now })
          .eq("id", roomId)
          .eq("status", "live");
        if (error) throw error;
        // A waiting room keeps its link valid until expires_at (guest may still come).
        await db.from("participants").update({ left_at: now }).eq("room_id", roomId).is("left_at", null);
        break;
      }
      default:
        break;
    }
    return apiOk({ received: true });
  } catch (err) {
    return handleApiError(err);
  }
}
