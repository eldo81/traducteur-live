import { fr, type Messages } from "./fr";

export type Locale = "fr";
export const DEFAULT_LOCALE: Locale = "fr";

const dictionaries: Record<Locale, Messages> = { fr };

/** Active dictionary. V1 ships French only; add "en" here later. */
export const t: Messages = dictionaries[DEFAULT_LOCALE];

/** "{n} minutes" + {n: 5} -> "5 minutes" */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`));
}
