/**
 * Detects in-app browsers (webviews opened from messaging apps) where the
 * microphone is often blocked, so the guest page can offer
 * "open in Chrome / Safari" plus a copy-link fallback.
 */
export type InAppApp =
  | "whatsapp"
  | "facebook"
  | "messenger"
  | "instagram"
  | "telegram"
  | "wechat"
  | "line"
  | "snapchat"
  | "tiktok"
  | "linkedin"
  | "webview";

export type Os = "ios" | "android" | "other";

export interface BrowserInfo {
  os: Os;
  inApp: boolean;
  app: InAppApp | null;
}

const RULES: Array<[InAppApp, RegExp]> = [
  ["whatsapp", /WhatsApp/i],
  ["messenger", /FBAN\/Messenger|FB_IAB\/MESSENGER|FBMSGR|\bMessenger\b/i],
  ["instagram", /Instagram/i],
  ["facebook", /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i],
  ["telegram", /Telegram/i],
  ["wechat", /MicroMessenger/i],
  ["line", /\bLine\//i],
  ["snapchat", /Snapchat/i],
  ["tiktok", /musical_ly|BytedanceWebview|TikTok/i],
  ["linkedin", /LinkedInApp/i],
];

export function detectOs(ua: string): Os {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports as Mac; touch check is not available server-side.
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function detectInAppBrowser(ua: string | null | undefined): BrowserInfo {
  const s = ua ?? "";
  const os = detectOs(s);
  for (const [app, re] of RULES) {
    if (re.test(s)) return { os, inApp: true, app };
  }
  // Generic Android WebView marker: "; wv)".
  if (os === "android" && /;\s*wv\)/i.test(s)) return { os, inApp: true, app: "webview" };
  // iOS WKWebView without Safari token (real Safari, Chrome iOS = CriOS, Firefox = FxiOS all carry "Safari/").
  if (os === "ios" && /AppleWebKit/i.test(s) && !/Safari\//i.test(s)) {
    return { os, inApp: true, app: "webview" };
  }
  return { os, inApp: false, app: null };
}

/**
 * Android intent URL that asks the system to open the page in Chrome.
 * Returns null on other platforms (iOS cannot be forced out of a webview).
 */
export function chromeIntentUrl(pageUrl: string, os: Os): string | null {
  if (os !== "android") return null;
  try {
    const u = new URL(pageUrl);
    const scheme = u.protocol.replace(":", "");
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}
