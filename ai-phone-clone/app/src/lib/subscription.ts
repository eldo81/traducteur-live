import { otherRole, translatedTrackFor, TRACK_FOR_GUEST, TRACK_FOR_HOST, type Role, type RoomMetadata } from "./contract";

export const ORIGINAL_VOICE_VOLUME = 0.2;

export interface SubscriptionDecision {
  subscribe: boolean;
  volume: number;
}

const NO: SubscriptionDecision = { subscribe: false, volume: 0 };

/**
 * Which remote tracks a client should receive:
 *  - its own translated track ("tr-for-host" for the host, "tr-for-guest" for the guest), full volume;
 *  - never the translation meant for the other side (that would double the audio);
 *  - the other person's original microphone only when their side did not mute
 *    it (mute_original_<other> = false), at low volume under the translation;
 *  - the other person's camera (video calls).
 */
export function decideSubscription(input: {
  myRole: Role;
  participantIdentity: string;
  trackName: string;
  kind: "audio" | "video" | string;
  metadata: RoomMetadata | null;
}): SubscriptionDecision {
  const { myRole, participantIdentity, trackName, kind, metadata } = input;

  if (trackName === translatedTrackFor(myRole)) return { subscribe: true, volume: 1 };
  if (trackName === TRACK_FOR_HOST || trackName === TRACK_FOR_GUEST) return NO;

  const other = otherRole(myRole);
  if (participantIdentity !== other) return NO; // agent's other tracks, or unknown identities

  if (kind === "video") return { subscribe: true, volume: 0 };
  if (kind !== "audio") return NO;

  if (!metadata) return NO; // settings unknown: translation only
  const otherMuted = other === "host" ? metadata.mute_original_host : metadata.mute_original_guest;
  return otherMuted ? NO : { subscribe: true, volume: ORIGINAL_VOICE_VOLUME };
}
