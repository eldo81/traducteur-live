"use client";

import {
  ConnectionState,
  Room,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TranscriptionSegment,
  type Participant,
  type TrackPublication,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyCaption, type CaptionLine } from "@/lib/captions";
import {
  billingMessageSchema,
  captionMessageSchema,
  decodeJson,
  IDENTITY_GUEST,
  IDENTITY_HOST,
  otherRole,
  parseRoomMetadata,
  TOPIC_BILLING,
  TOPIC_CAPTIONS,
  TRACK_FOR_GUEST,
  TRACK_FOR_HOST,
  type Role,
} from "@/lib/contract";
import { decideSubscription } from "@/lib/subscription";

export type CallConnection = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export interface UseCallOptions {
  livekitUrl: string;
  token: string;
  role: Role;
  /** host only: initial balance from the token endpoint, counted down locally while both are present */
  initialBalanceSeconds?: number | null;
  /** face-to-face: no remote human expected */
  solo?: boolean;
}

export interface CallState {
  connection: CallConnection;
  otherPresent: boolean;
  agentPresent: boolean;
  captions: CaptionLine[];
  remainingSeconds: number | null;
  elapsedSeconds: number;
  micEnabled: boolean;
  micError: "denied" | "unavailable" | null;
  canPlayAudio: boolean;
  room: Room | null;
}

/** Transcription segments (fallback when the agent uses LiveKit transcriptions instead of the "captions" topic). */
function segmentsToCaptions(
  lines: CaptionLine[],
  segments: TranscriptionSegment[],
  participant: Participant | undefined,
  publication: TrackPublication | undefined,
): CaptionLine[] {
  let next = lines;
  const trackName = publication?.trackName;
  // Speech of a human participant = source text; agent track tr-for-X = translation of the other speaker.
  let speaker: Role | null = null;
  let isTranslation = false;
  if (participant?.identity === IDENTITY_HOST || participant?.identity === IDENTITY_GUEST) {
    speaker = participant.identity;
  } else if (trackName === TRACK_FOR_HOST) {
    speaker = IDENTITY_GUEST;
    isTranslation = true;
  } else if (trackName === TRACK_FOR_GUEST) {
    speaker = IDENTITY_HOST;
    isTranslation = true;
  }
  if (!speaker) return lines;
  for (const seg of segments) {
    const key = `seg:${seg.id}`;
    const idx = next.findIndex((l) => l.key === key);
    const base: CaptionLine =
      idx >= 0
        ? next[idx]
        : { key, speaker, lang_src: "", text_src: "", lang_dst: "", text_dst: "", final: false, seq: -1, at: Date.now() };
    const updated: CaptionLine = {
      ...base,
      final: seg.final,
      ...(isTranslation ? { text_dst: seg.text, lang_dst: seg.language || base.lang_dst } : { text_src: seg.text, lang_src: seg.language || base.lang_src }),
    };
    next = idx >= 0 ? next.map((l, i) => (i === idx ? updated : l)) : [...next, updated];
  }
  return next;
}

export function useCall(opts: UseCallOptions) {
  const { livekitUrl, token, role, initialBalanceSeconds, solo } = opts;
  const [state, setState] = useState<CallState>({
    connection: "connecting",
    otherPresent: false,
    agentPresent: false,
    captions: [],
    remainingSeconds: initialBalanceSeconds ?? null,
    elapsedSeconds: 0,
    micEnabled: false,
    micError: null,
    canPlayAudio: true,
    room: null,
  });
  const roomRef = useRef<Room | null>(null);

  const patch = useCallback((p: Partial<CallState> | ((s: CallState) => Partial<CallState>)) => {
    setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    roomRef.current = room;
    // Hidden container for the <audio> elements of subscribed tracks.
    const audioHost = document.createElement("div");
    audioHost.hidden = true;
    document.body.appendChild(audioHost);

    const other = otherRole(role);
    const refreshPresence = () => {
      const remotes = Array.from(room.remoteParticipants.values());
      patch({
        otherPresent: remotes.some((p) => p.identity === other),
        agentPresent: remotes.some((p) => p.isAgent),
      });
    };

    const applySubscriptions = () => {
      const metadata = parseRoomMetadata(room.metadata);
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          const d = decideSubscription({
            myRole: role,
            participantIdentity: p.identity,
            trackName: pub.trackName,
            kind: pub.kind,
            metadata,
          });
          if (pub.isSubscribed !== d.subscribe) pub.setSubscribed(d.subscribe);
        }
      }
    };

    const onTrackSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== "audio") return; // video tiles: V1 voice only (TODO video stage)
      const d = decideSubscription({
        myRole: role,
        participantIdentity: participant.identity,
        trackName: pub.trackName,
        kind: pub.kind,
        metadata: parseRoomMetadata(room.metadata),
      });
      const el = track.attach();
      el.setAttribute("data-track", pub.trackName || participant.identity);
      audioHost.appendChild(el);
      if ("setVolume" in track && typeof track.setVolume === "function") track.setVolume(d.volume || 1);
    };

    const onTrackUnsubscribed = (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
    };

    const onData = (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === TOPIC_CAPTIONS) {
        const msg = decodeJson(payload, captionMessageSchema);
        if (msg) patch((s) => ({ captions: applyCaption(s.captions, msg) }));
      } else if (topic === TOPIC_BILLING) {
        const msg = decodeJson(payload, billingMessageSchema);
        if (msg) patch({ remainingSeconds: msg.remaining_seconds });
      }
    };

    const onTranscription = (segments: TranscriptionSegment[], participant?: Participant, publication?: TrackPublication) => {
      patch((s) => ({ captions: segmentsToCaptions(s.captions, segments, participant, publication) }));
    };

    room
      .on(RoomEvent.ParticipantConnected, () => {
        refreshPresence();
        applySubscriptions();
      })
      .on(RoomEvent.ParticipantDisconnected, refreshPresence)
      .on(RoomEvent.TrackPublished, applySubscriptions)
      .on(RoomEvent.RoomMetadataChanged, applySubscriptions)
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      .on(RoomEvent.DataReceived, onData)
      .on(RoomEvent.TranscriptionReceived, onTranscription)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => patch({ canPlayAudio: room.canPlaybackAudio }))
      .on(RoomEvent.ConnectionStateChanged, (cs: ConnectionState) => {
        if (cs === ConnectionState.Connected) patch({ connection: "connected" });
        else if (cs === ConnectionState.Reconnecting || cs === ConnectionState.SignalReconnecting) patch({ connection: "reconnecting" });
      })
      .on(RoomEvent.Disconnected, () => patch({ connection: "disconnected", otherPresent: false, agentPresent: false }));

    (async () => {
      try {
        await room.connect(livekitUrl, token, { autoSubscribe: false });
        if (cancelled) return;
        patch({ connection: "connected", room, canPlayAudio: room.canPlaybackAudio });
        refreshPresence();
        applySubscriptions();
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (!cancelled) patch({ micEnabled: true, micError: null });
        } catch (err) {
          const name = err instanceof Error ? err.name : "";
          patch({ micEnabled: false, micError: name === "NotAllowedError" ? "denied" : "unavailable" });
        }
      } catch {
        if (!cancelled) patch({ connection: "error" });
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      audioHost.remove();
      roomRef.current = null;
    };
  }, [livekitUrl, token, role, patch]);

  // Duration + local countdown between billing messages (host side, only while the other side is there).
  useEffect(() => {
    if (state.connection !== "connected" || !(state.otherPresent || solo)) return;
    const id = setInterval(() => {
      setState((s) => ({
        ...s,
        elapsedSeconds: s.elapsedSeconds + 1,
        remainingSeconds: s.remainingSeconds == null ? null : Math.max(0, s.remainingSeconds - 1),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.connection, state.otherPresent, solo]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      patch({ micEnabled: next, micError: null });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      patch({ micEnabled: false, micError: name === "NotAllowedError" ? "denied" : "unavailable" });
    }
  }, [patch]);

  const startAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.startAudio();
    patch({ canPlayAudio: room.canPlaybackAudio });
  }, [patch]);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (room) await room.disconnect();
    patch({ connection: "disconnected" });
  }, [patch]);

  /** face-to-face: tell the agent whose turn it is (topic "face_turn"). */
  const publishTurn = useCallback(async (speaker: Role) => {
    const room = roomRef.current;
    if (!room) return;
    const data = new TextEncoder().encode(JSON.stringify({ speaker }));
    try {
      await room.localParticipant.publishData(data, { reliable: true, topic: "face_turn" });
    } catch {
      // token without data permission: ignore
    }
  }, []);

  return { ...state, toggleMic, startAudio, leave, publishTurn };
}
