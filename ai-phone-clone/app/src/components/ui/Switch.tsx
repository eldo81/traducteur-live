"use client";

import { useId } from "react";

export function Switch({
  checked,
  onChange,
  label,
  help,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-tap items-center gap-4 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-base">
          {label}
        </label>
        {help && (
          <p id={`${id}-help`} className="text-sm text-muted">
            {help}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={help ? `${id}-help` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-13 shrink-0 rounded-pill border transition-colors duration-[var(--duration-fast)] disabled:opacity-40 ${
          checked ? "bg-primary border-primary" : "bg-surface-2 border-border-input"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 size-6.5 rounded-pill shadow-card transition-transform duration-[var(--duration-fast)] ${
            checked ? "translate-x-5.5 bg-on-primary" : "translate-x-0.5 bg-bg"
          }`}
        />
      </button>
    </div>
  );
}
