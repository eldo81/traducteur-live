"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClass } from "@/components/ui/Button";
import { useSupabaseSession } from "@/components/useSupabase";
import { t } from "@/lib/i18n";

function safeNext(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/appel";
}

export function LoginPanel() {
  const session = useSupabaseSession();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(params.get("erreur") ? "error" : "idle");

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function onMagicLink(e: FormEvent) {
    e.preventDefault();
    if (session.status === "unconfigured" || !session.supabase) return;
    setState("sending");
    const { error } = await session.supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    setState(error ? "error" : "sent");
  }

  async function onGoogle() {
    if (!session.supabase) return;
    await session.supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  }

  if (session.status === "unconfigured") return <Banner tone="warning">{t.landing.notConfigured}</Banner>;

  if (session.status === "signed-in") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted">{t.landing.alreadyIn}</p>
        <Link href={next} className={buttonClass("primary", "lg")}>
          {t.landing.goToApp}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state === "error" && <Banner tone="danger">{t.landing.authError}</Banner>}
      {state === "sent" ? (
        <Banner tone="success">{t.landing.linkSent}</Banner>
      ) : (
        <form onSubmit={onMagicLink} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-semibold">
            {t.landing.emailLabel}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="email-help"
            className="h-tap rounded-md border border-border-input bg-bg px-3 text-base focus:border-primary"
          />
          <p id="email-help" className="text-sm text-muted">
            {t.landing.emailHelp}
          </p>
          <Button type="submit" size="lg" loading={state === "sending"} disabled={session.status === "loading"}>
            {t.landing.sendLink}
          </Button>
        </form>
      )}
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-border" />
        {t.landing.or}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="secondary" size="lg" onClick={onGoogle} disabled={session.status === "loading"}>
        {t.landing.google}
      </Button>
    </div>
  );
}
