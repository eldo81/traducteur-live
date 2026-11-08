"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { Button, type ButtonProps } from "./Button";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Old webviews: fallback through a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = t.share.copy, ...rest }: { text: string; label?: string } & Omit<ButtonProps, "onClick">) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <>
      <Button
        variant="secondary"
        {...rest}
        onClick={async () => {
          const ok = await copyText(text);
          setState(ok ? "ok" : "fail");
          if (ok) setTimeout(() => setState("idle"), 2000);
        }}
      >
        {state === "ok" ? <Check aria-hidden size={20} /> : <Copy aria-hidden size={20} />}
        {state === "ok" ? t.share.copied : label}
      </Button>
      <span role="status" className="sr-only">
        {state === "ok" ? t.share.copied : state === "fail" ? t.share.copyFailed : ""}
      </span>
      {state === "fail" && <p className="text-sm text-danger">{t.share.copyFailed}</p>}
    </>
  );
}
