export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-sm bg-surface-2 motion-safe:animate-pulse ${className}`} />;
}
