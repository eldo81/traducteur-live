/**
 * Shared contract between the web app and the Python translation agent
 * (ai-phone-clone/agent). Change a name here only together with the agent.
 */
import { z } from "zod";

/** Agent name used for explicit dispatch (LiveKit AgentDispatchClient). */
export const AGENT_NAME = "interprete";

/** Participant identities in a LiveKit room (room name = call_rooms.id). */
export const IDENTITY_HOST = "host";
export const IDENTITY_GUEST = "guest";
export type Role = typeof IDENTITY_HOST | typeof IDENTITY_GUEST;

/** Audio tracks published by the agent, one per listener. */
export const TRACK_FOR_HOST = "tr-for-host";
export const TRACK_FOR_GUEST = "tr-for-guest";
export function translatedTrackFor(role: Role): string {
  return role === IDENTITY_HOST ? TRACK_FOR_HOST : TRACK_FOR_GUEST;
}
export function otherRole(role: Role): Role {
  return role === IDENTITY_HOST ? IDENTITY_GUEST : IDENTITY_HOST;
}

/** Data topics published by the agent. */
export const TOPIC_CAPTIONS = "captions";
export const TOPIC_BILLING = "billing";

/**
 * Room metadata (JSON string) set on the LiveKit room and passed as the
 * dispatch job metadata. Exactly these keys.
 *
 * mute_original_host: true = the host's ORIGINAL voice is not heard by the
 * guest (the guest only hears the translation on "tr-for-guest").
 * mute_original_guest: same for the guest's original voice heard by the host.
 * (Speaker-centric, matches the S04 switches "Couper ma voix d'origine" /
 * "Couper sa voix d'origine".) Clients apply it by not subscribing to the
 * other participant's microphone track; when false, the original is played
 * at low volume under the translation. The agent may also read it.
 *
 * host_voice / guest_voice are speaker-centric too: host_voice is the voice that
 * speaks the HOST's words in the guest's language (track "tr-for-guest");
 * guest_voice speaks the GUEST's words to the host ("tr-for-host"). "auto" = agent default.
 */
export const roomMetadataSchema = z.object({
  room_id: z.uuid(),
  host_lang: z.string().min(2).max(16),
  guest_lang: z.string().min(2).max(16),
  host_voice: z.string().min(1).max(64),
  guest_voice: z.string().min(1).max(64),
  mute_original_host: z.boolean(),
  mute_original_guest: z.boolean(),
});
export type RoomMetadata = z.infer<typeof roomMetadataSchema>;

export function buildRoomMetadata(room: {
  id: string;
  host_lang: string;
  guest_lang: string;
  host_voice: string;
  guest_voice: string;
  mute_original_host: boolean;
  mute_original_guest: boolean;
}): RoomMetadata {
  return {
    room_id: room.id,
    host_lang: room.host_lang,
    guest_lang: room.guest_lang,
    host_voice: room.host_voice,
    guest_voice: room.guest_voice,
    mute_original_host: room.mute_original_host,
    mute_original_guest: room.mute_original_guest,
  };
}

export function parseRoomMetadata(raw: string | undefined | null): RoomMetadata | null {
  if (!raw) return null;
  try {
    const parsed = roomMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Payload on topic "captions". */
export const captionMessageSchema = z.object({
  speaker: z.enum([IDENTITY_HOST, IDENTITY_GUEST]),
  lang_src: z.string(),
  text_src: z.string(),
  lang_dst: z.string(),
  text_dst: z.string(),
  final: z.boolean(),
  seq: z.number().int().nonnegative(),
});
export type CaptionMessage = z.infer<typeof captionMessageSchema>;

/** Payload on topic "billing". */
export const billingMessageSchema = z.object({
  remaining_seconds: z.number().int(),
});
export type BillingMessage = z.infer<typeof billingMessageSchema>;

const decoder = new TextDecoder();
export function decodeJson<T>(payload: Uint8Array, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(decoder.decode(payload)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
