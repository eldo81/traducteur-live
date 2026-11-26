# Clavier IA — clavier Android façon iPhone, avec IA intégrée

Clavier système Android (remplace Gboard / Samsung) : rendu et sensations du clavier iPhone récent, plus une barre IA.

## Télécharger

APK prêt à installer (Android 8 et plus) : **Releases → « Clavier IA — dernière version » → `ClavierIA.apk`**
`https://github.com/eldo81/traducteur-live/releases/tag/clavier-ia-latest`

Chaque push sur `android-keyboard/` recompile l'APK (GitHub Actions, workflow `clavier-ia.yml`) et met à jour ce téléchargement. La signature est fixe : une nouvelle version s'installe par-dessus l'ancienne sans perdre les réglages.

## Installer (2 minutes)

1. Sur le téléphone : ouvrez le lien ci-dessus → `ClavierIA.apk` → Ouvrir. Autorisez « Installer des applis inconnues » pour Chrome si Android le demande.
2. Ouvrez l'app **Clavier IA** → **Activer** (cochez Clavier IA) → **Choisir Clavier IA**.
3. Collez votre clé OpenAI → **Enregistrer et tester**. Le meilleur modèle « mini » de votre compte est choisi automatiquement.
4. **Autoriser le micro** pour la dictée vocale.

## Ce que fait le clavier

| Côté frappe (comme sur iPhone) | Côté IA (barre du haut) |
|---|---|
| AZERTY iOS (avec ’), QWERTY anglais, pages 123 / #+= | **✦ IA** : consigne libre → texte prêt à envoyer ; « Répondre au message copié », « Plus court », « En e-mail pro »… |
| Bulle d'aperçu en goutte, validation au relâchement, glisser pour corriger la touche | **Corriger** : orthographe, grammaire, accents, sans reformuler |
| Frappe rapide à plusieurs doigts (rollover) | **Reformuler** : 8 tons (pro, amical, concis, formel, persuasif, diplomate…) |
| Zone de frappe intelligente : entre deux lettres, la plus probable l'emporte | **Résumer** : court, points clés, 1 phrase, actions à faire |
| Correction automatique, annulable par ⌫ ; suggestions « tapé » / meilleur / suivant | **Traduire** : 15 langues dont wolof, arabe, néerlandais ; traduction en direct pendant la frappe, ↵ pour insérer |
| Prédiction du mot suivant, apprise de vos habitudes (bilingue FR + EN) | **Dictée vocale** FR / EN |
| Appui long : accents ; trackpad sur la barre d'espace ; double espace → point ; double ⇧ → majuscules | **Presse-papiers** : 30 derniers éléments |
| Retour haptique réglable (léger / moyen / fort), son optionnel | 5 thèmes : iPhone clair, iPhone sombre, Néon, Océan, Améthyste |

Les fonctions IA agissent sur la **sélection**, sinon sur **tout le champ**. Elles sont désactivées dans les champs de mot de passe.

## Coûts et confidentialité

- Texte envoyé à `api.openai.com` **uniquement** quand vous touchez un bouton IA. Le reste (frappe, dictionnaire appris, presse-papiers) reste sur le téléphone.
- Coût typique : moins de 0,001 $ par correction ou traduction avec un modèle « mini ». Mettez un crédit prépayé et désactivez la recharge automatique pour plafonner la dépense.
- La dictée utilise le service vocal du téléphone (Google), pas OpenAI.

## Limites connues

- Android affiche pour tout clavier tiers un avertissement standard sur la collecte du texte saisi.
- Le keystore de signature est dans le dépôt (pratique pour une installation directe). Pour une publication sur le Play Store, créez une clé privée et passez-la en secret GitHub.
- Correction automatique : dictionnaire de 49 000 mots français et 30 000 mots anglais classés par fréquence, enrichi de vos propres mots. Elle corrige les accents manquants, la touche voisine, les lettres inversées et la lettre oubliée ; la grammaire passe par le bouton IA « Corriger ».

## Code

`app/src/main/java/com/dioneo/clavieria/` — Kotlin, sans aucune bibliothèque tierce :
`KeyboardView` (dessin et tactile), `ClavierService` (clavier système, panneaux IA, dictée, emojis, presse-papiers), `Dictionary` (suggestions, correction, prédiction), `AiClient` + `Prompts` (OpenAI), `SettingsActivity` (installation et réglages).

## Crédits

Listes de fréquence des mots : projet [FrequencyWords](https://github.com/hermitdave/FrequencyWords) de Hermit Dave (contenu sous licence CC BY-SA 4.0), nettoyées des fautes courantes et complétées de vocabulaire commerce / logistique.
