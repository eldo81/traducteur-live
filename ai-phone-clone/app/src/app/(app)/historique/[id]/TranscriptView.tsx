"use client";

import { ArrowLeft, Download, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CaptionBubble } from "@/components/call/CaptionStream";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClass } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSupabaseSession } from "@/components/useSupabase";
import { fmt, t } from "@/lib/i18n";
import { languageLabel } from "@/lib/languages";
import type { CallRoomRow, CallSummaryRow, UtteranceRow } from "@/lib/supabase/types";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

export function TranscriptView({ roomId }: { roomId: string }) {
  const session = useSupabaseSession();
  const [room, setRoom] = useState<CallRoomRow | null | undefined>(undefined);
  const [utterances, setUtterances] = useState<UtteranceRow[]>([]);
  const [summary, setSummary] = useState<CallSummaryRow | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    const db = session.supabase;
    Promise.all([
      db.from("call_rooms").select("*").eq("id", roomId).maybeSingle(),
      db.from("utterances").select("*").eq("room_id", roomId).order("seq", { ascending: true }),
      db.from("call_summaries").select("*").eq("room_id", roomId).maybeSingle(),
    ]).then(([r, u, s]) => {
      setRoom(r.data ?? null);
      setUtterances(u.data ?? []);
      setSummary(s.data ?? null);
    });
  }, [session, roomId]);

  async function onDelete() {
    if (session.status !== "signed-in" || !window.confirm(t.history.deleteConfirm)) return;
    setDeleting(true);
    // RLS allows the owner to delete utterances and summaries (GDPR).
    await Promise.all([
      session.supabase.from("utterances").delete().eq("room_id", roomId),
      session.supabase.from("call_summaries").delete().eq("room_id", roomId),
    ]);
    setUtterances([]);
    setSummary(null);
    setDeleted(true);
    setDeleting(false);
  }

  const back = (
    <Link href="/historique" className="inline-flex items-center gap-2 text-sm text-primary">
      <ArrowLeft aria-hidden size={18} />
      {t.nav.back}
    </Link>
  );

  if (session.status === "unconfigured") return <Banner tone="warning">{t.landing.notConfigured}</Banner>;
  if (room === undefined) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (room === null) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Banner tone="danger">{t.history.notFound}</Banner>
      </div>
    );
  }

  const keyPoints = Array.isArray(summary?.key_points) ? (summary.key_points as unknown[]).map(String) : [];

  return (
    <article className="flex flex-col gap-5">
      {back}
      <header>
        <h1 className="text-xl">
          {languageLabel(room.host_lang)} ⇄ {languageLabel(room.guest_lang)}
        </h1>
        <p className="text-sm text-muted">
          {dateFmt.format(new Date(room.started_at ?? room.created_at))} · {t.history.status[room.status]}
          {room.billed_seconds > 0 && ` · ${fmt(t.history.billed, { min: Math.ceil(room.billed_seconds / 60) })}`}
        </p>
      </header>

      {deleted && <Banner tone="success">{t.history.deleted}</Banner>}

      <section aria-labelledby="summary-title" className="rounded-lg bg-surface p-4">
        <h2 id="summary-title" className="mb-2 flex items-center gap-2 text-lg">
          <Sparkles aria-hidden size={20} className="text-primary" />
          {t.history.summary}
        </h2>
        {summary ? (
          <>
            <p dir="auto" lang={summary.lang}>
              {summary.summary}
            </p>
            {keyPoints.length > 0 && (
              <>
                <h3 className="mt-3 text-base font-semibold">{t.history.keyPoints}</h3>
                <ul className="list-disc pl-5" dir="auto" lang={summary.lang}>
                  {keyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="text-muted">{t.history.summaryPending}</p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <a href={`/api/rooms/${roomId}/transcript.txt`} className={buttonClass("secondary")} download>
          <Download aria-hidden size={20} />
          {t.history.export}
        </a>
        {(utterances.length > 0 || summary) && (
          <Button variant="ghost" onClick={onDelete} loading={deleting} className="text-danger">
            <Trash2 aria-hidden size={20} />
            {t.history.deleteTranscript}
          </Button>
        )}
      </div>

      <section aria-labelledby="transcript-title">
        <h2 id="transcript-title" className="mb-3 text-lg">
          {t.history.transcript}
        </h2>
        {utterances.length === 0 ? (
          <p className="text-muted">{t.history.noUtterances}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {utterances.map((u) => (
              <CaptionBubble
                key={u.id}
                myRole="host"
                size="caption"
                line={{ key: u.id, speaker: u.speaker, lang_src: u.lang_src, text_src: u.text_src, lang_dst: u.lang_dst, text_dst: u.text_dst, final: true, seq: u.seq, at: 0 }}
              />
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
