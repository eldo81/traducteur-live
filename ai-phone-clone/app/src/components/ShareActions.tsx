"use client";

import { MessageCircle, Share2 } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { useClientValue } from "@/components/useClientValue";
import { CopyButton } from "@/components/ui/CopyButton";
import { t } from "@/lib/i18n";
import { inviteText, whatsappShareUrl } from "@/lib/share";

/** WhatsApp deep link first, system share sheet when available, copy always. */
export function ShareActions({ url }: { url: string }) {
  const canShare = useClientValue(() => typeof navigator.share === "function", false);

  return (
    <div className="flex flex-col gap-3">
      <a href={whatsappShareUrl(url)} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "lg")}>
        <MessageCircle aria-hidden size={20} />
        {t.share.whatsapp}
      </a>
      {canShare && (
        <button
          type="button"
          className={buttonClass("secondary", "lg")}
          onClick={() => navigator.share({ title: t.app.name, text: inviteText(url), url }).catch(() => undefined)}
        >
          <Share2 aria-hidden size={20} />
          {t.share.other}
        </button>
      )}
      <CopyButton text={url} size="lg" />
    </div>
  );
}
