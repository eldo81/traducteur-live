import { Languages } from "lucide-react";
import { Suspense } from "react";
import { LoginPanel } from "@/components/LoginPanel";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/lib/i18n";

export default function LandingPage() {
  return (
    <main className="mx-auto grid w-full max-w-content-wide flex-1 gap-10 px-4 py-10 md:grid-cols-2 md:items-start">
      <section className="flex flex-col gap-6">
        <p className="flex items-center gap-2 font-semibold text-primary">
          <Languages aria-hidden size={24} />
          {t.app.name}
        </p>
        <h1 className="text-display">{t.landing.title}</h1>
        <p className="text-lg font-normal text-muted">{t.landing.lead}</p>
        <ol className="flex flex-col gap-3">
          {t.landing.steps.map((s, i) => (
            <li key={s} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-sm font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-1">{s}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">{t.landing.pricing}</p>
      </section>
      <section aria-labelledby="login-title" className="rounded-lg bg-surface p-6 shadow-card">
        <h2 id="login-title" className="mb-4 text-xl">
          {t.landing.loginTitle}
        </h2>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <LoginPanel />
        </Suspense>
      </section>
    </main>
  );
}
