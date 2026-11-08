import json, sys
OUT = "/home/user/traducteur-live/ai-phone-clone/replica/design/"
# role -> (light, dark)
C = {
 "bg":                  ("#FFFFFF", "#0D1312"),
 "surface":             ("#F3F5F4", "#151D1B"),
 "surface-2":           ("#E8EDEB", "#1E2825"),
 "border":              ("#D4DCD9", "#2B3734"),
 "border-input":        ("#738080", "#7B8A85"),
 "text":                ("#0F1715", "#F1F5F3"),
 "muted":               ("#4A5652", "#A8B5B0"),
 "primary":             ("#0A6660", "#3CC2B5"),
 "primary-hover":       ("#084C47", "#5FD3C7"),
 "on-primary":          ("#FFFFFF", "#03201D"),
 "primary-soft":        ("#E2F1EE", "#0F302C"),
 "focus":               ("#0A6660", "#3CC2B5"),
 "danger":              ("#B42318", "#F97A6E"),
 "on-danger":           ("#FFFFFF", "#2A0703"),
 "success":             ("#1A7438", "#5FD38A"),
 "on-success":          ("#FFFFFF", "#03200F"),
 "warning":             ("#8A5300", "#F4B740"),
 "warning-soft":        ("#FFF2D1", "#2E2410"),
 "on-warning-soft":     ("#5E3A00", "#F4B740"),
 "caption-me":          ("#E2F1EE", "#0F302C"),
 "caption-me-text":     ("#0F1715", "#F1F5F3"),
 "caption-me-accent":   ("#084C47", "#7FE0D4"),
 "caption-other":       ("#FBEEDC", "#33270F"),
 "caption-other-text":  ("#0F1715", "#F1F5F3"),
 "caption-other-accent":("#7A4A00", "#F6C66A"),
 "call-stage":          ("#0D1312", "#05090A"),
 "on-call-stage":       ("#F1F5F3", "#F1F5F3"),
 "on-call-stage-muted": ("#A8B5B0", "#A8B5B0"),
 "call-control":        ("#253230", "#1E2825"),
 "hangup":              ("#D92D20", "#D92D20"),
 "on-hangup":           ("#FFFFFF", "#FFFFFF"),
}
PAIRS = [
 ("text","bg"),("text","surface"),("text","surface-2"),
 ("muted","bg"),("muted","surface"),("muted","surface-2"),
 ("on-primary","primary"),("on-primary","primary-hover"),("primary","bg"),("primary","surface"),("primary","primary-soft"),
 ("on-danger","danger"),("danger","bg"),("danger","surface"),
 ("on-success","success"),("success","bg"),
 ("warning","bg"),("on-warning-soft","warning-soft"),
 ("caption-me-text","caption-me"),("muted","caption-me"),("caption-me-accent","caption-me"),
 ("caption-other-text","caption-other"),("muted","caption-other"),("caption-other-accent","caption-other"),
 ("on-call-stage","call-stage"),("on-call-stage-muted","call-stage"),
 ("border-input","bg","ui"),("border-input","surface","ui"),("focus","bg","ui"),("focus","surface","ui"),
 ("on-call-stage","call-control"),("on-hangup","hangup"),("hangup","call-stage","ui"),("call-stage","on-call-stage"),("on-call-stage","call-stage","ui"),
]
TYPE = {  # name: (size px, line px, weight)
 "xs":(12,16,500),"sm":(14,20,400),"base":(16,24,400),"lg":(18,26,600),
 "xl":(22,28,700),"2xl":(28,34,700),"display":(36,42,800),
 "caption-src":(16,22,400),"caption":(24,32,500),"caption-lg":(30,38,500),"caption-xl":(38,46,600),
 "timer":(20,24,600),
}
SPACE = [0,4,8,12,16,20,24,32,40,48,64]
RADIUS = {"sm":6,"md":10,"lg":16,"xl":24,"pill":9999}
FONT_SANS = 'var(--font-inter, "Inter"), "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'
FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
SHADOW = {
 "card": ("0 1px 2px rgba(13,19,18,.06), 0 1px 3px rgba(13,19,18,.10)", "0 1px 2px rgba(0,0,0,.5)"),
 "pop":  ("0 12px 32px rgba(13,19,18,.18)", "0 12px 32px rgba(0,0,0,.6)"),
 "bar":  ("0 -1px 0 rgba(13,19,18,.08)", "0 -1px 0 rgba(255,255,255,.06)"),
}
MOTION = {"duration-fast":"120ms","duration-base":"200ms","duration-slow":"320ms",
          "ease-standard":"cubic-bezier(.2,.8,.2,1)","ease-exit":"cubic-bezier(.4,0,1,1)"}
SIZE = {"tap":"48px","tap-sm":"40px","call-btn":"64px","hangup-btn":"72px",
        "header-h":"56px","tabbar-h":"64px","content":"640px","content-wide":"1040px","captions":"44rem"}

def rem(px): return ("%grem" % (px/16))
def light_block():
    L=[]
    for k,(l,d) in C.items(): L.append("  --color-%s: %s;" % (k,l))
    for k,(l,d) in SHADOW.items(): L.append("  --shadow-%s: %s;" % (k,l))
    L.append("  color-scheme: light;")
    return "\n".join(L)
def dark_block(indent="  "):
    L=[]
    for k,(l,d) in C.items(): L.append("%s--color-%s: %s;" % (indent,k,d))
    for k,(l,d) in SHADOW.items(): L.append("%s--shadow-%s: %s;" % (indent,k,d))
    L.append("%scolor-scheme: dark;" % indent)
    return "\n".join(L)
def static_block():
    L=['  --font-sans: %s;' % FONT_SANS, '  --font-mono: %s;' % FONT_MONO]
    for k,(s,lh,w) in TYPE.items():
        L.append("  --text-%s: %s;" % (k, rem(s)))
        L.append("  --text-%s--line-height: %s;" % (k, rem(lh)))
        L.append("  --text-%s--font-weight: %d;" % (k, w))
    L.append("  --spacing: 0.25rem;")
    for i,v in enumerate(SPACE): L.append("  --space-%d: %s;" % (i, rem(v) if v else "0"))
    for k,v in RADIUS.items(): L.append("  --radius-%s: %s;" % (k, "9999px" if k=="pill" else rem(v)))
    for k,v in MOTION.items(): L.append("  --%s: %s;" % (k,v))
    for k,v in SIZE.items(): L.append("  --size-%s: %s;" % (k,v))
    for k,v in SIZE.items():
        ns = "container" if k.startswith(("content","captions")) else "spacing"
        L.append("  --%s-%s: %s;  /* utility: %s */" % (ns,k,v, ("max-w-"+k) if ns=="container" else ("h-/w-/size-"+k)))
    L.append("  --ring-width: 2px;\n  --ring-offset: 2px;")
    return "\n".join(L)

theme_colors = "\n".join("  --color-%s: %s;" % (k,l) for k,(l,d) in C.items())
theme_shadows = "\n".join("  --shadow-%s: %s;" % (k,l) for k,(l,d) in SHADOW.items())
css = f"""/*
 * Lien Interprète (working name) - design tokens, generated from tokens.json.
 * Import AFTER `@import "tailwindcss";` in the app's globals.css:
 *   @import "tailwindcss";
 *   @import "../../replica/design/tailwind-tokens.css";   (adjust relative path)
 *
 * - Plain :root vars work with or without Tailwind.
 * - The @theme block registers the same names with Tailwind v4, so utilities
 *   exist: bg-bg, bg-surface, text-text, text-muted, bg-primary, text-on-primary,
 *   bg-caption-me, text-caption, rounded-lg, shadow-card, font-sans, etc.
 *   Non-inline @theme -> utilities read var(--color-x), so the dark overrides
 *   below switch every utility automatically; no `dark:` variants needed.
 * - Theme: follows the OS by default; force with <html data-theme="light|dark">.
 * - Font: load Inter with next/font (variable: "--font-inter") or self-host it.
 * - Never use raw hex in components. Values change at /replica-brand; names stay.
 */

/* ---------- Tailwind v4 registration (light values = defaults) ---------- */
@theme {{
{theme_colors}
{theme_shadows}
{static_block()}
}}

/* ---------- Light (default) ---------- */
:root,
[data-theme="light"] {{
{light_block()}
{static_block()}
}}

/* ---------- Dark: OS preference unless the user forced light ---------- */
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
{dark_block("    ")}
  }}
}}

/* ---------- Dark: forced ---------- */
[data-theme="dark"] {{
{dark_block()}
}}

/* ---------- Base ---------- */
html {{
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  -webkit-text-size-adjust: 100%;
  text-rendering: optimizeLegibility;
  font-feature-settings: "cv11", "ss01";  /* Inter: single-storey a, open digits */
}}
body {{ background: var(--color-bg); color: var(--color-text); }}
:focus-visible {{
  outline: var(--ring-width) solid var(--color-focus);
  outline-offset: var(--ring-offset);
}}
@media (prefers-reduced-motion: reduce) {{
  *, *::before, *::after {{
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }}
}}
"""
open(OUT+"tailwind-tokens.css","w").write(css)
open(OUT+"tokens.css","w").write(css.replace("/* ---------- Tailwind v4 registration", "/* (identical to tailwind-tokens.css; kept for the skill's file name)\n   ---------- Tailwind v4 registration",1))

tok = {
 "_about": "Lien Interprète (working name) design tokens. Roles, not brand: values change at /replica-brand, names stay. Colours are nested light/dark; contrast.py flattens them to light-<role> / dark-<role>. Regenerate CSS from this file; check with: python3 -I contrast.py tokens.json",
 "color": {"light": {k:l for k,(l,d) in C.items()}, "dark": {k:d for k,(l,d) in C.items()}},
 "pairs": [[f"{m}-{p[0]}", f"{m}-{p[1]}"] + list(p[2:]) for m in ("light","dark") for p in PAIRS],
 "font": {"sans": FONT_SANS, "mono": FONT_MONO, "source": "Inter (SIL OFL 1.1) via next/font/google or self-hosted woff2; JetBrains Mono (OFL) optional for link tokens"},
 "type": {k:{"size":s,"line":lh,"weight":w} for k,(s,lh,w) in TYPE.items()},
 "space": SPACE,
 "radius": RADIUS,
 "shadow": {k:{"light":l,"dark":d} for k,(l,d) in SHADOW.items()},
 "motion": MOTION,
 "size": SIZE,
 "breakpoints": {"sm":"640px","md":"768px","lg":"1024px"},
 "icons": "Lucide (ISC licence), 24px, 2px stroke; 28px inside call controls",
}
json.dump(tok, open(OUT+"tokens.json","w"), ensure_ascii=False, indent=2)
