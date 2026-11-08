import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api";
import { MIN_START_SECONDS } from "@/lib/billing";
import { buildRoomMetadata, IDENTITY_HOST } from "@/lib/contract";
import { LANGUAGE_CODES } from "@/lib/languages";
import { createJoinToken, dispatchAgentOnce, ensureRoom, publicLivekitUrl } from "@/lib/livekit/server";
import { insertRoom } from "@/lib/rooms";
import { getBalanceSeconds } from "@/lib/supabase/admin";
import { getServerSupabase, getUser } from "@/lib/supabase/server";

const bodySchema = z
  .object({ host_lang: z.enum(LANGUAGE_CODES), guest_lang: z.enum(LANGUAGE_CODES) })
  .strict()
  .refine((v) => v.host_lang !== v.guest_lang, { message: "langs_differ" });

/**
 * POST /api/face/token : face-to-face (S10). Same room mechanism as a call,
 * one participant ("host") and the agent, dispatched right away.
 * The job metadata carries an extra `face_to_face: true` flag (room metadata
 * keeps the exact contract keys). Billed like a call by the agent.
 */
export async function POST(req: Request) {
  try {
    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError("bad_request", parsed.error.issues[0]?.message ?? "invalid body");

    const balance = await getBalanceSeconds(supabase, user.id);
    if (balance < MIN_START_SECONDS) {
      return apiError("payment_required", "insufficient balance", { extra: { balance_seconds: balance } });
    }

    const room = await insertRoom(supabase, user.id, {
      mode: "voice",
      host_lang: parsed.data.host_lang,
      guest_lang: parsed.data.guest_lang,
      host_voice: "auto",
      guest_voice: "auto",
      // Same device: no original voice to mix back in.
      mute_original_host: true,
      mute_original_guest: true,
    });

    const metadata = buildRoomMetadata(room);
    await ensureRoom(metadata);
    await dispatchAgentOnce(metadata, { face_to_face: true });

    const token = await createJoinToken({ roomName: room.id, identity: IDENTITY_HOST, canPublishData: true });
    return apiOk({ livekit_url: publicLivekitUrl(), token, room_id: room.id, balance_seconds: balance });
  } catch (err) {
    return handleApiError(err);
  }
}
