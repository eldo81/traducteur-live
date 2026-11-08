import type { CaptionMessage, Role } from "./contract";

export interface CaptionLine {
  key: string;
  speaker: Role;
  lang_src: string;
  text_src: string;
  lang_dst: string;
  text_dst: string;
  final: boolean;
  seq: number;
  at: number;
}

export const MAX_LINES = 200;

/**
 * Upsert a caption by (speaker, seq): partials for the same seq replace the
 * previous text; a final line is never downgraded back to partial by a late
 * packet. Lines stay ordered by arrival of their first packet.
 */
export function applyCaption(lines: CaptionLine[], msg: CaptionMessage, now = Date.now()): CaptionLine[] {
  const key = `${msg.speaker}:${msg.seq}`;
  const idx = lines.findIndex((l) => l.key === key);
  if (idx === -1) {
    const next = [...lines, { key, ...msg, at: now }];
    return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
  }
  const prev = lines[idx];
  if (prev.final && !msg.final) return lines;
  const copy = lines.slice();
  copy[idx] = {
    ...prev,
    lang_src: msg.lang_src,
    text_src: msg.text_src || prev.text_src,
    lang_dst: msg.lang_dst,
    text_dst: msg.text_dst || prev.text_dst,
    final: msg.final,
  };
  return copy;
}
