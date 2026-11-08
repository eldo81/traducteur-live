/** Thresholds decided by the UI (the agent only sends remaining_seconds). */
export const LOW_BALANCE_SECONDS = 120; // first warning: 2 minutes left
export const CRITICAL_BALANCE_SECONDS = 30; // second warning: 30 seconds left
/** Host token is refused below this balance (architecture.md). */
export const MIN_START_SECONDS = 30;

export type BalanceLevel = "normal" | "low" | "critical" | "empty";

export function balanceLevel(seconds: number | null | undefined): BalanceLevel {
  if (seconds == null) return "normal";
  if (seconds <= 0) return "empty";
  if (seconds <= CRITICAL_BALANCE_SECONDS) return "critical";
  if (seconds <= LOW_BALANCE_SECONDS) return "low";
  return "normal";
}

/** 754 -> "12:34"; 3725 -> "1:02:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** 754 -> "12 min" ; 40 -> "40 s" */
export function formatMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min`;
}
