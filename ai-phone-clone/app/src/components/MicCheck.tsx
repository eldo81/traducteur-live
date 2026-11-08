"use client";

import { Mic, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
function newAudioContext(): AudioContext | null {
  const w = window as WindowWithWebkit;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Quick pre-join check: mic level meter + short speaker beep. Releases the mic when done. */
export function MicCheck({ onDenied }: { onDenied?: () => void }) {
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [heard, setHeard] = useState(false);
  const cleanup = useRef<() => void>(() => undefined);

  useEffect(() => () => cleanup.current(), []);

  async function start() {
    cleanup.current();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = newAudioContext();
      if (!ctx) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        const l = Math.min(1, peak / 64);
        setLevel(l);
        if (l > 0.15) setHeard(true);
        raf = requestAnimationFrame(tick);
      };
      tick();
      setRunning(true);
      const stopAt = setTimeout(() => cleanup.current(), 15000);
      cleanup.current = () => {
        cancelAnimationFrame(raf);
        clearTimeout(stopAt);
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx.close();
        setRunning(false);
        setLevel(0);
      };
    } catch {
      onDenied?.();
    }
  }

  function beep() {
    const ctx = newAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
    osc.onended = () => void ctx.close();
  }

  return (
    <section aria-labelledby="miccheck-title" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="miccheck-title" className="text-base font-semibold">
        {t.guest.micCheckTitle}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={start} disabled={running}>
          <Mic aria-hidden size={18} />
          {t.guest.micCheckStart}
        </Button>
        <Button variant="secondary" size="sm" onClick={beep} aria-describedby="beep-help">
          <Volume2 aria-hidden size={18} />
          {t.guest.beep}
        </Button>
      </div>
      <p id="beep-help" className="text-xs text-muted">
        {t.guest.beepHelp}
      </p>
      {running && (
        <>
          <div
            role="meter"
            aria-label={t.guest.micCheckLevel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            className="h-3 overflow-hidden rounded-pill bg-surface-2"
          >
            <div className="h-full rounded-pill bg-primary transition-[width] duration-[var(--duration-fast)]" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p role="status" className={`text-sm ${heard ? "text-success" : "text-muted"}`}>
            {heard ? t.guest.micCheckOk : t.guest.micCheckSpeak}
          </p>
        </>
      )}
    </section>
  );
}
