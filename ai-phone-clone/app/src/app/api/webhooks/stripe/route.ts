import type Stripe from "stripe";
import { apiError, apiOk, handleApiError } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { findPack } from "@/lib/packs";
import { getStripe } from "@/lib/payments/stripe";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { creditPurchaseOnce, type PurchaseStore } from "@/lib/webhook-idempotency";

function adminStore(): PurchaseStore {
  const db = getAdminSupabase();
  return {
    async findPurchase(provider, providerRef) {
      const { data, error } = await db
        .from("purchases")
        .select("id, user_id, seconds, status")
        .eq("provider", provider as "stripe")
        .eq("provider_ref", providerRef)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insertPaidPurchase(input) {
      const { data, error } = await db
        .from("purchases")
        .insert({ ...input, status: "paid" })
        .select("id, user_id, seconds, status")
        .single();
      if (error) throw error;
      return data;
    },
    async markPaid(id) {
      const { error } = await db.from("purchases").update({ status: "paid" }).eq("id", id).eq("status", "pending");
      if (error) throw error;
    },
    async insertPurchaseCredit(row) {
      const { error } = await db.from("credit_ledger").insert({ ...row, reason: "purchase" });
      if (error) throw error;
    },
  };
}

async function onPaid(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return "not_paid";
  const md = session.metadata ?? {};
  const userId = md.user_id || session.client_reference_id;
  const pack = md.pack_code ? findPack(md.pack_code) : undefined;
  if (!userId || !pack) {
    console.error("[stripe] session without user/pack metadata", session.id);
    return "ignored";
  }
  return creditPurchaseOnce(adminStore(), {
    provider: "stripe",
    provider_ref: session.id,
    user_id: userId,
    pack_code: pack.code,
    seconds: pack.seconds,
    amount_cents: session.amount_total ?? pack.eur_cents,
    currency: (session.currency ?? "eur").toUpperCase(),
  });
}

async function onFailed(session: Stripe.Checkout.Session) {
  const { error } = await getAdminSupabase()
    .from("purchases")
    .update({ status: "failed" })
    .eq("provider", "stripe")
    .eq("provider_ref", session.id)
    .eq("status", "pending");
  if (error) throw error;
  return "failed";
}

/** POST /api/webhooks/stripe : signature verified, idempotent. */
export async function POST(req: Request) {
  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return apiError("bad_request", "missing signature");
    const secret = serverEnv().stripeWebhookSecret();
    const raw = await req.text();

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(raw, signature, secret);
    } catch {
      return apiError("bad_request", "invalid signature");
    }

    let outcome: string = "ignored";
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        outcome = await onPaid(event.data.object);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        outcome = await onFailed(event.data.object);
        break;
      default:
        break;
    }
    return apiOk({ received: true, outcome });
  } catch (err) {
    // 5xx makes Stripe retry, which is safe thanks to the unique constraints.
    return handleApiError(err);
  }
}
