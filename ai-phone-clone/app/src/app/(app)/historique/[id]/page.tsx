import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TranscriptView } from "./TranscriptView";

export const metadata: Metadata = { title: "Transcription" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TranscriptPage({ params }: PageProps<"/historique/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return <TranscriptView roomId={id} />;
}
