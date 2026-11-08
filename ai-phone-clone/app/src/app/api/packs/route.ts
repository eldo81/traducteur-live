import { NextResponse } from "next/server";
import { PACKS } from "@/lib/packs";

/** GET /api/packs : public price list (EUR via Stripe, XOF via PayDunya). */
export function GET() {
  return NextResponse.json(
    {
      packs: PACKS.map((p) => ({
        code: p.code,
        minutes: p.minutes,
        seconds: p.seconds,
        prices: { EUR: p.eur_cents, XOF: p.xof },
        popular: Boolean(p.popular),
      })),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
