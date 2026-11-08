import type { ReactNode } from "react";

export function EmptyState({ icon, title, lead, action }: { icon: ReactNode; title: string; lead?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-pill bg-primary-soft text-primary">{icon}</div>
      <h2 className="text-lg">{title}</h2>
      {lead && <p className="max-w-sm text-sm text-muted">{lead}</p>}
      {action}
    </div>
  );
}
