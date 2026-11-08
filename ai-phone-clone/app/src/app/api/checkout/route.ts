import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api";
import { appOrigin } from "@/lib/env";
import { findPack } from "@/lib/packs";
import { paydunyaProvider } from "@/lib/payments/paydunya";
import { ProviderUnavailableError, type PaymentProvider } from "@/lib/payments/provider";
import { stripeProvider } from "@/lib/payments/stripe";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase, getUser } from "@/lib/supabase/server";

const bodySchema = z
  .object({
    pack_code: z.string().min(1).max(32),
    provider: z.enum(["stripe", "paydunya"]).default("stripe"),
  })
  .strict();

const providers: Record<"stripe" | "paydunya", PaymentProvider> = {
  stripe: stripeProvider,
  paydunya: paydunyaProvider,
};

/** POST /api/checkout : creates a hosted checkout session and a pending purchase. */
export async function POST(req: Request) {
  try {
    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError("bad_request");
    const pack = findPack(parsed.data.pack_code);
    if (!pack) return apiError("bad_request", "unknown pack");

    const origin = appOrigin(req);
    const provider = providers[parsed.data.provider];
    let result;
    try {
      result = await provider.createCheckout({
        pack,
        userId: user.id,
        email: user.email,
        successUrl: `${origin}/credits?paiement=ok`,
        cancelUrl: `${origin}/credits?paiement=annule`,
      });
    } catch (err) {
      if (err instanceof ProviderUnavailableError) return apiError("not_configured", err.message);
      throw err;
    }

    // purchases is server-written only (no RLS insert policy).
    const { error } = await getAdminSupabase().from("purchases").insert({
      user_id: user.id,
      provider: provider.name,
      provider_ref: result.providerRef,
      pack_code: pack.code,
      seconds: pack.seconds,
      amount_cents: result.amountCents,
      currency: result.currency,
      status: "pending",
    });
    if (error) throw error;

    return apiOk({ url: result.url });
  } catch (err) {
    return handleApiError(err);
  }
}
