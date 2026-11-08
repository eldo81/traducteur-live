"use client";

import { ChevronRight, FileText, History, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSupabaseSession } from "@/components/useSupabase";
import { fmt, t } from "@/lib/i18n";
import type { CallRoomRow } from "@/lib/supabase/types";

type Row = Pick<CallRoomRow, "id" | "status" | "host_lang" | "guest_lang" | "created_at" | "billed_seconds">;

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function HistoryList() {
  const session = useSupabaseSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    session.supabase
      .from("call_rooms")
      .select("id, status, host_lang, guest_lang, created_at, billed_seconds")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (err) setError(true);
        else setRows(data ?? []);
      });
  }, [session]);

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-4">
      <h1 id="history-title" className="text-xl">
        {t.history.title}
      </h1>
      {session.status === "unconfigured" && <Banner tone="warning">{t.landing.notConfigured}</Banner>}
      {error && <Banner tone="danger">{t.history.loadError}</Banner>}
      {!rows && !error && session.status !== "unconfigured" && (
        <ul className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="h-18" />
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 && (
        <EmptyState
          icon={<History aria-hidden size={32} />}
          title={t.history.empty}
          lead={t.history.emptyLead}
          action={
            <Link href="/appel" className={buttonClass("primary")}>
              {t.history.start}
            </Link>
          }
        />
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/historique/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-primary">
                  <Phone aria-hidden size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {r.host_lang.toUpperCase()} → {r.guest_lang.toUpperCase()}
                    <span className="ml-2 text-sm font-normal text-muted">{t.history.status[r.status]}</span>
                  </span>
                  <span className="block text-sm text-muted">
                    {dateFmt.format(new Date(r.created_at))}
                    {r.billed_seconds > 0 && ` · ${fmt(t.history.billed, { min: Math.ceil(r.billed_seconds / 60) })}`}
                  </span>
                </span>
                <FileText aria-label={t.history.transcript} size={20} className="text-muted" />
                <ChevronRight aria-hidden size={20} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
