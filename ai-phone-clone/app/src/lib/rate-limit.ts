/**
 * Sliding-window rate limiter kept in memory.
 *
 * TODO(prod): memory is per server instance (Vercel runs several), so this is
 * a best-effort guard only. Swap for Upstash Ratelimit (@upstash/ratelimit +
 * Redis) behind the same `check()` signature before launch.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** milliseconds until a new request would be accepted (0 when ok) */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const since = t - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((ts) => ts > since);

    if (list.length >= this.limit) {
      this.hits.set(key, list);
      const oldest = list[0];
      return { ok: false, remaining: 0, retryAfterMs: Math.max(0, oldest + this.windowMs - t) };
    }

    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(since);
    return { ok: true, remaining: this.limit - list.length, retryAfterMs: 0 };
  }

  private prune(since: number) {
    for (const [k, v] of this.hits) {
      if (v.length === 0 || v[v.length - 1] <= since) this.hits.delete(k);
    }
  }

  /** test helper */
  size(): number {
    return this.hits.size;
  }
}

/** First address of x-forwarded-for, else x-real-ip, else "unknown". */
export function clientIpFromHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
