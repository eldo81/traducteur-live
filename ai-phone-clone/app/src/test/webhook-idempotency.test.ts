import { describe, expect, it } from "vitest";
import {
  creditPurchaseOnce,
  isUniqueViolation,
  type PaidPurchaseInput,
  type PurchaseRow,
  type PurchaseStore,
} from "@/lib/webhook-idempotency";

/** In-memory store enforcing the same unique constraints as schema.sql. */
function memoryStore(seed: PurchaseRow[] = [], refs: Record<string, string> = {}) {
  const purchases = new Map<string, PurchaseRow & { ref: string }>();
  for (const p of seed) purchases.set(p.id, { ...p, ref: refs[p.id] });
  const ledger: { user_id: string; purchase_id: string; delta_seconds: number }[] = [];
  let n = 0;
  const unique = () => Object.assign(new Error("duplicate key"), { code: "23505" });
  const store: PurchaseStore = {
    async findPurchase(provider, ref) {
      for (const p of purchases.values()) if (p.ref === `${provider}:${ref}`) return { ...p };
      return null;
    },
    async insertPaidPurchase(input: PaidPurchaseInput) {
      const key = `${input.provider}:${input.provider_ref}`;
      for (const p of purchases.values()) if (p.ref === key) throw unique();
      const row = { id: `p${++n}`, user_id: input.user_id, seconds: input.seconds, status: "paid" as const, ref: key };
      purchases.set(row.id, row);
      return { ...row };
    },
    async markPaid(id) {
      const p = purchases.get(id);
      if (p && p.status === "pending") p.status = "paid";
    },
    async insertPurchaseCredit(row) {
      if (ledger.some((l) => l.purchase_id === row.purchase_id)) throw unique();
      ledger.push(row);
    },
  };
  return { store, ledger, purchases };
}

const input: PaidPurchaseInput = {
  provider: "stripe",
  provider_ref: "cs_test_1",
  user_id: "u1",
  pack_code: "standard",
  seconds: 1680,
  amount_cents: 1190,
  currency: "EUR",
};

describe("creditPurchaseOnce", () => {
  it("credits a pending purchase once and marks it paid", async () => {
    const { store, ledger, purchases } = memoryStore(
      [{ id: "p0", user_id: "u1", seconds: 1680, status: "pending" }],
      { p0: "stripe:cs_test_1" },
    );
    expect(await creditPurchaseOnce(store, input)).toBe("credited");
    expect(ledger).toEqual([{ user_id: "u1", purchase_id: "p0", delta_seconds: 1680 }]);
    expect(purchases.get("p0")?.status).toBe("paid");
  });

  it("is idempotent on webhook retries", async () => {
    const { store, ledger } = memoryStore([{ id: "p0", user_id: "u1", seconds: 1680, status: "pending" }], { p0: "stripe:cs_test_1" });
    expect(await creditPurchaseOnce(store, input)).toBe("credited");
    expect(await creditPurchaseOnce(store, input)).toBe("already_credited");
    expect(await creditPurchaseOnce(store, input)).toBe("already_credited");
    expect(ledger).toHaveLength(1);
  });

  it("survives parallel deliveries", async () => {
    const { store, ledger } = memoryStore();
    const results = await Promise.all([creditPurchaseOnce(store, input), creditPurchaseOnce(store, input), creditPurchaseOnce(store, input)]);
    expect(results.filter((r) => r === "credited")).toHaveLength(1);
    expect(ledger).toHaveLength(1);
  });

  it("creates the purchase when the pending row is missing", async () => {
    const { store, ledger } = memoryStore();
    expect(await creditPurchaseOnce(store, input)).toBe("credited");
    expect(ledger[0].delta_seconds).toBe(1680);
  });

  it("uses the seconds recorded at checkout, not the event", async () => {
    const { store, ledger } = memoryStore([{ id: "p0", user_id: "u1", seconds: 600, status: "pending" }], { p0: "stripe:cs_test_1" });
    await creditPurchaseOnce(store, { ...input, seconds: 999_999 });
    expect(ledger[0].delta_seconds).toBe(600);
  });

  it("never credits a refunded purchase", async () => {
    const { store, ledger } = memoryStore([{ id: "p0", user_id: "u1", seconds: 600, status: "refunded" }], { p0: "stripe:cs_test_1" });
    expect(await creditPurchaseOnce(store, input)).toBe("refunded_skip");
    expect(ledger).toHaveLength(0);
  });

  it("rethrows non-unique errors", async () => {
    const { store } = memoryStore();
    store.insertPurchaseCredit = async () => {
      throw Object.assign(new Error("boom"), { code: "08006" });
    };
    await expect(creditPurchaseOnce(store, input)).rejects.toThrow("boom");
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505 only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
