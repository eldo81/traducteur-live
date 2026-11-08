import type { Metadata } from "next";
import { Suspense } from "react";
import { Credits } from "./Credits";

export const metadata: Metadata = { title: "Minutes" };

export default function CreditsPage() {
  return (
    <Suspense>
      <Credits />
    </Suspense>
  );
}
