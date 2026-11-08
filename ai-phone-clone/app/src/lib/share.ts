import { t } from "./i18n";

export function inviteText(url: string): string {
  return t.share.message.replace("{url}", url);
}

/** WhatsApp deep link with the invitation prefilled (user picks the contact). */
export function whatsappShareUrl(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteText(url))}`;
}
