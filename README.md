# Traducteur Live — interprète vocal EN ⇄ FR

Application web (PWA) d'interprétation simultanée anglais ↔ français pour les appels WhatsApp, Zoom, Teams ou Meet. Elle tourne sur un **2ᵉ appareil** posé à côté du haut-parleur du téléphone d'appel : Android empêche une app de capter l'audio d'un appel en cours sur le même téléphone.

Moteur : **OpenAI Realtime API en WebRTC** (audio → audio en direct, sans serveur intermédiaire). Code HTML/CSS/JS vanilla, aucun build.

| Mode | Ce que l'app fait |
|---|---|
| **Écoute** (EN → FR) | Capte l'interlocuteur et affiche les sous-titres français en gros. Lecture vocale FR en option (pour des écouteurs). |
| **Parle** (FR → EN) | Vous parlez français, l'app **prononce** la traduction anglaise à voix haute ; le téléphone d'appel la transmet. |
| **Auto** | Détecte la langue de chaque phrase et traduit dans l'autre sens. L'anglais est toujours prononcé ; le français seulement si l'option « Lire la traduction française » est activée. |
| **Anti-écho** | Le micro est coupé pendant que l'app parle (half-duplex), pour qu'elle ne retraduise pas sa propre voix. |

---

## 1. Activer GitHub Pages

1. Sur GitHub, ouvrez le dépôt `traducteur-live` → **Settings** → **Pages**.
2. **Source** : *Deploy from a branch*.
3. **Branch** : `main`, dossier **`/ (root)`** → **Save**.
4. Après 1 à 2 minutes, l'URL apparaît en haut de la page :
   `https://eldo81.github.io/traducteur-live/`

Le HTTPS est obligatoire pour le micro : GitHub Pages le fournit d'office.

> Dépôt privé : GitHub Pages sur un dépôt privé exige un compte GitHub Pro. Sinon, passez le dépôt en public. Aucun secret n'est dans le code : la clé API reste uniquement dans votre navigateur.

## 2. Créer la clé API OpenAI et plafonner le budget

1. Allez sur **platform.openai.com** → connectez-vous.
2. **Settings → Billing** : ajoutez un moyen de paiement et créditez le compte (ex. 10 $). Mettez **Auto recharge sur OFF** : la dépense ne pourra pas dépasser le crédit.
3. **Settings → Limits** (*Usage limits*) : fixez un **budget mensuel** (ex. 20 $) et un seuil d'alerte e-mail (ex. 10 $).
4. Créez un **projet dédié** (*Projects → Create project*, ex. « traducteur »). Dans ce projet, réglez aussi une limite de budget.
5. **API keys → Create new secret key**, choisissez ce projet. Dans *Permissions*, choisissez **Restricted** et n'activez que **Realtime** (écriture) et **Models** (lecture) ; si l'app renvoie une erreur 401/403, repassez sur *All*.
6. Copiez la clé (`sk-proj-…`). Elle ne s'affiche qu'une fois.

**Coûts indicatifs** (estimations, à vérifier sur la page *Pricing* d'OpenAI) :

| Modèle | Ordre de grandeur |
|---|---|
| `gpt-realtime` | ~0,05 à 0,15 $ par minute d'appel traduit |
| `gpt-realtime-mini` | ~3× moins cher, qualité un peu inférieure sur les termes techniques |

Le compteur de tokens en haut de l'historique (`in · out · min`) suit la consommation de la session. L'app ne garde que les 10 derniers éléments de contexte côté serveur, ce qui empêche le coût par phrase de grimper sur un long appel.

**Sécurité de la clé** : elle est stockée dans le `localStorage` du navigateur et n'est envoyée qu'à `api.openai.com`. Ne prêtez pas l'appareil déverrouillé. En cas de perte de l'appareil, révoquez la clé sur platform.openai.com → API keys.

## 3. Installer l'app sur le téléphone (Android)

1. Sur le 2ᵉ appareil, ouvrez **Chrome** → `https://eldo81.github.io/traducteur-live/`.
2. Menu **⋮** → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
3. Lancez l'app depuis l'icône **EN/FR**.
4. Au premier lancement, l'écran **Réglages** s'ouvre : collez la clé API, cliquez sur **Tester la clé** puis **Enregistrer**.
5. À la première pression sur un mode, autorisez l'accès au **micro**.

Sur iPhone ou iPad : Safari → Partager → *Sur l'écran d'accueil*. Sur PC : Chrome ou Edge, icône d'installation dans la barre d'adresse.

## 4. Mode d'emploi pendant un appel

**Installation physique**
- Téléphone d'appel : **haut-parleur activé**, volume aux ¾.
- Appareil traducteur posé **à 10–30 cm** du haut-parleur, micro tourné vers lui.
- Pièce calme. Évitez la ventilation et les bruits de clavier.

**Pendant l'appel**
1. Votre interlocuteur parle anglais → appuyez sur **Écoute** et lisez les sous-titres français.
2. Pour répondre → appuyez sur **Parle**, dites une phrase en français, puis **faites une pause d'environ une demi-seconde**. L'app la prononce en anglais ; le téléphone d'appel la transmet. Le micro de l'app est coupé pendant qu'elle parle (voyant rouge).
3. Pour une conversation fluide sans toucher l'écran → **Auto**.
4. Le passage d'un mode à l'autre est instantané, sans reconnexion.
5. Fin d'appel → **Stop** (coupe le micro, la connexion et la facturation), puis **Exporter .txt** pour archiver l'échange.

**Conseils pour réduire la latence et les erreurs**
- Phrases courtes, une idée par phrase. Marquez une pause nette entre deux phrases.
- Annoncez les chiffres clairement : « deux cent mille dollars, FOB Dakar ».
- Si l'app coupe vos phrases trop tôt : Réglages → Réactivité → **Standard** ou **Sémantique**.
- Si l'app retraduit sa propre voix : éloignez un peu l'appareil, baissez le volume de l'app et vérifiez que l'option **Anti-écho** est cochée.
- Avec des **écouteurs** sur l'appareil traducteur : cochez « Lire la traduction française » et décochez **Anti-écho** pour ne plus couper le micro.
- Commencez avec `gpt-realtime-mini` pour les appels courants. Passez sur `gpt-realtime` pour une négociation à fort enjeu.

**Indicateurs**
- Pastille verte : connecté. Jaune clignotante : connexion en cours. Rouge : erreur (le message s'affiche en bas).
- Icône micro : jauge verte = niveau capté, rouge = micro coupé (l'app parle).
- L'écran reste allumé tant qu'un mode est actif (Wake Lock).

## 5. Réglages disponibles

| Réglage | Effet |
|---|---|
| Clé API | Stockée localement, testable (liste les modèles realtime accessibles). |
| Modèle | `gpt-realtime`, `gpt-realtime-mini`, `gpt-realtime-2` ou un nom personnalisé. |
| Voix / vitesse | Voix de la traduction prononcée. Appliquées à la prochaine connexion (Stop puis relancer). |
| Taille du texte | 18 à 64 px pour les sous-titres. |
| Réactivité | Durée de silence qui déclenche la traduction d'un segment : 350 ms, 600 ms ou détection sémantique. |
| Transcription | Affiche le texte original. Désactivable pour économiser. |
| Lecture FR | Lit à voix haute la traduction française (Écoute et Auto). |
| Anti-écho | Coupe le micro pendant que l'app parle. |

## 6. Structure du dépôt

```
index.html      Interface (3 modes, Stop, historique, réglages)
style.css       Thème sombre, mobile d'abord
app.js          Moteur : WebRTC Realtime, modes, anti-écho, historique, export, Wake Lock
sw.js           Service worker (cache de l'interface ; l'API n'est jamais mise en cache)
manifest.json   Manifeste PWA (installable)
icons/          Icônes de l'application
.nojekyll       Désactive le traitement Jekyll de GitHub Pages
```

Après une modification du code, incrémentez `VERSION` dans `sw.js` pour que les appareils déjà installés récupèrent la nouvelle version.

## 7. Dépannage

| Symptôme | Solution |
|---|---|
| « Clé API refusée (401) » | Clé erronée ou révoquée, ou permissions *Restricted* trop limitées → passez la clé sur *All*. |
| « HTTP 404 / model not found » | Le modèle choisi n'est pas accessible avec votre compte. Testez la clé pour voir la liste, ou choisissez `gpt-realtime`. |
| « HTTP 429 » | Crédit épuisé ou limite de budget atteinte → Billing. |
| Pas de son en mode Parle | Volume média de l'appareil traducteur, mode silencieux, ou Bluetooth connecté ailleurs. |
| Le micro ne démarre pas | Autorisez le micro : Chrome → ⋮ → Paramètres → Paramètres des sites → Micro. |
| L'app traduit dans la mauvaise langue | En Écoute ou Parle, la langue est forcée. En Auto, parlez une phrase complète avant de faire une pause. |
| L'écran s'éteint | Le Wake Lock exige que l'app reste au premier plan. Sinon, augmentez la mise en veille Android. |

## Technique (résumé)

1. `getUserMedia` avec annulation d'écho, réduction de bruit et contrôle de gain du navigateur, plus la réduction de bruit `far_field` d'OpenAI.
2. `POST /v1/realtime/client_secrets` (clé API) → clé éphémère avec la configuration de session (instructions d'interprète, VAD, transcription, voix).
3. `RTCPeerConnection` + data channel `oai-events`. L'offre SDP part vers `POST /v1/realtime/calls` (clé éphémère). En secours, envoi multipart `sdp` + `session` avec la clé API.
4. VAD serveur avec `silence_duration_ms` de 350 ms par défaut : chaque segment court est traduit sans attendre la fin des longues phrases.
5. Anti-écho : les événements WebRTC `output_audio_buffer.started` / `stopped` coupent puis rétablissent la piste micro (`track.enabled`), avec une traîne de 300 ms et une sécurité de 45 s.
6. En mode Écoute sans voix, la sortie est en texte seul (`output_modalities: ["text"]`) : c'est plus rapide et moins cher.
