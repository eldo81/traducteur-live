import "server-only";
import { AccessToken, AgentDispatchClient, RoomServiceClient, WebhookReceiver } from "livekit-server-sdk";
import { AGENT_NAME, type Role, type RoomMetadata } from "@/lib/contract";
import { serverEnv } from "@/lib/env";

/** Server SDK clients want https://, LIVEKIT_URL is usually wss://. */
export function toHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

function cfg() {
  return serverEnv().livekit();
}

export function roomService(): RoomServiceClient {
  const c = cfg();
  return new RoomServiceClient(toHttpUrl(c.url), c.apiKey, c.apiSecret);
}

export function dispatchClient(): AgentDispatchClient {
  const c = cfg();
  return new AgentDispatchClient(toHttpUrl(c.url), c.apiKey, c.apiSecret);
}

export function webhookReceiver(): WebhookReceiver {
  const c = cfg();
  return new WebhookReceiver(c.apiKey, c.apiSecret);
}

export function publicLivekitUrl(): string {
  return cfg().publicUrl;
}

/** Join token for "host" or "guest" in room `roomName` (= call_rooms.id). */
export async function createJoinToken(opts: {
  roomName: string;
  identity: Role;
  name?: string;
  ttlSeconds?: number;
  /** face-to-face only: the host client publishes turn hints on topic "face_turn" */
  canPublishData?: boolean;
}): Promise<string> {
  const c = cfg();
  const at = new AccessToken(c.apiKey, c.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttlSeconds ?? 60 * 60 * 2,
  });
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
    // Call clients do not publish data; only the agent does (captions, billing).
    canPublishData: opts.canPublishData ?? false,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}

/**
 * Creates the LiveKit room if needed and (re)writes its metadata, so the
 * agent always reads the current settings from room.metadata.
 */
export async function ensureRoom(metadata: RoomMetadata): Promise<void> {
  const svc = roomService();
  const json = JSON.stringify(metadata);
  await svc.createRoom({
    name: metadata.room_id,
    metadata: json,
    emptyTimeout: 120, // seconds; then room_finished webhook closes the call
    departureTimeout: 60,
    maxParticipants: 3, // host + guest + agent
  });
  // createRoom on an existing room does not change it: set metadata explicitly.
  await svc.updateRoomMetadata(metadata.room_id, json);
}

/** Dispatches the "interprete" agent once per room. */
export async function dispatchAgentOnce(
  metadata: RoomMetadata,
  extraJobMetadata?: Record<string, string | boolean>,
): Promise<void> {
  const client = dispatchClient();
  const existing = await client.listDispatch(metadata.room_id);
  if (existing.some((d) => d.agentName === AGENT_NAME)) return;
  await client.createDispatch(metadata.room_id, AGENT_NAME, {
    metadata: JSON.stringify({ ...metadata, ...(extraJobMetadata ?? {}) }),
  });
}

export async function closeRoom(roomName: string): Promise<void> {
  try {
    await roomService().deleteRoom(roomName);
  } catch {
    // already gone
  }
}
