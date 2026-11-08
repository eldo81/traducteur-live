import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import type { CheckoutRequest, CheckoutResult, PaymentProvider } from "./provider";

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!stripe) stripe = new Stripe(serverEnv().stripe().secretKey);
  return stripe;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const { pack } = req;
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: pack.eur_cents,
            product_data: { name: `${pack.name} - ${pack.minutes} minutes de traduction` },
          },
        },
      ],
      client_reference_id: req.userId,
      customer_email: req.email ?? undefined,
      metadata: { user_id: req.userId, pack_code: pack.code, seconds: String(pack.seconds) },
      payment_intent_data: { metadata: { user_id: req.userId, pack_code: pack.code } },
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe session without url");
    return { providerRef: session.id, url: session.url, amountCents: pack.eur_cents, currency: "EUR" };
  },
};
