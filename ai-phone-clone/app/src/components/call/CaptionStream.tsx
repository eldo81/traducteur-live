"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptionLine } from "@/lib/captions";
import type { Role } from "@/lib/contract";
import { t } from "@/lib/i18n";

type Size = "caption" | "caption-lg" | "caption-xl";
const SIZE_CLASS: Record<Size, string> = { caption: "text-caption", "caption-lg": "text-caption-lg", "caption-xl": "text-caption-xl" };

/**
 * One bubble. For my lines the original (what I said) is small and the
 * translation (what the other hears) big; for the other's lines the
 * translation into my language is the hero. Each text line gets dir="auto" + lang.
 */
export function CaptionBubble({ line, myRole, size = "caption-lg" }: { line: CaptionLine; myRole: Role; size?: Size }) {
  const mine = line.speaker === myRole;
  const hasDst = line.text_dst.trim().length > 0;
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-lg px-4 py-3 ${
          mine ? "rounded-br-sm bg-caption-me text-caption-me-text" : "rounded-bl-sm bg-caption-other text-caption-other-text"
        }`}
      >
        <p className={`text-xs font-semibold ${mine ? "text-caption-me-accent" : "text-caption-other-accent"}`}>
          {mine ? t.call.you : t.call.them}
        </p>
        {line.text_src && (
          <p dir="auto" lang={line.lang_src || undefined} className="text-caption-src text-muted">
            {line.text_src}
          </p>
        )}
        {hasDst && (
          <p
            dir="auto"
            lang={line.lang_dst || undefined}
            className={`${SIZE_CLASS[size]} ${line.final ? "" : "opacity-70"} transition-opacity duration-[var(--duration-slow)]`}
          >
            {line.text_dst}
            {!line.final && <span aria-hidden> …</span>}
          </p>
        )}
      </div>
    </li>
  );
}

export function CaptionStream({ lines, myRole, size }: { lines: CaptionLine[]; myRole: Role; size?: Size }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines, pinned]);

  const lastFinal = [...lines].reverse().find((l) => l.final && l.speaker !== myRole);

  return (
    <div className="relative min-h-0 flex-1">
      <ol
        ref={listRef}
        role="log"
        aria-label={t.history.transcript}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
        className="mx-auto flex h-full max-w-captions flex-col gap-3 overflow-y-auto p-4"
      >
        {lines.length === 0 && <li className="m-auto text-center text-muted">{t.call.captionsEmpty}</li>}
        {lines.map((l) => (
          <CaptionBubble key={l.key} line={l} myRole={myRole} size={size} />
        ))}
      </ol>
      {/* Screen readers: only final translated lines of the other person. */}
      <p aria-live="polite" className="sr-only" lang={lastFinal?.lang_dst}>
        {lastFinal?.text_dst}
      </p>
      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-pop"
        >
          {t.call.newMessages}
        </button>
      )}
    </div>
  );
}
