import { describe, expect, it } from "vitest";
import { chromeIntentUrl, detectInAppBrowser } from "@/lib/in-app-browser";

const UA = {
  whatsappAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 WhatsApp/2.24.1.6",
  whatsappIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.1.80",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.32.112 (iPhone14,5; iOS 17_1; fr_FR; fr; scale=3.00; 1170x2532; 548339486)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/439.0.0.29.119;]",
  wechat:
    "Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 Mobile Safari/537.36 MicroMessenger/8.0.40.2420",
  genericAndroidWebview:
    "Mozilla/5.0 (Linux; Android 11; Redmi Note 8 Build/RKQ1.201004.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
  genericIosWebview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

describe("detectInAppBrowser", () => {
  it.each([
    ["whatsappAndroid", "whatsapp", "android"],
    ["whatsappIos", "whatsapp", "ios"],
    ["instagramIos", "instagram", "ios"],
    ["facebookAndroid", "facebook", "android"],
    ["wechat", "wechat", "android"],
    ["genericAndroidWebview", "webview", "android"],
    ["genericIosWebview", "webview", "ios"],
  ] as const)("flags %s", (key, app, os) => {
    expect(detectInAppBrowser(UA[key])).toEqual({ inApp: true, app, os });
  });

  it.each(["safariIos", "chromeIos", "chromeAndroid", "chromeDesktop"] as const)("does not flag real browser %s", (key) => {
    expect(detectInAppBrowser(UA[key]).inApp).toBe(false);
  });

  it("handles missing UA", () => {
    expect(detectInAppBrowser(undefined)).toEqual({ inApp: false, app: null, os: "other" });
  });
});

describe("chromeIntentUrl", () => {
  it("builds an Android intent for Chrome", () => {
    expect(chromeIntentUrl("https://lien.example/j/abcDEF_123-xyzABCdefGHI", "android")).toBe(
      "intent://lien.example/j/abcDEF_123-xyzABCdefGHI#Intent;scheme=https;package=com.android.chrome;end",
    );
  });
  it("returns null on iOS", () => {
    expect(chromeIntentUrl("https://lien.example/j/x", "ios")).toBeNull();
  });
});
