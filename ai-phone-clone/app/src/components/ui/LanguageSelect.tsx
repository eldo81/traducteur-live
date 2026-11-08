"use client";

import { useId } from "react";
import { t } from "@/lib/i18n";
import { LANGUAGES } from "@/lib/languages";

/** Native select styled as the LanguagePicker field (accessible, light on bytes). TODO: bottom sheet with search + recents. */
export function LanguageSelect({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  exclude?: string;
}) {
  const id = useId();
  const current = LANGUAGES.find((l) => l.code === value);
  return (
    <div className="flex-1 rounded-md border border-border-input bg-surface px-3 py-2 focus-within:border-primary">
      <label htmlFor={id} className="block text-xs text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-lg font-semibold text-text outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} disabled={l.code === exclude}>
            {l.label}
            {l.native !== l.label ? ` · ${l.native}` : ""}
          </option>
        ))}
      </select>
      {current?.captionsOnly && <p className="text-xs text-warning">{t.setup.captionsOnly}</p>}
    </div>
  );
}
