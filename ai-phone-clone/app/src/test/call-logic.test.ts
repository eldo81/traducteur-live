import { describe, expect, it } from "vitest";
import { balanceLevel, formatClock } from "@/lib/billing";
import { applyCaption } from "@/lib/captions";
import { buildRoomMetadata, parseRoomMetadata, type RoomMetadata } from "@/lib/contract";
import { decideSubscription } from "@/lib/subscription";

const meta: RoomMetadata = {
  room_id: "3f1c2b8e-4d5a-4c3b-9a1e-2f3d4c5b6a7e",
  host_lang: "fr",
  guest_lang: "en",
  host_voice: "auto",
  guest_voice: "auto",
  mute_original_host: true,
  mute_original_guest: false,
};

describe("room metadata contract", () => {
  it("builds exactly the agreed keys", () => {
    const m = buildRoomMetadata({ ...meta, id: meta.room_id, extra: "x" } as never);
    expect(Object.keys(m).sort()).toEqual(
      ["guest_lang", "guest_voice", "host_lang", "host_voice", "mute_original_guest", "mute_original_host", "room_id"],
    );
    expect(parseRoomMetadata(JSON.stringify(m))).toEqual(meta);
    expect(parseRoomMetadata("not json")).toBeNull();
  });
});

describe("decideSubscription", () => {
  it("host gets tr-for-host only, never tr-for-guest", () => {
    expect(decideSubscription({ myRole: "host", participantIdentity: "agent-1", trackName: "tr-for-host", kind: "audio", metadata: meta }).subscribe).toBe(true);
    expect(decideSubscription({ myRole: "host", participantIdentity: "agent-1", trackName: "tr-for-guest", kind: "audio", metadata: meta }).subscribe).toBe(false);
  });
  it("original voice follows the speaker's mute flag, at low volume", () => {
    // guest did not mute their original -> host hears it quietly
    const h = decideSubscription({ myRole: "host", participantIdentity: "guest", trackName: "", kind: "audio", metadata: meta });
    expect(h.subscribe).toBe(true);
    expect(h.volume).toBeLessThan(0.5);
    // host muted their original -> guest does not hear it
    expect(decideSubscription({ myRole: "guest", participantIdentity: "host", trackName: "", kind: "audio", metadata: meta }).subscribe).toBe(false);
  });
  it("unknown metadata: translation only", () => {
    expect(decideSubscription({ myRole: "host", participantIdentity: "guest", trackName: "", kind: "audio", metadata: null }).subscribe).toBe(false);
  });
});

describe("applyCaption", () => {
  const base = { speaker: "guest" as const, lang_src: "en", lang_dst: "fr", seq: 1 };
  it("replaces partials with the same seq and keeps finals", () => {
    let lines = applyCaption([], { ...base, text_src: "Hel", text_dst: "Bon", final: false });
    lines = applyCaption(lines, { ...base, text_src: "Hello", text_dst: "Bonjour", final: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ text_dst: "Bonjour", final: true });
    lines = applyCaption(lines, { ...base, text_src: "Hel", text_dst: "Bon", final: false });
    expect(lines[0]).toMatchObject({ text_dst: "Bonjour", final: true });
  });
  it("keys by speaker and seq", () => {
    let lines = applyCaption([], { ...base, text_src: "a", text_dst: "b", final: true });
    lines = applyCaption(lines, { ...base, speaker: "host", lang_src: "fr", lang_dst: "en", text_src: "c", text_dst: "d", final: true });
    expect(lines).toHaveLength(2);
  });
});

describe("billing thresholds", () => {
  it("warns at 120 s and 30 s", () => {
    expect(balanceLevel(121)).toBe("normal");
    expect(balanceLevel(120)).toBe("low");
    expect(balanceLevel(31)).toBe("low");
    expect(balanceLevel(30)).toBe("critical");
    expect(balanceLevel(0)).toBe("empty");
    expect(balanceLevel(null)).toBe("normal");
  });
  it("formats clocks", () => {
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00");
  });
});
