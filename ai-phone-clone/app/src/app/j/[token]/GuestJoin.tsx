"use client";

import { ExternalLink, Languages, MicOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { CallEnded } from "@/components/call/CallEnded";
import { CallScreen } from "@/components/call/CallScreen";
import { MicCheck } from "@/components/MicCheck";
import { Banner } from "@/components/ui/Banner";
import { useClientValue } from "@/components/useClientValue";
import { Button, buttonClass } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { fmt, t } from "@/lib/i18n";
import { chromeIntentUrl, detectInAppBrowser, type BrowserInfo } from "@/lib/in-app-browser";
import { languageLabel } from "@/lib/languages";

export type GuestRoomInfo =
  | { state: "open"; host_lang: string; guest_lang: string }
  | { state: "expired" }
  | { state: "invalid" }
  | { state: "unknown" };

interface JoinResponse {
  livekit_url: string;
  token: string;
}

type Step =
  | { kind: "prejoin" }
  | { kind: "mic-denied" }
  | { kind: "joining" }
  | { kind: "in-call"; data: JoinResponse }
  | { kind: "error"; message: string; fatal?: boolean }
  | { kind: "ended" };

const STATUS_MESSAGES: Record<number, { message: string; fatal: boolean }> = {
  404: { message: t.guest.invalid, fatal: true },
  410: { message: t.guest.expired, fatal: true },
  409: { message: t.guest.full, fatal: true },
  402: { message: t.guest.hostNoCredit, fatal: false },
  429: { message: t.guest.rateLimited, fatal: false },
};

export function GuestJoin({ token, room }: { token: string; room: GuestRoomInfo }) {
  const [step, setStep] = useState<Step>({ kind: "prejoin" });
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [inAppDismissed, setInAppDismissed] = useState(false);
  const ua = useClientValue<string | null>(() => navigator.userAgent, null);
  const pageUrl = useClientValue(() => window.location.href, "");
  const browser: BrowserInfo | null = useMemo(() => (ua == null ? null : detectInAppBrowser(ua)), [ua]);
  const checking = browser == null;

  const join = useCallback(async () => {
    setStep({ kind: "joining" });
    if (!navigator.mediaDevices?.getUserMedia) {
      setStep({ kind: "error", message: t.guest.noMicSupport });
      return;
    }
    // Ask for the mic first (inside the click), then release it: LiveKit reopens it.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((tr) => tr.stop());
    } catch {
      setStep({ kind: "mic-denied" });
      return;
    }
    try {
      const res = await fetch(`/api/join/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, ...(name.trim() ? { display_name: name.trim() } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setStep({ kind: "in-call", data: body as JoinResponse });
        return;
      }
      const known = STATUS_MESSAGES[res.status];
      setStep({ kind: "error", message: known?.message ?? t.guest.unknownError, fatal: known?.fatal });
    } catch {
      setStep({ kind: "error", message: t.guest.unknownError });
    }
  }, [token, name]);

  if (room.state === "invalid") return <Shell><Banner tone="danger">{t.guest.invalid}</Banner></Shell>;
  if (room.state === "expired") return <Shell><Banner tone="warning">{t.guest.expired}</Banner></Shell>;

  if (step.kind === "in-call") {
    return <CallScreen livekitUrl={step.data.livekit_url} token={step.data.token} role="guest" onHangup={() => setStep({ kind: "ended" })} />;
  }
  if (step.kind === "ended") return <CallEnded />;

  if (browser?.inApp && !inAppDismissed) {
    const appName = browser.app ? t.guest.appNames[browser.app] : t.guest.appNames.webview;
    const intent = chromeIntentUrl(pageUrl, browser.os);
    const steps = browser.os === "android" ? t.guest.inAppStepsAndroid : t.guest.inAppStepsIos;
    return (
      <Shell>
        <section aria-labelledby="inapp-title" className="flex flex-col gap-4 rounded-lg bg-warning-soft p-4 text-on-warning-soft">
          <h2 id="inapp-title" className="text-lg">
            {t.guest.inAppTitle}
          </h2>
          <p>{fmt(t.guest.inAppLead, { app: appName })}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
        {intent && (
          <a href={intent} className={buttonClass("primary", "lg")}>
            <ExternalLink aria-hidden size={20} />
            {t.guest.openChrome}
          </a>
        )}
        <CopyButton text={pageUrl} label={t.guest.copyLink} size="lg" />
        <Button variant="ghost" size="lg" onClick={() => setInAppDismissed(true)}>
          {t.guest.continueAnyway}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      {room.state === "open" && (
        <p className="flex flex-wrap items-center gap-2 text-base">
          <Languages aria-hidden size={20} className="text-primary" />
          {fmt(t.guest.langs, { guest: languageLabel(room.guest_lang), host: languageLabel(room.host_lang) })}
        </p>
      )}

      <section aria-labelledby="consent-title" className="flex flex-col gap-3 rounded-lg bg-surface p-4">
        <h2 id="consent-title" className="text-base font-semibold">
          {t.guest.consentTitle}
        </h2>
        <p className="text-sm">{t.guest.consentText}</p>
        <label className="flex min-h-tap items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="size-5 accent-primary"
          />
          {t.guest.consentCheck}
        </label>
      </section>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.guest.nameLabel}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="given-name"
          className="h-tap rounded-md border border-border-input bg-bg px-3 text-base font-normal focus:border-primary"
        />
      </label>

      <MicCheck onDenied={() => setStep({ kind: "mic-denied" })} />

      {step.kind === "mic-denied" && (
        <Banner tone="warning">
          <span className="flex items-start gap-2">
            <MicOff aria-hidden size={18} className="mt-0.5 shrink-0" />
            {t.guest.micDenied}
          </span>
        </Banner>
      )}
      {step.kind === "error" && <Banner tone={step.fatal ? "danger" : "warning"}>{step.message}</Banner>}

      <p className="text-sm text-muted">{t.guest.micAsk}</p>
      <Button
        size="lg"
        onClick={join}
        loading={step.kind === "joining"}
        disabled={!consent || checking || (step.kind === "error" && step.fatal)}
      >
        {step.kind === "joining" ? t.guest.joining : step.kind === "mic-denied" ? t.guest.retry : t.guest.join}
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-content flex-1 flex-col gap-5 px-4 py-8">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Languages aria-hidden size={20} />
        {t.app.name}
      </p>
      <h1 className="text-xl">{t.guest.title}</h1>
      {children}
    </main>
  );
}
