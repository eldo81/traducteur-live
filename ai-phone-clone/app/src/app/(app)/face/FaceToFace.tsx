"use client";

import { ArrowLeftRight, Mic, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCall } from "@/components/call/useCall";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClass } from "@/components/ui/Button";
import { LanguageSelect } from "@/components/ui/LanguageSelect";
import type { CaptionLine } from "@/lib/captions";
import type { Role } from "@/lib/contract";
import { t } from "@/lib/i18n";

interface Session {
  livekit_url: string;
  token: string;
  room_id: string;
  balance_seconds: number;
}

/**
 * S10 face-to-face. Same room mechanism as a call: one participant ("host"),
 * agent dispatched with job metadata face_to_face: true. Turn hints are sent
 * on topic "face_turn". TODO: listen mode, push-to-talk per half.
 */
export function FaceToFace() {
  const [myLang, setMyLang] = useState("fr");
  const [otherLang, setOtherLang] = useState("en");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/face/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_lang: myLang, guest_lang: otherLang }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) throw new Error(t.call.noCredit);
      if (!res.ok) throw new Error(body.message ?? t.call.tokenError);
      setSession(body as Session);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error);
    } finally {
      setStarting(false);
    }
  }

  if (session) {
    return (
      <FaceSession
        session={session}
        onStop={async () => {
          await fetch(`/api/rooms/${session.room_id}/end`, { method: "POST" }).catch(() => undefined);
          setSession(null);
        }}
      />
    );
  }

  return (
    <section aria-labelledby="face-title" className="flex flex-col gap-5">
      <h1 id="face-title" className="text-xl">
        {t.face.title}
      </h1>
      <p className="text-muted">{t.face.lead}</p>
      <div className="flex items-stretch gap-2">
        <LanguageSelect label={t.setup.me} value={myLang} onChange={setMyLang} />
        <button
          type="button"
          aria-label={t.setup.swap}
          onClick={() => {
            setMyLang(otherLang);
            setOtherLang(myLang);
          }}
          className="flex size-tap shrink-0 items-center justify-center self-center rounded-pill bg-surface text-primary"
        >
          <ArrowLeftRight aria-hidden size={20} />
        </button>
        <LanguageSelect label={t.setup.other} value={otherLang} onChange={setOtherLang} />
      </div>
      {myLang === otherLang && <p className="text-sm text-danger">{t.setup.sameLang}</p>}
      {error && (
        <Banner
          tone="danger"
          action={
            error === t.call.noCredit ? (
              <Link href="/credits" className={buttonClass("secondary", "sm")}>
                {t.call.topUp}
              </Link>
            ) : undefined
          }
        >
          {error}
        </Banner>
      )}
      <Button size="lg" onClick={start} loading={starting} disabled={myLang === otherLang}>
        <Mic aria-hidden size={20} />
        {t.face.start}
      </Button>
      <p className="text-xs text-muted">{t.face.stub}</p>
    </section>
  );
}

/** Text shown to a given side: what the line says in that side's language. */
function textFor(line: CaptionLine, side: Role): { text: string; lang: string } {
  return line.speaker === side ? { text: line.text_src, lang: line.lang_src } : { text: line.text_dst, lang: line.lang_dst };
}

function FaceSession({ session, onStop }: { session: Session; onStop: () => void }) {
  const call = useCall({
    livekitUrl: session.livekit_url,
    token: session.token,
    role: "host",
    initialBalanceSeconds: session.balance_seconds,
    solo: true,
  });
  const [turn, setTurn] = useState<Role>("host");
  const last = call.captions.slice(-3);

  const half = (side: Role) => (
    <section
      aria-label={side === "host" ? t.call.you : t.call.them}
      className={`flex flex-1 flex-col justify-end gap-2 overflow-hidden p-4 ${
        side === "guest" ? "rotate-180 bg-caption-other text-caption-other-text" : "bg-caption-me text-caption-me-text"
      }`}
    >
      {last.length === 0 && <p className="text-center text-muted">{t.face.idle}</p>}
      {last.map((l) => {
        const { text, lang } = textFor(l, side);
        return text ? (
          <p key={l.key} dir="auto" lang={lang || undefined} className={`text-caption-xl ${l.final ? "" : "opacity-70"}`}>
            {text}
          </p>
        ) : null;
      })}
      <button
        type="button"
        aria-pressed={turn === side}
        onClick={() => {
          setTurn(side);
          void call.publishTurn(side);
        }}
        className={`mx-auto mt-2 flex size-hangup-btn items-center justify-center rounded-pill ${
          turn === side ? "bg-primary text-on-primary" : "bg-surface text-text"
        }`}
        aria-label={side === "host" ? t.face.myTurn : t.face.theirTurn}
      >
        <Mic aria-hidden size={28} />
      </button>
    </section>
  );

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-bg">
      {half("guest")}
      <div className="flex items-center justify-center gap-3 bg-call-stage py-2 text-on-call-stage">
        <Button variant="danger" size="sm" onClick={onStop}>
          <Square aria-hidden size={16} />
          {t.face.stop}
        </Button>
        {!call.canPlayAudio && (
          <Button size="sm" onClick={() => void call.startAudio()}>
            {t.call.enableAudio}
          </Button>
        )}
      </div>
      {half("host")}
    </div>
  );
}
