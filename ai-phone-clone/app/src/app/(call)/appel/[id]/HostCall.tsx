"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CallEnded } from "@/components/call/CallEnded";
import { CallScreen } from "@/components/call/CallScreen";
import { ShareActions } from "@/components/ShareActions";
import { Banner } from "@/components/ui/Banner";
import { buttonClass } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/lib/i18n";

interface TokenResponse {
  livekit_url: string;
  token: string;
  balance_seconds: number;
  url: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: TokenResponse }
  | { kind: "no-credit" }
  | { kind: "closed" }
  | { kind: "error"; message: string }
  | { kind: "ended"; billed: number | null };

export function HostCall({ roomId }: { roomId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/rooms/${roomId}/token`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok) setState({ kind: "ready", data: body as TokenResponse });
        else if (res.status === 402) setState({ kind: "no-credit" });
        else if (res.status === 410 || res.status === 404) setState({ kind: "closed" });
        else setState({ kind: "error", message: body.message ?? t.call.tokenError });
      })
      .catch(() => alive && setState({ kind: "error", message: t.call.tokenError }));
    return () => {
      alive = false;
    };
  }, [roomId]);

  const hangup = useCallback(async () => {
    let billed: number | null = null;
    try {
      const res = await fetch(`/api/rooms/${roomId}/end`, { method: "POST" });
      if (res.ok) billed = (await res.json()).billed_seconds ?? null;
    } catch {
      /* the LiveKit webhook closes the room anyway */
    }
    setState({ kind: "ended", billed });
  }, [roomId]);

  if (state.kind === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-4 p-4" aria-busy="true">
        <p className="sr-only">{t.call.connecting}</p>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </main>
    );
  }
  if (state.kind === "ended") return <CallEnded roomId={roomId} billedSeconds={state.billed} />;
  if (state.kind !== "ready") {
    const msg =
      state.kind === "no-credit" ? t.call.noCredit : state.kind === "closed" ? t.call.roomClosed : state.message;
    return (
      <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-4 p-4">
        <Banner tone={state.kind === "no-credit" ? "warning" : "danger"}>{msg}</Banner>
        {state.kind === "no-credit" ? (
          <Link href="/credits" className={buttonClass("primary", "lg")}>
            {t.call.topUp}
          </Link>
        ) : (
          <Link href="/appel" className={buttonClass("primary", "lg")}>
            {t.call.newCall}
          </Link>
        )}
      </main>
    );
  }

  return (
    <CallScreen
      livekitUrl={state.data.livekit_url}
      token={state.data.token}
      role="host"
      initialBalanceSeconds={state.data.balance_seconds}
      onHangup={hangup}
      waitingSlot={
        <div className="rounded-lg bg-bg p-3 text-text">
          <ShareActions url={state.data.url} />
        </div>
      }
    />
  );
}
