import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { LANGUAGE_CODES, VOICE_IDS } from "@/lib/languages";
import type { Database, CallRoomRow } from "@/lib/supabase/types";
import { generateLinkToken } from "@/lib/token";
import { isUniqueViolation } from "@/lib/webhook-idempotency";

export const createRoomSchema = z
  .object({
    mode: z.enum(["voice", "video"]).default("voice"),
    host_lang: z.enum(LANGUAGE_CODES),
    guest_lang: z.enum(LANGUAGE_CODES),
    host_voice: z.enum(VOICE_IDS).default("auto"),
    guest_voice: z.enum(VOICE_IDS).default("auto"),
    mute_original_host: z.boolean().default(true),
    mute_original_guest: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.host_lang !== v.guest_lang, { message: "langs_differ", path: ["guest_lang"] });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/** Inserts a room with the user's own client (RLS: host_id = auth.uid(), status waiting). */
export async function insertRoom(
  db: SupabaseClient<Database>,
  hostId: string,
  input: CreateRoomInput,
): Promise<CallRoomRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db
      .from("call_rooms")
      .insert({ ...input, host_id: hostId, link_token: generateLinkToken(), status: "waiting", billed_seconds: 0 })
      .select("*")
      .single();
    if (!error && data) return data;
    if (!isUniqueViolation(error)) throw error;
    // link_token collision (astronomically unlikely): retry with a new token
  }
  throw new Error("could not allocate link token");
}

export function isRoomOpen(room: Pick<CallRoomRow, "status" | "expires_at">, now = Date.now()): boolean {
  if (room.status !== "waiting" && room.status !== "live") return false;
  return new Date(room.expires_at).getTime() > now;
}
