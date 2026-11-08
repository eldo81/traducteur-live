"use client";

import { History, Languages, Phone, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

const TABS = [
  { href: "/appel", label: t.nav.call, Icon: Phone },
  { href: "/face", label: t.nav.face, Icon: Users },
  { href: "/historique", label: t.nav.history, Icon: History },
  { href: "/credits", label: t.nav.credits, Icon: Wallet },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-header-h items-center justify-between border-b border-border bg-bg px-4">
        <Link href="/appel" className="flex items-center gap-2 font-semibold text-text">
          <Languages aria-hidden size={24} className="text-primary" />
          {t.app.name}
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded-md px-3 py-2 text-sm text-muted hover:text-text">
            {t.nav.signOut}
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-content flex-1 px-4 pb-24 pt-4">{children}</main>
      <nav
        aria-label={t.nav.main}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg shadow-bar pb-safe"
      >
        <ul className="mx-auto flex h-tabbar-h max-w-content">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-xs ${active ? "text-primary" : "text-muted"}`}
                >
                  <Icon aria-hidden size={24} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
