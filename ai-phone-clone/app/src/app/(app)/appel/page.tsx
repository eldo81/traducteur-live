import type { Metadata } from "next";
import { CallSetup } from "./CallSetup";

export const metadata: Metadata = { title: "Nouvel appel" };

export default function CallSetupPage() {
  return <CallSetup />;
}
