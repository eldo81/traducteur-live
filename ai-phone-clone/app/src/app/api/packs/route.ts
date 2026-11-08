import { NextResponse } from "next/server";
import { PACK_VALIDITY_MONTHS, PACKS } from "@/lib/packs";

/** GET /api/packs : public price list (EUR via Stripe, XOF via PayDunya). */
export function GET() {
  return NextResponse.json(
    {
      packs: PACKS.map((p) => ({
        code: p.code,
        name: p.name,
        minutes: p.minutes,
        seconds: p.seconds,
        prices: { EUR: p.eur_cents, XOF: p.xof },
        popular: Boolean(p.popular),
        per_minute: { EUR: Math.round(p.eur_cents / p.minutes), XOF: Math.round(p.xof / p.minutes) },
        validity_months: PACK_VALIDITY_MONTHS,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
