import "server-only";
import { ProviderUnavailableError, type CheckoutRequest, type CheckoutResult, type PaymentProvider } from "./provider";

/**
 * PayDunya (Wave, Orange Money, cards in XOF) - interface stub.
 *
 * TODO(paydunya):
 *  1. POST https://app.paydunya.com/api/v1/checkout-invoice/create with headers
 *     PAYDUNYA-MASTER-KEY / PAYDUNYA-PRIVATE-KEY / PAYDUNYA-TOKEN (env vars in .env.example),
 *     amount = pack.xof, custom_data = { user_id, pack_code, seconds },
 *     actions.callback_url = {APP_URL}/api/webhooks/paydunya.
 *  2. Store purchases(provider='paydunya', provider_ref=invoice token, currency='XOF', status='pending').
 *  3. Webhook: re-confirm the invoice status by an outgoing API call (never trust the
 *     callback body alone), then creditPurchaseOnce() from lib/webhook-idempotency.
 */
export const paydunyaProvider: PaymentProvider = {
  name: "paydunya",
  async createCheckout(_req: CheckoutRequest): Promise<CheckoutResult> {
    void _req;
    throw new ProviderUnavailableError("paydunya");
  },
};
