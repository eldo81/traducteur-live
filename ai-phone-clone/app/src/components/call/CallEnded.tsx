import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { t } from "@/lib/i18n";

export function CallEnded({ roomId, billedSeconds }: { roomId?: string; billedSeconds?: number | null }) {
  return (
    <main className="mx-auto flex w-full max-w-content flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-pill bg-primary-soft text-success">
        <CheckCircle2 aria-hidden size={32} />
      </div>
      <h1 className="text-xl">{t.call.ended}</h1>
      {roomId && <p className="text-muted">{t.call.endedLead}</p>}
      {billedSeconds != null && <p className="text-sm text-muted">{Math.ceil(billedSeconds / 60)} min</p>}
      {roomId && (
        <div className="flex w-full flex-col gap-3">
          <Link href={`/historique/${roomId}`} className={buttonClass("primary", "lg")}>
            {t.call.seeTranscript}
          </Link>
          <Link href="/appel" className={buttonClass("secondary", "lg")}>
            {t.call.newCall}
          </Link>
        </div>
      )}
    </main>
  );
}
