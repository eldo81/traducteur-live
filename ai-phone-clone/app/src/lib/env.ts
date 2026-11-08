/**
 * Environment access, read lazily at request time so `next build` works
 * without real keys. Public values must be referenced literally
 * (process.env.NEXT_PUBLIC_X) for Next.js to inline them in client bundles.
 */

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Configuration manquante : ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

function need(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = process.env[n];
    if (!v) missing.push(n);
    else out[n] = v;
  }
  if (missing.length) throw new ConfigError(missing);
  return out;
}

/** Server-only secrets. Call inside handlers, never at module top level. */
export function serverEnv() {
  return {
    supabaseServiceRoleKey: () => need(["SUPABASE_SERVICE_ROLE_KEY"]).SUPABASE_SERVICE_ROLE_KEY,
    livekit: () => {
      const e = need(["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]);
      return {
        url: e.LIVEKIT_URL,
        apiKey: e.LIVEKIT_API_KEY,
        apiSecret: e.LIVEKIT_API_SECRET,
        publicUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL || e.LIVEKIT_URL,
      };
    },
    stripe: () => {
      const e = need(["STRIPE_SECRET_KEY"]);
      return { secretKey: e.STRIPE_SECRET_KEY };
    },
    stripeWebhookSecret: () => need(["STRIPE_WEBHOOK_SECRET"]).STRIPE_WEBHOOK_SECRET,
  };
}

/** Absolute app origin: NEXT_PUBLIC_APP_URL, else the request origin. */
export function appOrigin(req?: Request): string {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/+$/, "");
  if (req) return new URL(req.url).origin;
  return "http://localhost:3000";
}
