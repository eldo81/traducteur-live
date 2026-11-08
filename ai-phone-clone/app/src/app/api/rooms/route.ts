import { apiError, apiOk, handleApiError } from "@/lib/api";
import { appOrigin } from "@/lib/env";
import { createRoomSchema, insertRoom } from "@/lib/rooms";
import { getServerSupabase, getUser } from "@/lib/supabase/server";

/** POST /api/rooms : create a call room and its share link. */
export async function POST(req: Request) {
  try {
    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    const body = await req.json().catch(() => null);
    const parsed = createRoomSchema.safeParse(body);
    if (!parsed.success) return apiError("bad_request", parsed.error.issues[0]?.message ?? "invalid body");

    const room = await insertRoom(supabase, user.id, parsed.data);
    return apiOk({ room_id: room.id, url: `${appOrigin(req)}/j/${room.link_token}`, expires_at: room.expires_at }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
