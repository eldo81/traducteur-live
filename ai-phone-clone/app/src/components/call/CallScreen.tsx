"use client";

import { Mic, MicOff, PhoneOff, Volume2, Wallet } from "lucide-react";
import { useEffect, useRef } from "react";
import { Banner } from "@/components/ui/Banner";
import { balanceLevel, formatClock } from "@/lib/billing";
import type { Role } from "@/lib/contract";
import { t } from "@/lib/i18n";
import { CaptionStream } from "./CaptionStream";
import { useCall } from "./useCall";

export interface CallScreenProps {
  livekitUrl: string;
  token: string;
  role: Role;
  initialBalanceSeconds?: number | null;
  /** shown on the stage while waiting (host: share link reminder) */
  waitingSlot?: React.ReactNode;
  onHangup: () => void | Promise<void>;
}

/** S07: shared by host (/appel/[id]) and guest (/j/[token]). The stage stays dark in both themes. */
export function CallScreen({ livekitUrl, token, role, initialBalanceSeconds, waitingSlot, onHangup }: CallScreenProps) {
  const call = useCall({ livekitUrl, token, role, initialBalanceSeconds });
  const isHost = role === "host";
  const level = balanceLevel(call.remainingSeconds);
  const endedOnce = useRef(false);

  // Balance reached zero: the agent ends the call; mirror it here.
  useEffect(() => {
    if (level === "empty" && call.connection === "connected" && !endedOnce.current) {
      endedOnce.current = true;
      const id = setTimeout(() => void onHangup(), 3000);
      return () => clearTimeout(id);
    }
  }, [level, call.connection, onHangup]);

  // Desktop shortcut: M toggles the mic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "m" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        void call.toggleMic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call]);

  const statusText =
    call.connection === "connecting"
      ? t.call.connecting
      : call.connection === "reconnecting"
        ? t.call.reconnecting
        : call.connection === "disconnected" || call.connection === "error"
          ? call.connection === "error"
            ? t.call.tokenError
            : t.call.disconnected
          : call.otherPresent
            ? isHost
              ? t.call.guestHere
              : t.call.hostHere
            : isHost
              ? t.call.waitingGuest
              : t.call.waitingHost;

  const topUpLink = (
    <a
      href="/credits"
      target="_blank"
      rel="noopener"
      title={t.call.topUpHelp}
      className="inline-flex h-tap-sm items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary"
    >
      <Wallet aria-hidden size={18} />
      {t.call.topUp}
    </a>
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">

      {/* CallStage: always dark */}
      <section aria-label={t.call.duration} className="bg-call-stage px-4 pb-4 pt-4 text-on-call-stage">
        <div className="mx-auto flex max-w-content-wide items-center justify-between gap-3">
          <p aria-live="polite" className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`size-2.5 rounded-pill ${call.otherPresent ? "bg-success" : "bg-warning animate-soft-pulse"}`}
            />
            {statusText}
          </p>
          <div className="flex items-center gap-2 text-timer tabular">
            <span aria-label={t.call.duration}>{formatClock(call.elapsedSeconds)}</span>
            {isHost && call.remainingSeconds != null && (
              <span
                aria-label={t.call.balance}
                className={`rounded-pill bg-call-control px-3 py-1 text-sm ${level === "normal" ? "" : "text-warning"}`}
              >
                {formatClock(call.remainingSeconds)}
              </span>
            )}
          </div>
        </div>
        <p className="mx-auto mt-1 max-w-content-wide text-xs text-on-call-stage-muted">
          {call.agentPresent ? t.call.agentReady : t.call.agentWaiting}
        </p>
        {!call.otherPresent && call.connection === "connected" && waitingSlot && (
          <div className="mx-auto mt-3 max-w-content-wide">{waitingSlot}</div>
        )}
      </section>

      <div className="mx-auto flex w-full max-w-content-wide flex-col gap-2 px-4 pt-3 empty:hidden">
        {!call.canPlayAudio && (
          <Banner
            tone="info"
            action={
              <button
                type="button"
                onClick={() => void call.startAudio()}
                className="inline-flex h-tap-sm items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary"
              >
                <Volume2 aria-hidden size={18} />
                {t.call.enableAudio}
              </button>
            }
          >
            {t.call.enableAudioHelp}
          </Banner>
        )}
        {call.micError && <Banner tone="danger">{t.call.micDenied}</Banner>}
        {level === "low" && (
          <Banner tone="warning" live="polite" action={isHost ? topUpLink : undefined}>
            {isHost ? t.call.lowBanner : t.call.guestLowBanner}
          </Banner>
        )}
        {level === "critical" && (
          <Banner tone="warning" live="assertive" action={isHost ? topUpLink : undefined}>
            {isHost ? t.call.criticalBanner : t.call.guestLowBanner}
          </Banner>
        )}
        {level === "empty" && <Banner tone="danger">{t.call.emptyBanner}</Banner>}
      </div>

      <CaptionStream lines={call.captions} myRole={role} />

      {/* CallControlBar */}
      <nav aria-label={t.call.hangup} className="bg-call-stage pb-safe">
        <div className="mx-auto flex max-w-content items-end justify-center gap-6 px-4 py-4">
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => void call.toggleMic()}
              aria-pressed={!call.micEnabled}
              aria-label={call.micEnabled ? t.call.mute : t.call.unmute}
              className={`flex size-call-btn items-center justify-center rounded-pill ${
                call.micEnabled ? "bg-call-control text-on-call-stage" : "bg-on-call-stage text-call-stage"
              }`}
            >
              {call.micEnabled ? <Mic aria-hidden size={28} /> : <MicOff aria-hidden size={28} />}
            </button>
            <span className="text-xs text-on-call-stage-muted">{call.micEnabled ? t.call.mute : t.call.muted}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                await call.leave();
                await onHangup();
              }}
              aria-label={t.call.hangup}
              className="flex size-hangup-btn items-center justify-center rounded-pill bg-hangup text-on-hangup"
            >
              <PhoneOff aria-hidden size={28} />
            </button>
            <span className="text-xs text-on-call-stage-muted">{t.call.hangup}</span>
          </div>
        </div>
      </nav>
    </div>
  );
}
