import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, SlidingWindowLimiter } from "@/lib/rate-limit";

describe("SlidingWindowLimiter", () => {
  it("allows `limit` requests per window then blocks", () => {
    const now = 0;
    const rl = new SlidingWindowLimiter(10, 60_000, () => now);
    for (let i = 0; i < 10; i++) expect(rl.check("1.2.3.4").ok).toBe(true);
    const blocked = rl.check("1.2.3.4");
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(60_000);
  });

  it("slides: frees a slot once the oldest hit leaves the window", () => {
    let now = 0;
    const rl = new SlidingWindowLimiter(2, 1000, () => now);
    expect(rl.check("k").ok).toBe(true); // t=0
    now = 500;
    expect(rl.check("k").ok).toBe(true); // t=500
    now = 999;
    expect(rl.check("k").ok).toBe(false);
    now = 1001;
    expect(rl.check("k").ok).toBe(true); // first hit expired
    expect(rl.check("k").ok).toBe(false);
  });

  it("keeps keys independent", () => {
    const rl = new SlidingWindowLimiter(1, 1000, () => 0);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("b").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
  });

  it("blocked requests do not extend the window", () => {
    let now = 0;
    const rl = new SlidingWindowLimiter(1, 1000, () => now);
    rl.check("k");
    now = 900;
    expect(rl.check("k").ok).toBe(false);
    now = 1001;
    expect(rl.check("k").ok).toBe(true);
  });

  it("prunes stale keys past maxKeys", () => {
    let now = 0;
    const rl = new SlidingWindowLimiter(1, 100, () => now, 3);
    rl.check("a");
    rl.check("b");
    rl.check("c");
    now = 1000;
    rl.check("d");
    expect(rl.size()).toBe(1);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the first x-forwarded-for entry", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });
  it("falls back to x-real-ip then unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
