import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostCall } from "./HostCall";

export const metadata: Metadata = { title: "Appel en cours" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HostCallPage({ params }: PageProps<"/appel/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return <HostCall roomId={id} />;
}
