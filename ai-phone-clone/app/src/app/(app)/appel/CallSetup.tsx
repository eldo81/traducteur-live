"use client";

import { ArrowLeftRight, ChevronDown, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ShareActions } from "@/components/ShareActions";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClass } from "@/components/ui/Button";
import { LanguageSelect } from "@/components/ui/LanguageSelect";
import { Switch } from "@/components/ui/Switch";
import { useBalance, useSupabaseSession } from "@/components/useSupabase";
import { formatMinutes, LOW_BALANCE_SECONDS } from "@/lib/billing";
import { fmt, t } from "@/lib/i18n";
import { languageLabel, VOICES } from "@/lib/languages";

const PREFS_KEY = "li:call-prefs";
interface Prefs {
  host_lang: string;
  guest_lang: string;
  host_voice: string;
  guest_voice: string;
  mute_original_host: boolean;
  mute_original_guest: boolean;
}
const DEFAULT_PREFS: Prefs = {
  host_lang: "fr",
  guest_lang: "en",
  host_voice: "auto",
  guest_voice: "auto",
  mute_original_host: true,
  mute_original_guest: true,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function CallSetup() {
  const session = useSupabaseSession();
  const balance = useBalance(session);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [showOptions, setShowOptions] = useState(false);
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ room_id: string; url: string } | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    // After hydration (the page is prerendered with defaults).
    const id = requestAnimationFrame(() => setPrefs(loadPrefs()));
    return () => cancelAnimationFrame(id);
  }, []);

  const update = (p: Partial<Prefs>) => setPrefs((prev) => ({ ...prev, ...p }));
  const sameLang = prefs.host_lang === prefs.guest_lang;

  function swap() {
    setPrefs((p) => ({ ...p, host_lang: p.guest_lang, guest_lang: p.host_lang }));
    setAnnounce(fmt(t.setup.swapped, { me: languageLabel(prefs.guest_lang), other: languageLabel(prefs.host_lang) }));
  }

  async function create() {
    setStatus("creating");
    setError(null);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "voice", ...prefs }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? t.common.error);
      setCreated({ room_id: body.room_id, url: body.url });
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error);
      setStatus("error");
    }
  }

  if (created) {
    return (
      <section aria-labelledby="share-title" className="flex flex-col gap-5">
        <h1 id="share-title" className="text-xl">
          {t.share.title}
        </h1>
        <p className="text-muted">{t.share.lead}</p>
        <div className="flex items-center gap-2 rounded-lg bg-surface p-4 shadow-card">
          <LinkIcon aria-hidden size={20} className="shrink-0 text-primary" />
          <code className="min-w-0 flex-1 truncate font-mono text-sm" title={created.url}>
            {created.url}
          </code>
        </div>
        <p className="text-sm text-muted">{t.share.expires}</p>
        <ShareActions url={created.url} />
        <Link href={`/appel/${created.room_id}`} className={buttonClass("ghost", "lg")}>
          {t.share.join}
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-5">
      <h1 id="setup-title" className="text-xl">
        {t.setup.title}
      </h1>

      {balance != null && balance <= LOW_BALANCE_SECONDS && (
        <Banner
          tone="warning"
          action={
            <Link href="/credits" className={buttonClass("secondary", "sm")}>
              {t.call.topUp}
            </Link>
          }
        >
          {t.setup.lowBalance} ({formatMinutes(balance)})
        </Banner>
      )}

      <div className="flex items-stretch gap-2">
        <LanguageSelect label={t.setup.me} value={prefs.host_lang} onChange={(v) => update({ host_lang: v })} />
        <button
          type="button"
          onClick={swap}
          aria-label={t.setup.swap}
          className="flex size-tap shrink-0 items-center justify-center self-center rounded-pill bg-surface text-primary hover:bg-surface-2"
        >
          <ArrowLeftRight aria-hidden size={20} />
        </button>
        <LanguageSelect label={t.setup.other} value={prefs.guest_lang} onChange={(v) => update({ guest_lang: v })} />
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {sameLang && <p className="text-sm text-danger">{t.setup.sameLang}</p>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">{t.setup.mode}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1" role="radiogroup">
          <button type="button" role="radio" aria-checked="true" className="h-10 rounded-md bg-bg text-sm font-semibold shadow-card">
            {t.setup.voice}
          </button>
          <button type="button" role="radio" aria-checked="false" disabled className="h-10 rounded-md text-sm font-semibold text-muted">
            {t.setup.video}
          </button>
        </div>
      </fieldset>

      <div className="rounded-lg border border-border">
        <button
          type="button"
          aria-expanded={showOptions}
          aria-controls="call-options"
          onClick={() => setShowOptions((s) => !s)}
          className="flex h-tap w-full items-center justify-between px-4 text-base font-semibold"
        >
          {t.setup.options}
          <ChevronDown aria-hidden size={20} className={showOptions ? "rotate-180" : ""} />
        </button>
        {showOptions && (
          <div id="call-options" className="flex flex-col gap-2 border-t border-border px-4 pb-4 pt-2">
            <Switch
              label={t.setup.muteMine}
              help={t.setup.muteMineHelp}
              checked={prefs.mute_original_host}
              onChange={(v) => update({ mute_original_host: v })}
            />
            <Switch
              label={t.setup.muteTheirs}
              help={t.setup.muteTheirsHelp}
              checked={prefs.mute_original_guest}
              onChange={(v) => update({ mute_original_guest: v })}
            />
            <VoiceSelect label={t.setup.myVoice} value={prefs.host_voice} onChange={(v) => update({ host_voice: v })} />
            <VoiceSelect label={t.setup.otherVoice} value={prefs.guest_voice} onChange={(v) => update({ guest_voice: v })} />
          </div>
        )}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      <Button size="lg" onClick={create} loading={status === "creating"} disabled={sameLang || session.status !== "signed-in"}>
        {status === "creating" ? t.setup.creating : t.setup.create}
      </Button>
      {session.status === "unconfigured" && <Banner tone="warning">{t.landing.notConfigured}</Banner>}
    </section>
  );
}

/**
 * Speaker-centric, like mute_original_*: host_voice = the voice that speaks the
 * host's words in translation (heard by the guest on "tr-for-guest");
 * guest_voice = the voice for the guest's words (heard by the host on "tr-for-host").
 */
function VoiceSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 pt-2 text-sm font-semibold">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-tap rounded-md border border-border-input bg-bg px-3 text-base font-normal"
      >
        {VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
