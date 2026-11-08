"use client";

import { Check, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { useBalance, useSupabaseSession } from "@/components/useSupabase";
import { formatMinutes } from "@/lib/billing";
import { fmt, t } from "@/lib/i18n";
import { formatEur, formatXof, PACKS, pricePerMinuteXof, type Pack } from "@/lib/packs";

/** S15: prepaid packs, price per minute shown before purchase, no subscription. */
export function Credits() {
  const session = useSupabaseSession();
  const balance = useBalance(session);
  const params = useSearchParams();
  const result = params.get("paiement");
  const [selected, setSelected] = useState<string>(PACKS.find((p) => p.popular)?.code ?? PACKS[0].code);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_code: selected, provider: "stripe" }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503) throw new Error(t.credits.notConfigured);
      if (!res.ok || !body.url) throw new Error(t.credits.error);
      window.location.assign(body.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.credits.error);
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="credits-title" className="flex flex-col gap-5">
      <h1 id="credits-title" className="text-xl">
        {t.credits.title}
      </h1>
      {result === "ok" && <Banner tone="success">{t.credits.success}</Banner>}
      {result === "annule" && <Banner tone="info">{t.credits.cancelled}</Banner>}

      <div className="rounded-lg bg-surface p-4">
        <p className="text-sm text-muted">{t.credits.balance}</p>
        <p className="text-timer tabular">{balance == null ? "—" : formatMinutes(balance)}</p>
      </div>

      <p className="text-muted">{t.credits.lead}</p>

      <div role="radiogroup" aria-labelledby="credits-title" className="grid gap-3 sm:grid-cols-2">
        {PACKS.map((p) => (
          <PackCard key={p.code} pack={p} selected={selected === p.code} onSelect={() => setSelected(p.code)} />
        ))}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      <Button size="lg" onClick={checkout} loading={loading} disabled={session.status !== "signed-in"}>
        {t.credits.buyCard}
      </Button>
      <Button size="lg" variant="secondary" disabled>
        <Smartphone aria-hidden size={20} />
        {t.credits.buyMobile}
      </Button>
    </section>
  );
}

function PackCard({ pack, selected, onSelect }: { pack: Pack; selected: boolean; onSelect: () => void }) {
  const perMinEur = formatEur(Math.round(pack.eur_cents / pack.minutes));
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`relative flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left ${
        selected ? "border-primary bg-primary-soft" : "border-border bg-bg"
      }`}
    >
      {pack.popular && (
        <span className="rounded-sm bg-primary px-2 py-0.5 text-xs font-semibold text-on-primary">{t.credits.popular}</span>
      )}
      <span className="text-sm font-semibold text-muted">{pack.name}</span>
      <span className="text-xl">{fmt(t.credits.minutes, { n: pack.minutes })}</span>
      <span className="text-lg">
        {formatXof(pack.xof)} <span className="text-base font-normal text-muted">· {formatEur(pack.eur_cents)}</span>
      </span>
      <span className="text-sm text-muted">
        {fmt(t.credits.perMinute, { price: `${formatXof(pricePerMinuteXof(pack))} / ${perMinEur}` })}
      </span>
      <span className="text-xs text-muted">{t.credits.validity}</span>
      {selected && <Check aria-hidden size={20} className="absolute right-3 top-3 text-primary" />}
    </button>
  );
}
