import type { ReactNode } from "react";

type Tone = "info" | "warning" | "danger" | "success";
const TONES: Record<Tone, string> = {
  info: "bg-primary-soft text-text",
  warning: "bg-warning-soft text-on-warning-soft",
  danger: "bg-surface text-danger border-l-4 border-danger",
  success: "bg-primary-soft text-success",
};

export function Banner({
  tone = "info",
  children,
  action,
  live,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
  /** aria-live politeness, for banners that appear during a call */
  live?: "polite" | "assertive";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live={live}
      className={`flex flex-wrap items-center gap-3 rounded-md px-4 py-3 text-sm ${TONES[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
