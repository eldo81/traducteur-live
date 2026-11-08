/**
 * Prepaid minute packs (no subscription + credits). Placeholder prices: set
 * the real ones after measuring cost per minute at milestone 1.
 */
export interface Pack {
  code: string;
  minutes: number;
  seconds: number;
  /** EUR cents, charged through Stripe */
  eur_cents: number;
  /** XOF has no minor unit: whole francs CFA, charged through PayDunya (stub) */
  xof: number;
  popular?: boolean;
}

export const PACKS: readonly Pack[] = [
  { code: "m30", minutes: 30, seconds: 30 * 60, eur_cents: 590, xof: 3900 },
  { code: "m60", minutes: 60, seconds: 60 * 60, eur_cents: 990, xof: 6500, popular: true },
  { code: "m150", minutes: 150, seconds: 150 * 60, eur_cents: 2190, xof: 14500 },
  { code: "m400", minutes: 400, seconds: 400 * 60, eur_cents: 4990, xof: 32500 },
];

export function findPack(code: string): Pack | undefined {
  return PACKS.find((p) => p.code === code);
}

export function pricePerMinuteEur(p: Pack): number {
  return p.eur_cents / 100 / p.minutes;
}
