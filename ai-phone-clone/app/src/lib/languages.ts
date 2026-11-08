/** Languages offered in V1. Codes are BCP-47 base tags, passed as-is to the agent. */
export interface Language {
  code: string;
  /** name in French (UI language) */
  label: string;
  /** endonym */
  native: string;
  rtl?: boolean;
  /** voice output not reliable yet: captions only */
  captionsOnly?: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { code: "fr", label: "Français", native: "Français" },
  { code: "en", label: "Anglais", native: "English" },
  { code: "es", label: "Espagnol", native: "Español" },
  { code: "pt", label: "Portugais", native: "Português" },
  { code: "ar", label: "Arabe", native: "العربية", rtl: true },
  { code: "de", label: "Allemand", native: "Deutsch" },
  { code: "it", label: "Italien", native: "Italiano" },
  { code: "nl", label: "Néerlandais", native: "Nederlands" },
  { code: "tr", label: "Turc", native: "Türkçe" },
  { code: "zh", label: "Chinois", native: "中文" },
  { code: "wo", label: "Wolof", native: "Wolof", captionsOnly: true },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

export function isRtl(code: string): boolean {
  return LANGUAGES.find((l) => l.code === code)?.rtl === true;
}

/** Voice ids are opaque to the web app; the agent maps them to engine voices. */
export const VOICES: readonly { id: string; label: string }[] = [
  { id: "auto", label: "Automatique" },
  { id: "warm", label: "Chaleureuse" },
  { id: "clear", label: "Claire" },
  { id: "deep", label: "Grave" },
];
export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];
