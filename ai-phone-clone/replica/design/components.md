# Lien Interprète (working name): design system and component specs

Clean-room design. Nothing here comes from AI Phone: no logo, colours, copy,
icons, illustrations or fonts were taken (no screenshots were used either). The
system is built from the recon's screen list (S01 to S15) and component list,
for business callers in Dakar and Europe, on phones first, often on 4G, often
outdoors.

Files in this folder:

| file | what it is |
| --- | --- |
| `tokens.json` | source of truth: colour roles (light + dark), type, space, radius, shadow, motion, sizes, contrast pairs |
| `tailwind-tokens.css` | the file the app imports: CSS custom properties + Tailwind v4 `@theme` registration, light / dark / forced theme |
| `tokens.css` | same content, under the file name the skill expects |
| `build_tokens.py` | regenerates `tokens.json`, `tailwind-tokens.css` and `tokens.css` from one table. Edit values there, rerun, rerun the contrast check |
| `contrast-report.txt` | output of `contrast.py`: 70 pairs, 0 AA failures |
| `components.md` | this file |

## 1. Principles

1. **Captions are the hero.** In S07 and S10 the translated line is the biggest
   thing on screen (24 px minimum, 30 px default on phones, 38 px in
   face-to-face). The original line sits above it, smaller and muted.
2. **Sunlight first.** Body text runs 15:1 to 18:1 on its background. Muted
   text never drops below 6.4:1. No grey-on-grey, no thin weights below 400,
   no text on images.
3. **Who said it, shown twice.** Speaker is told apart by colour (teal
   "me" / sand "other"), by side (right / left) and by a text label. Never
   colour alone.
4. **Light on bytes.** One variable font (Inter, about 100 KB woff2 for Latin +
   Latin Extended), one icon set tree-shaken (Lucide), no images in the call
   path, no web-font for icons. Skeletons, not spinners, on lists.
5. **Thumb reach.** Primary actions sit in the bottom third. Tap targets are
   48 px (40 px only for secondary icon buttons with 4 px of padding around).
6. **Bilingual from day one.** French and English UI. Labels are written to
   survive 30 % growth (French runs long). Arabic captions render right to left
   inside the bubble (`dir="auto"` on caption text) while the layout stays put.

## 2. Foundations

### Colour roles

Palette idea: a deep **teal** for action and for "me", a warm **sand** for the
other person, neutral greens-greys for structure. Original choice, not taken
from the target. `/replica-brand` can swap every value; role names stay.

| role | light | dark | job |
| --- | --- | --- | --- |
| `bg` | `#FFFFFF` | `#0D1312` | page |
| `surface` | `#F3F5F4` | `#151D1B` | cards, sheets, inputs at rest |
| `surface-2` | `#E8EDEB` | `#1E2825` | pressed rows, segmented track, skeleton |
| `border` | `#D4DCD9` | `#2B3734` | dividers, card outlines (decorative) |
| `border-input` | `#738080` | `#7B8A85` | input / switch / checkbox outline (3:1 UI) |
| `text` | `#0F1715` | `#F1F5F3` | body and headings |
| `muted` | `#4A5652` | `#A8B5B0` | secondary text, original-language caption line |
| `primary` | `#0A6660` | `#3CC2B5` | main action, links, active tab, focus ring |
| `primary-hover` | `#084C47` | `#5FD3C7` | hover / pressed of primary |
| `on-primary` | `#FFFFFF` | `#03201D` | text and icons on primary |
| `primary-soft` | `#E2F1EE` | `#0F302C` | selected card, chip, active row |
| `focus` | `#0A6660` | `#3CC2B5` | focus-visible ring |
| `danger` / `on-danger` | `#B42318` / `#FFFFFF` | `#F97A6E` / `#2A0703` | destructive, errors |
| `success` / `on-success` | `#1A7438` / `#FFFFFF` | `#5FD38A` / `#03200F` | connected, saved, paid |
| `warning` | `#8A5300` | `#F4B740` | low balance, weak network (text/icon) |
| `warning-soft` / `on-warning-soft` | `#FFF2D1` / `#5E3A00` | `#2E2410` / `#F4B740` | warning banner |
| `caption-me` / `caption-me-text` / `caption-me-accent` | `#E2F1EE` / `#0F1715` / `#084C47` | `#0F302C` / `#F1F5F3` / `#7FE0D4` | my bubbles; accent = speaker label |
| `caption-other` / `caption-other-text` / `caption-other-accent` | `#FBEEDC` / `#0F1715` / `#7A4A00` | `#33270F` / `#F1F5F3` / `#F6C66A` | the other person's bubbles |
| `call-stage` / `on-call-stage` / `on-call-stage-muted` | `#0D1312` / `#F1F5F3` / `#A8B5B0` | `#05090A` / same | video / avatar stage in S07 (always dark, both themes) |
| `call-control` | `#253230` | `#1E2825` | round call buttons at rest on the stage |
| `hangup` / `on-hangup` | `#D92D20` / `#FFFFFF` | same | hang-up button (same in both themes, users learn it) |

Greys used: 6 per theme (`bg`, `surface`, `surface-2`, `border`, `border-input`, `muted`).

### Type

Font: **Inter** (SIL Open Font License), variable, loaded with `next/font/google`
(`variable: "--font-inter"`, subsets `latin`, `latin-ext`, `display: "swap"`) or
self-hosted woff2. Fallback stack `system-ui, -apple-system, Segoe UI, Roboto,
Noto Sans`. Arabic captions fall back to the system Arabic face (Noto Sans
Arabic on Android, SF Arabic on iOS); no extra download. Features `cv11`,
`ss01` for clearer `a` and digits. Optional `JetBrains Mono` (OFL) only for
the link token in S05; the system mono stack is fine too.

| token | size / line | weight | use |
| --- | --- | --- | --- |
| `text-xs` | 12 / 16 | 500 | badges, timestamps |
| `text-sm` | 14 / 20 | 400 | secondary rows, helper text |
| `text-base` | 16 / 24 | 400 | body, inputs (16 avoids iOS zoom) |
| `text-lg` | 18 / 26 | 600 | list titles, button lg |
| `text-xl` | 22 / 28 | 700 | screen titles |
| `text-2xl` | 28 / 34 | 700 | paywall, summary headings |
| `text-display` | 36 / 42 | 800 | onboarding hero only |
| `text-caption-src` | 16 / 22 | 400 | original line in a caption bubble (muted) |
| `text-caption` | 24 / 32 | 500 | translated line, minimum and "compact" setting |
| `text-caption-lg` | 30 / 38 | 500 | translated line, **default** on phones |
| `text-caption-xl` | 38 / 46 | 600 | face-to-face (S10) and "huge" setting |
| `text-timer` | 20 / 24 | 600 | call duration, credits counter (tabular numbers) |

Rules: `font-variant-numeric: tabular-nums` on timers and balances. Captions
never truncate; they wrap. User can choose caption size (Compact / Large /
Huge) in S14 and from the call menu; it maps to `text-caption`,
`text-caption-lg`, `text-caption-xl`.

### Space, radius, shadow, motion, sizes

- Space: 4 px base. `--space-0..10` = 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
  Tailwind `--spacing: 0.25rem`, so `p-4` = 16 px. Screen gutter 16 px,
  card padding 16 px, section gap 24 px.
- Radius: `sm` 6 (chips, badges), `md` 10 (inputs, buttons), `lg` 16 (cards,
  caption bubbles), `xl` 24 (bottom sheets top corners), `pill` (tabs, switch,
  round call buttons).
- Shadow: `card` (lists, subtle), `pop` (sheets, menus, toasts), `bar`
  (tab bar top edge). Dark theme leans on borders, shadows are near-black.
- Motion: `fast` 120 ms (press, toggle), `base` 200 ms (sheet, toast),
  `slow` 320 ms (caption settle); `ease-standard`. All of it drops to ~0 under
  `prefers-reduced-motion`. Captions never animate in by sliding when reduced
  motion is on; they just appear.
- Sizes: `tap` 48, `tap-sm` 40, `call-btn` 64, `hangup-btn` 72, `header-h` 56,
  `tabbar-h` 64 (+ `env(safe-area-inset-bottom)`), `content` 640 max width,
  `content-wide` 1040, `captions` 44 rem max line box on desktop.
- Breakpoints: `sm` 640, `md` 768, `lg` 1024. Phone layout is the design;
  above `md` the host app centres a 640 px column, the call screen puts the
  caption stream beside the video.

### Icons and illustration

Lucide (ISC licence), 24 px, 2 px stroke; 28 px inside call controls. Icons
used: `phone`, `video`, `mic`, `mic-off`, `video-off`, `volume-2`,
`phone-off`, `keyboard`, `link`, `copy`, `share-2`, `languages`,
`arrow-left-right`, `history`, `users`, `settings`, `wallet`, `file-text`,
`sparkles` (summary), `wifi-low`, `alert-triangle`, `check`, `x`, `search`,
`chevron-right`, `globe`. Empty-state illustrations: none in V1; a 48 px Lucide
icon in a `primary-soft` circle plus a written line. Own illustrations later at
`/replica-brand`.

### Theme

Default follows the OS (`prefers-color-scheme`). User override in S14 writes
`data-theme="light|dark"` on `<html>` (store in a cookie so the server renders
the right theme, no flash). The call stage (S07 video area) is always dark.

## 3. Components

30 component specs (the 13 from the recon plus 17 the screens need). Each block: variants, sizes, states, tokens, accessibility,
screens. "Must" states the recon did not see are added (focus, disabled,
loading, error, empty).

```
Button
  variants  primary, secondary (surface + border), ghost, danger, link
  sizes     sm 40px (text-sm/600), md 48px (text-base/600), lg 56px (text-lg/600, full width on phones)
  states    default, hover (primary-hover), pressed (scale .98, fast), focus-visible (2px ring focus, 2px offset),
            disabled (40% opacity, no pointer), loading (spinner left of label, label kept, aria-busy=true)
  tokens    bg primary, text on-primary, radius md, px space-5, gap space-2, icon 20px
  a11y      real <button>; type set; loading keeps the accessible name; disabled uses aria-disabled when it must stay focusable to explain why
  used on   all; lg primary = "Lancer l'appel" S04, "Rejoindre" S06, "Recharger" S15
```

```
IconButton
  variants  ghost, surface, on-stage (call-control)
  sizes     40px (tap-sm, 24px icon) and 48px (tap)
  states    default, pressed, focus-visible, disabled, toggled (aria-pressed)
  tokens    radius pill, icon text or on-call-stage
  a11y      aria-label always (icon only); tooltip on desktop hover/focus
  used on   headers (back, menu), S05 copy, S09 share
```

```
TabBar
  variants  4 tabs V1: Appels, Face-à-face, Historique, Compte (5th "Explorer" slot reserved for V2)
  sizes     height tabbar-h 64 + safe-area; icon 24 + label text-xs/500
  states    active (primary icon + label, 3px primary pill above icon), inactive (muted), badge (danger dot or count, text-xs on danger), focus-visible
  tokens    bg bg, top shadow bar, border-top border
  a11y      <nav aria-label>; links with aria-current="page"; label always visible (no icon-only tabs)
  used on   S02, S10, S13, S14 (hidden in S07, S06, S01)
```

```
AppHeader
  variants  title, back + title, large title (S02 / S14)
  sizes     header-h 56; large title text-xl
  states    default, scrolled (border-bottom appears), offline (warning strip under it)
  tokens    bg bg, text text, border border
  a11y      one <h1> per screen; back button aria-label "Retour"
  used on   all host screens
```

```
LanguagePicker   (Sélecteur de langue)
  variants  pair (two fields "Moi" / "Mon interlocuteur" with a swap button between), single
  sizes     field 64px tall: label text-xs muted, language text-lg/600 with endonym ("Wolof", "العربية") and code
  states    closed, open (bottom sheet with search + "Récentes" + full list), selected (check, primary-soft row),
            swap pressed (arrow-left-right rotates 180deg, fast), unsupported-for-voice (warning text "sous-titres seulement"), focus-visible, disabled
  tokens    field bg surface, border-input, radius md; sheet = BottomSheet
  a11y      field is a button opening a dialog; list is role=listbox with type-ahead; swap has aria-label "Inverser les langues" and announces the new pair via aria-live
  used on   S04, S10
```

```
VoicePicker   (Sélecteur de voix)
  variants  list of AI voices per side, each row with a 2s preview play button
  states    idle, previewing (play -> stop, bar animation), selected, loading preview, error ("aperçu indisponible")
  tokens    rows ListRow, selected primary-soft + check
  a11y      radio group; preview button separately labelled "Écouter <voix>"
  used on   S04 (behind "Plus d'options")
```

```
Switch   (Interrupteur)
  sizes     track 52x32, thumb 26; whole row is the hit area (min 48px)
  states    off (track surface-2, border-input outline), on (track primary, thumb on-primary), focus-visible, disabled
  tokens    radius pill, motion fast
  a11y      <button role="switch" aria-checked> or native checkbox; label text on the row, helper text linked by aria-describedby
  used on   S04 ("Couper ma voix d'origine", "Couper sa voix d'origine"), S14
```

```
SegmentedControl
  variants  2 or 3 segments: Vidéo / Voix (S04); Conversation / Écoute (S10); caption size Compact / Grand / Très grand
  sizes     48px tall, text-sm/600
  states    selected (bg bg + shadow card on a surface-2 track), unselected (muted), focus-visible, disabled
  tokens    track surface-2, radius md
  a11y      radio group with arrow-key navigation
  used on   S04, S10, S14, S07 menu
```

```
TextField
  variants  text, search (leading icon), multiline (Type-to-Speak), read-only with copy (link field)
  sizes     48px, text-base (16px keeps iOS from zooming)
  states    default, focus (2px primary border), filled, error (danger border + message with alert icon), disabled, read-only
  tokens    bg bg, border border-input, radius md, label text-sm/600 above, helper text-sm muted
  a11y      visible <label>; error tied by aria-describedby and aria-invalid; never placeholder-as-label
  used on   S04 search, S07 Type-to-Speak, S14, S06 display name (optional)
```

```
LinkCard   (lien généré)
  variants  waiting, joined
  sizes     full width card, link in mono text-sm, truncated middle with full value in a copy button
  states    generating (skeleton), ready, copied (button shows check + "Copié", 2s), waiting for guest (pulsing dot + "En attente de votre interlocuteur"),
            guest joined (success dot, auto-advance to S07), expired (muted, "Nouveau lien" button), error (retry)
  tokens    bg surface, radius lg, shadow card; status dot success/warning
  a11y      status changes announced with aria-live=polite; copy result announced
  used on   S05
```

```
ShareSheet trigger
  variants  primary "Envoyer sur WhatsApp" (opens wa.me with prefilled text), "Autres apps" (navigator.share), "Copier le lien"
  states    default, unsupported (navigator.share missing -> falls back to copy), loading
  tokens    Button lg + secondary
  a11y      native share sheet is system UI; fallbacks announce result
  used on   S03 (folded into S05 in V1), S08, S09
```

```
PermissionPrompt   (Bandeau d'autorisation)
  variants  pre-prompt (before the browser asks), denied, in-app browser blocked
  states    ask (icon mic/camera, one line why, "Autoriser" button), requesting (loading), granted (auto-dismiss),
            denied (steps to re-enable for the detected browser), in-app-browser (WhatsApp/Instagram webview detected: "Ouvrir dans Chrome / Safari" + copy-link button + 3 numbered steps)
  tokens    card bg surface, radius lg; denied uses warning-soft / on-warning-soft
  a11y      role=region with heading; steps as an ordered list; focus moves to the card when it appears
  used on   S06, S10, S07 (mic lost mid-call)
```

```
GuestJoinCard
  variants  voice call, video call
  states    loading room, ready (host name, the two languages as chips, "Rejoindre l'appel" lg), joining, room full, link expired, link invalid, host left
  tokens    bg bg, card surface, radius lg; language chips primary-soft
  a11y      single primary action; page lang attribute set to the guest's language; works without JS errors on old Android WebView
  used on   S06
```

```
CallStage
  variants  video (remote video full, self preview 96x128 corner, draggable), voice (initials avatar 96px + name + speaking ring)
  states    connecting (avatar + "Connexion…"), live, reconnecting (dimmed + NetworkIndicator), remote muted (mic-off badge), ended
  tokens    bg call-stage, text on-call-stage, avatar ring primary while speaking
  a11y      speaking state is not announced (too chatty); connection changes are (aria-live=polite)
  used on   S07
```

```
CaptionStream   (container for CaptionBubble)
  variants  call (stage on top 40% / captions bottom 60% on phones; side by side >= md), transcript (static), face-to-face (split, see FaceToFaceSplit)
  states    empty ("Parlez, la traduction s'affiche ici"), live (auto-scroll pinned to bottom), scrolled-up (pinned off + "Nouveaux messages" pill to jump back), paused (call on hold)
  tokens    bg bg, gap space-3, padding space-4, max-w captions
  a11y      role=log with aria-live=polite announcing final translated lines only (not partials); user can turn announcements off
  used on   S07, S09, S10
```

```
CaptionBubble   (Bulle de sous-titre) - the hero
  variants  me (right aligned, caption-me bg, caption-me-accent label), other (left aligned, caption-other bg, caption-other-accent label)
  layout    speaker label text-xs/600 accent + time; original line text-caption-src muted; translated line text-caption-lg caption-*-text
  sizes     max width 92% on phones; text size from user setting (caption / caption-lg / caption-xl)
  states    partial (translated text at 70% opacity with a 3-dot typing mark, original updates live), final (full opacity, settle motion slow),
            corrected (final replaces partial without layout jump), error ("traduction indisponible", original kept), replaying (volume icon when tapped to replay voice)
  tokens    radius lg (4px on the corner toward the speaker side), padding space-3 space-4
  a11y      dir="auto" on each text line; lang attribute per line (lang_src / lang_dst); never colour alone: label says "Vous" / name
  used on   S07, S09, S10
```

```
CallControlBar   (Barre de contrôle d'appel)
  variants  voice (mic, speaker, keyboard, hang up), video (+ camera, flip camera)
  sizes     buttons call-btn 64, hang-up hangup-btn 72; labels text-xs under each
  states    on (call-control bg, on-call-stage icon), off/muted (on-call-stage bg, call-stage icon, slash icon), pressed, focus-visible, disabled (device missing)
  tokens    bar bg call-stage, safe-area padding; hangup bg hangup, on-hangup
  a11y      toggles use aria-pressed and change label ("Micro coupé"); hang-up asks no confirmation but is spaced 16px from neighbours; keyboard shortcuts on desktop (M mute, Esc does nothing)
  used on   S07
```

```
TypeToSpeakSheet
  variants  free text, quick replies chips ("Un instant", "Pouvez-vous répéter ?", "Je vous rappelle") written fresh
  states    closed, open, sending (chip shows loading), sent (appears as my CaptionBubble), error
  tokens    BottomSheet + TextField multiline + Chip
  a11y      focus goes to the field on open; Enter sends, Shift+Enter new line
  used on   S07
```

```
CreditMeter   (Compteur crédits / durée)
  variants  in-call pill (duration + minutes left), card (S14 balance), summary line (S08 used)
  states    normal (text), low (<= 3 min: warning icon + warning text, banner once), critical (<= 1 min: warning-soft banner with "Recharger" and a 60s countdown, no hard cut without warning), empty (call ends gracefully, S15 offered)
  tokens    text-timer tabular-nums; pill bg call-control on stage
  a11y      low and critical are announced once each (aria-live=assertive for critical); never announced every second
  used on   S07, S08, S14, S15
```

```
NetworkIndicator
  variants  pill on stage, strip under header
  states    good (hidden), weak (wifi-low icon + "Réseau faible", warning), reconnecting (spinner + "Reconnexion…"), offline (danger, "Hors ligne")
  tokens    warning / danger on warning-soft or call-control
  a11y      text label always; aria-live=polite on change
  used on   S07, S06, S05
```

```
HistoryCard   (Carte d'historique)
  variants  link call (voice / video), face-to-face
  layout    icon 40 in primary-soft circle, contact or "Appel" + date, language pair "FR -> EN", duration; trailing transcript icon button
  states    default, pressed, with transcript, without transcript (icon hidden), summary pending (sparkles + "Résumé en cours"), skeleton
  tokens    ListRow; radius lg when standalone
  a11y      whole row is one link; transcript button is a separate labelled control
  used on   S02
```

```
SummaryCard
  variants  summary, key points, actions
  states    generating (skeleton lines + "Résumé en cours"), ready, failed (retry), empty (call too short: "Appel trop court pour un résumé")
  tokens    bg surface, radius lg, heading text-lg, bullets text-base
  a11y      headings per section; copy and share buttons labelled
  used on   S08
```

```
TranscriptRow
  variants  me, other (CaptionBubble in static mode with timestamp)
  states    default, highlighted (search hit, primary-soft), selected for copy
  tokens    as CaptionBubble, size text-caption (one step smaller than live)
  a11y      plain reading order speaker -> time -> original -> translation; export as .txt
  used on   S09
```

```
FaceToFaceSplit
  variants  conversation (two halves, top half rotated 180deg for the person opposite), listen (single panel, captions only)
  states    idle ("Appuyez et parlez" on each half), listening (half's mic button pulses, primary ring), translating (partial), speaking (volume icon), error
  tokens    halves caption-other (top) / caption-me (bottom), text-caption-xl, mic button 72 primary
  a11y      each half is a region with its own label and lang; rotation done with transform so reading order stays logical
  used on   S10
```

```
PlanCard   (Carte de plan / pack)
  variants  subscription (monthly, annual), credit pack (4 sizes), "Le plus choisi" badge
  states    default, selected (2px primary border + primary-soft bg + check), disabled (unavailable in country), loading price
  layout    minutes first ("120 minutes"), price in local currency (FCFA / EUR), price per minute muted; no hidden prices
  tokens    bg bg, border border, radius lg
  a11y      radio group; price read in full ("9 900 francs CFA")
  used on   S01, S15
```

```
ListRow   (réglages)
  variants  navigation (chevron), toggle (Switch), value (trailing muted text), destructive (danger text)
  sizes     min 56px, text-base, icon 24 leading
  states    default, pressed (surface-2), focus-visible, disabled
  tokens    bg bg, divider border inset 56px
  a11y      one control per row; value rows read "label, value"
  used on   S14, S04 options, S13
```

```
BottomSheet / Dialog
  variants  sheet (phones), centred dialog (>= md), confirm dialog
  states    closed, opening (base motion), open, dragging (handle), closing
  tokens    bg bg, radius xl top, shadow pop, scrim rgba black 40%
  a11y      focus trap, Esc and scrim close, return focus to trigger, aria-modal, title as heading
  used on   S04 language list, S07 menu + Type-to-Speak, S15 confirm
```

```
Toast
  variants  success, error, info
  states    entering, visible (4s, 8s for errors with action), leaving; stacked max 2
  tokens    bg text (inverted: light theme dark toast), text bg; icon success / danger; radius md; shadow pop; above tab bar
  a11y      role=status (success/info), role=alert (error); never the only place an error is shown
  used on   all
```

```
Feedback states   (EmptyState, Skeleton, Banner, Chip, Badge)
  EmptyState  48px Lucide icon in primary-soft circle, text-lg title, text-sm muted line, one primary button (S02 "Aucun appel pour l'instant" + "Lancer un appel")
  Skeleton    surface-2 blocks, radius sm, shimmer off under reduced motion
  Banner      info (primary-soft), warning (warning-soft), danger (danger text on surface + left 4px bar); dismissible or not
  Chip        language codes, quick replies; 32px, radius pill, surface / primary-soft selected
  Badge       counts and "Nouveau"; text-xs/600, radius sm
  used on     all
```

```
OnboardingCarousel   (S01)
  variants  3 slides (lien, sous-titres, face-à-face) + plan step
  states    slide n of 3 (dots, current = primary), last slide shows PlanCards + "Essayer gratuitement" when a trial exists, without trial shows "Continuer gratuitement"
  tokens    text-display title, text-base body, own illustrations later (Lucide icon placeholders now)
  a11y      swipe + visible next/prev buttons; dots are buttons with "Étape 2 sur 3"; skip always visible
  used on   S01
```

## 4. Screen map (which components each screen needs)

| screen | components |
| --- | --- |
| S01 Onboarding / offre | OnboardingCarousel, PlanCard, Button |
| S02 Appels | AppHeader, Button lg "Nouvel appel", HistoryCard, EmptyState, Skeleton, TabBar |
| S03 Choix de l'app | folded into S05 in V1: ShareSheet trigger |
| S04 Langues et voix | LanguagePicker pair, SegmentedControl Vidéo/Voix, Switch x2, VoicePicker, Button lg |
| S05 Lien | LinkCard, ShareSheet trigger, NetworkIndicator |
| S06 Page invité | GuestJoinCard, PermissionPrompt, LanguagePicker single (guest can fix their language), NetworkIndicator |
| S07 Appel en cours | CallStage, CaptionStream, CaptionBubble, CallControlBar, CreditMeter, NetworkIndicator, TypeToSpeakSheet, BottomSheet menu, Banner |
| S08 Fin / résumé | CreditMeter summary, SummaryCard, Button, ShareSheet trigger |
| S09 Transcription | AppHeader, TranscriptRow, TextField search, ShareSheet trigger |
| S10 Face-à-face | FaceToFaceSplit, LanguagePicker pair, SegmentedControl, PermissionPrompt |
| S11 / S12 (V2) | not designed in V1; reuse ListRow, TextField, CaptionBubble |
| S13 Explorer (V2) | ListRow / tiles |
| S14 Compte | AppHeader large, CreditMeter card, ListRow, Switch, SegmentedControl (thème, taille des sous-titres) |
| S15 Recharge | PlanCard, Button, Toast, Banner |

## 5. Contrast

`python3 -I /root/.claude/skills/replica-design/contrast.py tokens.json`:
70 pairs (35 per theme), 0 failing AA, exit 0. Full output in
`contrast-report.txt`. Rule: after any palette change, rerun
`build_tokens.py` then the checker; fix in tokens, never per component.

Note: `call-control` (round button fill on the dark stage) is decorative; the
icon carries meaning and is checked (`on-call-stage` on `call-control`, 12:1).

## 6. Next

`/replica-build`: build these primitives once on a `/design` route in the app
(light and dark side by side, all states), screenshot it, then the S04 -> S05
-> S06 -> S07 slice.
