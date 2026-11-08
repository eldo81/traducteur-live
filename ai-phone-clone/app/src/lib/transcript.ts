import { languageLabel } from "./languages";

export interface TranscriptUtterance {
  speaker: "host" | "guest";
  lang_src: string;
  text_src: string;
  lang_dst: string;
  text_dst: string;
  started_at: string;
  seq: number;
}

export interface TranscriptRoom {
  id: string;
  host_lang: string;
  guest_lang: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  billed_seconds: number;
}

function hhmmss(iso: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** Plain-text export (UTF-8). Times in UTC, labelled as such. */
export function formatTranscriptTxt(
  room: TranscriptRoom,
  utterances: TranscriptUtterance[],
  summary?: { summary: string; key_points: unknown } | null,
): string {
  const lines: string[] = [];
  lines.push("Lien Interprète - transcription");
  lines.push(`Appel : ${room.id}`);
  lines.push(`Date (UTC) : ${new Date(room.started_at ?? room.created_at).toISOString()}`);
  lines.push(`Langues : vous = ${languageLabel(room.host_lang)}, interlocuteur = ${languageLabel(room.guest_lang)}`);
  lines.push(`Durée facturée : ${Math.round(room.billed_seconds / 60)} min`);
  lines.push("");

  if (summary) {
    lines.push("== Résumé ==");
    lines.push(summary.summary);
    if (Array.isArray(summary.key_points) && summary.key_points.length > 0) {
      lines.push("");
      lines.push("Points clés :");
      for (const p of summary.key_points) lines.push(`- ${String(p)}`);
    }
    lines.push("");
  }

  lines.push("== Transcription ==");
  const sorted = [...utterances].sort((a, b) => a.seq - b.seq);
  for (const u of sorted) {
    const who = u.speaker === "host" ? "Vous" : "Interlocuteur";
    lines.push(`[${hhmmss(u.started_at)}] ${who} (${u.lang_src}) : ${u.text_src}`);
    lines.push(`           -> (${u.lang_dst}) : ${u.text_dst}`);
  }
  if (sorted.length === 0) lines.push("(aucune phrase enregistrée)");
  return lines.join("\n") + "\n";
}
