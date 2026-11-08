import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api";
import { MIN_START_SECONDS } from "@/lib/billing";
import { buildRoomMetadata, IDENTITY_GUEST } from "@/lib/contract";
import { detectInAppBrowser } from "@/lib/in-app-browser";
import { createJoinToken, dispatchAgentOnce, ensureRoom, publicLivekitUrl } from "@/lib/livekit/server";
import { clientIpFromHeaders, SlidingWindowLimiter } from "@/lib/rate-limit";
import { isRoomOpen } from "@/lib/rooms";
import { getAdminSupabase, getBalanceSeconds } from "@/lib/supabase/admin";
import { isValidLinkToken } from "@/lib/token";

// 10 requests / minute / IP. TODO(prod): Upstash Ratelimit (shared across instances).
const limiter = new SlidingWindowLimiter(10, 60_000);

const bodySchema = z
  .object({
    display_name: z.string().trim().max(60).optional(),
    consent: z.literal(true),
  })
  .strict();

/** POST /api/join/:token : public. Guest joins with the link token. */
export async function POST(req: Request, ctx: RouteContext<"/api/join/[token]">) {
  try {
    const rl = limiter.check(clientIpFromHeaders(req.headers));
    if (!rl.ok) {
      return apiError("rate_limited", "too many requests", {
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      });
    }

    const { token } = await ctx.params;
    if (!isValidLinkToken(token)) return apiError("not_found");

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError("bad_request", "consent required");

    const admin = getAdminSupabase();
    const { data: room, error } = await admin.from("call_rooms").select("*").eq("link_token", token).maybeSingle();
    if (error) throw error;
    if (!room) return apiError("not_found");
    if (!isRoomOpen(room)) return apiError("gone", "room closed or expired");

    const balance = await getBalanceSeconds(admin, room.host_id);
    if (balance < MIN_START_SECONDS) return apiError("payment_required", "host balance too low");

    const ua = req.headers.get("user-agent") ?? "";
    const browser = detectInAppBrowser(ua);

    // One guest per room. A rejoin (page refresh, network switch) reuses the active row;
    // LiveKit replaces a connection that reuses the "guest" identity.
    // TODO: bind the guest to a signed cookie so a second person cannot take over the seat.
    const { data: activeGuest } = await admin
      .from("participants")
      .select("id")
      .eq("room_id", room.id)
      .eq("role", "guest")
      .is("left_at", null)
      .maybeSingle();
    if (!activeGuest) {
      const { error: insErr } = await admin.from("participants").insert({
        room_id: room.id,
        role: "guest",
        display_name: parsed.data.display_name || null,
        user_agent: ua.slice(0, 500) || null,
        in_app_browser: browser.inApp,
      });
      if (insErr && insErr.code !== "23505") throw insErr;
    }

    const metadata = buildRoomMetadata(room);
    await ensureRoom(metadata);
    await dispatchAgentOnce(metadata);

    const lkToken = await createJoinToken({
      roomName: room.id,
      identity: IDENTITY_GUEST,
      name: parsed.data.display_name || undefined,
    });

    return apiOk({
      livekit_url: publicLivekitUrl(),
      token: lkToken,
      room_id: room.id,
      langs: { host: room.host_lang, guest: room.guest_lang },
      mute_original_host: room.mute_original_host,
      mute_original_guest: room.mute_original_guest,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
