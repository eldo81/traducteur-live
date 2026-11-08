import type { Pack } from "@/lib/packs";

export type ProviderName = "stripe" | "paydunya";

export interface CheckoutRequest {
  pack: Pack;
  userId: string;
  email?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** provider session / transaction id, stored as purchases.provider_ref */
  providerRef: string;
  /** hosted payment page to redirect to */
  url: string;
  amountCents: number;
  currency: string;
}

/** Payment provider abstraction (Stripe for cards via an EU entity, PayDunya/CinetPay for Wave / Orange Money). */
export interface PaymentProvider {
  name: ProviderName;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(name: string) {
    super(`Moyen de paiement indisponible : ${name}`);
    this.name = "ProviderUnavailableError";
  }
}
