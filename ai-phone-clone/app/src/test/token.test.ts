import { describe, expect, it } from "vitest";
import { generateLinkToken, isValidLinkToken, LINK_TOKEN_LENGTH } from "@/lib/token";

describe("link token", () => {
  it("is 24 base64url characters", () => {
    for (let i = 0; i < 200; i++) {
      const tok = generateLinkToken();
      expect(tok).toHaveLength(LINK_TOKEN_LENGTH);
      expect(tok).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(isValidLinkToken(tok)).toBe(true);
    }
  });

  it("does not repeat", () => {
    const set = new Set(Array.from({ length: 5000 }, generateLinkToken));
    expect(set.size).toBe(5000);
  });

  it("rejects malformed tokens", () => {
    expect(isValidLinkToken("short")).toBe(false);
    expect(isValidLinkToken("a".repeat(25))).toBe(false);
    expect(isValidLinkToken("abc/def+ghi=jklmnopqrstu")).toBe(false);
    expect(isValidLinkToken(null)).toBe(false);
    expect(isValidLinkToken(123)).toBe(false);
  });
});
