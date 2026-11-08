/**
 * Prepaid minute packs: no subscription, minutes valid 12 months.
 * Prices decided by the coordinator (review analysis). EUR is charged through
 * Stripe; XOF (francs CFA, no minor unit) through PayDunya (stub).
 */
export interface Pack {
  code: string;
  name: string;
  minutes: number;
  seconds: number;
  /** EUR cents */
  eur_cents: number;
  /** whole francs CFA */
  xof: number;
  popular?: boolean;
}

export const PACK_VALIDITY_MONTHS = 12;

export const PACKS: readonly Pack[] = [
  { code: "decouverte", name: "Découverte", minutes: 10, seconds: 10 * 60, eur_cents: 490, xof: 3000 },
  { code: "standard", name: "Standard", minutes: 28, seconds: 28 * 60, eur_cents: 1190, xof: 7500, popular: true },
  { code: "pro", name: "Pro", minutes: 60, seconds: 60 * 60, eur_cents: 2390, xof: 15000 },
  { code: "business", name: "Business", minutes: 150, seconds: 150 * 60, eur_cents: 5490, xof: 35000 },
];

export function findPack(code: string): Pack | undefined {
  return PACKS.find((p) => p.code === code);
}

export function pricePerMinuteEur(p: Pack): number {
  return p.eur_cents / 100 / p.minutes;
}

export function pricePerMinuteXof(p: Pack): number {
  return Math.round(p.xof / p.minutes);
}

export function formatEur(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function formatXof(francs: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(francs)} FCFA`;
}
