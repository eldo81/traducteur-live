/**
 * Idempotent crediting of a paid purchase. Payment providers retry webhooks,
 * so the same event can arrive several times (or in parallel). Safety comes
 * from the database constraints in schema.sql:
 *   purchases      unique (provider, provider_ref)
 *   credit_ledger  unique (purchase_id)
 * This module holds the pure decision logic; the store is injected so it can
 * be tested without a database.
 */

/** Postgres unique_violation. */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

export interface PaidPurchaseInput {
  provider: "stripe" | "paydunya" | "cinetpay";
  provider_ref: string;
  user_id: string;
  pack_code: string;
  seconds: number;
  amount_cents: number;
  currency: string;
}

export interface PurchaseRow {
  id: string;
  user_id: string;
  seconds: number;
  status: "pending" | "paid" | "failed" | "refunded";
}

export interface PurchaseStore {
  findPurchase(provider: string, providerRef: string): Promise<PurchaseRow | null>;
  /** insert as paid; must surface Postgres error code 23505 on conflict */
  insertPaidPurchase(input: PaidPurchaseInput): Promise<PurchaseRow>;
  markPaid(id: string): Promise<void>;
  /** insert ledger row; must surface 23505 when purchase_id already credited */
  insertPurchaseCredit(row: { user_id: string; purchase_id: string; delta_seconds: number }): Promise<void>;
}

export type CreditOutcome = "credited" | "already_credited" | "refunded_skip";

export async function creditPurchaseOnce(
  store: PurchaseStore,
  input: PaidPurchaseInput,
): Promise<CreditOutcome> {
  let purchase = await store.findPurchase(input.provider, input.provider_ref);

  if (!purchase) {
    try {
      purchase = await store.insertPaidPurchase(input);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A parallel delivery inserted it first.
      purchase = await store.findPurchase(input.provider, input.provider_ref);
      if (!purchase) throw err;
    }
  }

  if (purchase.status === "refunded") return "refunded_skip";
  if (purchase.status !== "paid") await store.markPaid(purchase.id);

  try {
    await store.insertPurchaseCredit({
      user_id: purchase.user_id,
      purchase_id: purchase.id,
      // Trust the amount recorded when the checkout was created, not the event.
      delta_seconds: purchase.seconds,
    });
    return "credited";
  } catch (err) {
    if (isUniqueViolation(err)) return "already_credited";
    throw err;
  }
}
