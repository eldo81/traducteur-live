# Recon map : AI Phone – Call & Voice Translator (iOS + Android, invité sur le web)

Scope : la traduction d'appel **par lien partagé** (le cœur payant) + le mode face-à-face + historique / transcription / résumé. La téléphonie classique (numéro virtuel, appels vers un vrai numéro) est notée mais reportée en V2.
For : usage perso (appels d'affaires Dioneo) puis produit à vendre (hypothèse « les deux », non confirmée).
Date : 2026-11-08
Méthode : sources publiques uniquement, lues par deux agents de recherche. Aucun compte, aucun code de l'app, aucune API privée. Les stores ont été lus via un outil de lecture de page ; aucune capture d'écran téléchargée.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | fiche App Store | https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251 | description, achats intégrés, 4,7/5 sur 83K notes, v3.43.3 |
| 2 | avis App Store | https://apps.apple.com/us/app/ai-phone-call-voice-translator/id6465173251?see-all=reviews | plaintes crédits, latence |
| 3 | fiche Google Play | https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=en_US | 1M+ téléchargements, 96K avis |
| 4 | site officiel | https://www.aiphone.ai/ | pitch, cibles |
| 5 | page WhatsApp | https://www.aiphone.ai/en/feature/whatsapp-video-call-translator/index | flux par lien |
| 6 | guide utilisateur | https://www.aiphone.ai/blog/?p=2611 | tous les flux, onglets |
| 7 | guide appel vidéo | https://www.aiphone.ai/blog/video-call-translation-setup/ | étapes, 1-à-1 seulement |
| 8 | FAQ | https://www.aiphone.ai/blog/faqs/ | dépannage navigateur WhatsApp |
| 9 | résumé produit | https://www.aiphone.ai/llms.txt | 150+ langues |
| 10 | conditions | https://www.aiphone.ai/tos | crédits, §3/§4 restrictions |
| 11 | confidentialité | https://www.aiphone.ai/pp | partage avec opérateurs télécom et « AI providers » |
| 12 | tarifs iOS / rang | https://apppricinglab.com/app/apple/6465173251 | prix des abonnements et packs |
| 13 | stats Android | https://appgoblin.info/apps/com.aiphone.secondphonenumber | ~1,5M installs, ~97K actifs/mois |
| 14 | estimations | https://screensdesign.com/discover/apps/ai-phone-phone-call-translate/ | ~250K $/mois iOS (estimation tierce) |
| 15 | analyse d'avis | https://kimola.com/reports/unlock-insights-with-ai-phone-app-customer-feedback-report-app-store-us-155491 | thèmes de plaintes |
| 16 | test concurrent | https://www.livelingo.io/guides/phone-call-translator-app | latence mesurée (auteur concurrent) |
| 17 | comparatif | https://bubblyphone.com/hub/phone-call-translator-apps-compared | synthèse avis |
| 18 | concurrent AI Call | https://1aicall.com/ | modèle lien quasi identique |
| 19 | concurrent Bridgecall | https://www.bridgecall.app/ | lien, navigateur d'abord |

## Core loop

L'hôte choisit deux langues, génère un lien d'appel, l'envoie par WhatsApp ; l'invité clique, sans installer ni créer de compte, et les deux se parlent chacun dans sa langue (voix traduite + sous-titres bilingues). C'est ça qui est payé.

Point clé : **l'appel ne passe pas dans WhatsApp**. WhatsApp ne transporte que le lien ; l'appel tourne dans la salle d'appel d'AI Phone (page web côté invité, WebRTC probable). L'éditeur l'écrit lui-même.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Onboarding / paywall | 1er lancement | présenter, vendre l'abonnement, essai | carrousel, liste des plans, CTA essai | essai dispo, pas d'essai |
| S02 | Onglet Appel (Call) | onglet 1 | point d'entrée, historique | bouton Appel vidéo, pavé numérique, liste d'historique avec icône transcription | vide, rempli |
| S03 | Choix de l'app de partage | S02 → icône Appel vidéo | choisir WhatsApp / WeChat / Autres | liste d'apps | — |
| S04 | Réglage langues et voix | S03 ou S11 | langue « Moi » / « Autre », voix de chaque côté, couper la voix originale | 2 sélecteurs de langue, menu voix (3 points), interrupteurs, choix Vidéo/Voix, bouton « Appeler » | défaut, langue récente |
| S05 | Lien généré / partage | S04 → Appeler | envoyer le lien | lien, bouton partager (feuille de partage système), copier | en attente de l'invité |
| S06 | Page invité (web) | invité ouvre le lien | rejoindre sans compte | autorisation micro/caméra, bouton rejoindre | navigateur WhatsApp qui échoue → « copiez le lien dans votre navigateur », lien expiré (supposé) |
| S07 | Appel en cours | les deux côtés | conversation traduite | vidéo / avatar, sous-titres bilingues défilants, couper micro, raccrocher, Type-to-Speak, réponses rapides | connexion, en appel, crédits épuisés → coupure, réseau faible |
| S08 | Fin d'appel / résumé | après raccroché | garder une trace | durée, crédits consommés, résumé IA, points clés, transcription, partager | résumé en cours, prêt |
| S09 | Détail transcription | S02 historique → icône | relire / exporter | transcription bilingue horodatée, partager, enregistrer en texte | — |
| S10 | Face-à-face | onglet 3 | traduire en présentiel | modes Écoute / Conversation, écran partagé (retourné pour l'autre), micro, bouton caméra, bouton T texte | écoute, parole, traduction |
| S11 | Pavé numérique (V2) | S02 → pavé | appeler un vrai numéro | pavé, choix du numéro appelant | sans numéro configuré |
| S12 | Boîte de réception (V2) | onglet 2 | SMS du 2e numéro | fils SMS, aide IA à la rédaction | vide |
| S13 | Explorer | onglet 4 | traduction audio/live, écran, historique | tuiles | — |
| S14 | Moi / Réglages | onglet 5 | compte, langue de l'app, numéros, aide | liste de réglages, solde de crédits, abonnement | gratuit, abonné |
| S15 | Boutique crédits | S07 crédits épuisés, S14 | recharger | 4 packs, abonnement | achat OK, échec |

## Flows

```
F01 Hôte lance un appel traduit par lien WhatsApp  (le cœur)
    S02 -> S03 -> S04 -> S05 -> (WhatsApp) -> S07 -> S08
    happy path clics : ~6 (onglet Appel, icône vidéo, WhatsApp, langues déjà réglées, Appeler, choisir le contact WhatsApp, envoyer)
    edge : invité ne clique pas ; navigateur intégré de WhatsApp bloque le micro ; crédits épuisés en plein appel (coupure observée dans les avis) ;
           bruit ambiant ; mauvaise langue choisie ; appel de groupe (non supporté)

F02 Invité rejoint depuis le lien
    (WhatsApp) -> S06 -> S07 -> fin
    happy path clics : 2 (ouvrir le lien, autoriser le micro)
    edge : iPhone + navigateur in-app ; refus du micro ; lien déjà utilisé ou expiré (supposé) ; 4G faible

F03 Conversation face-à-face
    S10 -> parler -> traduction affichée et prononcée
    happy path clics : 2
    edge : deux personnes parlent en même temps ; bruit

F04 Relire / partager une transcription
    S02 -> S09 -> partager
    happy path clics : 3

F05 Acheter abonnement / crédits
    S01 ou S15 -> paiement store -> retour
    edge : essai non proposé ; crédits non crédités ; remboursement refusé (plainte récurrente)

F06 (V2) Appel vers un vrai numéro
    S02 -> S11 -> S04 -> S07 -> S08
    edge : numéro marqué spam ; annonce d'introduction longue entendue par l'appelé
```

Chiffre à battre : **F01 en ~6 clics, F02 en 2 clics**.

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Barre d'onglets | 5 onglets | actif, inactif, badge | toutes |
| Bouton | primaire, secondaire, danger (raccrocher), icône | défaut, pressé, désactivé, chargement | toutes |
| Sélecteur de langue | « Moi », « Autre », inverser | fermé, liste avec recherche, récentes | S04, S10 |
| Sélecteur de voix | IA (plusieurs), ma voix | — | S04 |
| Interrupteur | — | on, off | S04, S14 |
| Feuille de partage | système | — | S05, S08, S09 |
| Bulle de sous-titre | moi / autre, original + traduction | en cours (partiel), final | S07, S09, S10 |
| Barre de contrôle d'appel | micro, caméra, haut-parleur, raccrocher, clavier Type-to-Speak | actif, coupé | S07 |
| Compteur crédits / durée | — | normal, faible, épuisé | S07, S08, S14 |
| Carte d'historique | appel vidéo, appel téléphone, face-à-face | avec / sans transcription | S02 |
| Carte de plan / pack | hebdo, mensuel, annuel, 4 packs | sélectionné | S01, S15 |
| Bandeau d'autorisation | micro, caméra | demandé, refusé | S06, S10 |
| Toast | succès, erreur | — | toutes |

## Inferred data model

```
User         id, email|phone, app_language, plan (free|weekly|monthly|annual), plan_renews_at, credits_balance, created_at
             evidence : S01, S14, S15, ToS crédits ; confidence : high

CallRoom     id, host_user_id, link_token, mode (video|voice), host_lang, guest_lang, host_voice, guest_voice,
             mute_original_host, mute_original_guest, status (waiting|live|ended|expired), created_at, started_at, ended_at
             evidence : S04, S05, guide appel vidéo ; confidence : high (champs), guess (expiration)

Participant  id, room_id, role (host|guest), user_id (null pour invité), display_name, joined_at, left_at, user_agent
             evidence : invité sans compte, S06 ; confidence : medium

Utterance    id, room_id, speaker_role, lang_src, text_src, lang_dst, text_dst, started_at, ended_at, is_final
             evidence : sous-titres bilingues, transcription S09 ; confidence : high

CallSummary  id, room_id, summary, key_points (json), created_at
             evidence : « AI Call Summary », points clés ; confidence : high

CreditLedger id, user_id, delta, reason (purchase|subscription_grant|call_minute|face_minute|refund), room_id, created_at
             evidence : ToS « 1 minute = tarif de base + 5 crédits », face-à-face 2 crédits/min ; confidence : medium

Purchase     id, user_id, store (apple|google|web), product_id, amount, currency, status, created_at
             evidence : achats intégrés listés ; confidence : high

PhoneNumber  (V2) id, user_id, e164, type (own_verified|virtual), country, changed_at
             evidence : guide, « Manage My Numbers » ; confidence : high
```

Relations : User 1-n CallRoom ; CallRoom 1-2 Participant ; CallRoom 1-n Utterance ; CallRoom 0-1 CallSummary ; User 1-n CreditLedger ; User 1-n Purchase ; User 0-n PhoneNumber.

## Ce qui se passe techniquement (déduit, à valider par /replica-architect)

- Côté invité : page web, appel audio/vidéo dans le navigateur (WebRTC très probable : la FAQ conseille de rouvrir le lien hors du navigateur de WhatsApp).
- Traduction voix → voix + sous-titres des deux côtés. Moteur non nommé (« AI providers »). Plaintes « voix robotique » et sensibilité au bruit : compatible avec une chaîne transcription → traduction → synthèse vocale.
- Latence : de « à peine perceptible » à « plusieurs secondes » selon les avis. Aucun chiffre de l'éditeur.
- Facturation : par minute = coût télécom (si téléphone) + coût IA (5 crédits).
- Votre dépôt `traducteur-live` utilise déjà OpenAI Realtime en WebRTC navigateur : c'est exactement la brique voix→voix nécessaire, réutilisable comme référence technique.

## Feature matrix

Voir `features.csv`. Must : 16, should : 10, could : 8, skip : 4.

## Out of scope (cannot or should not be cloned)

- **Traduire à l'intérieur d'un vrai appel WhatsApp** : impossible, AI Phone ne le fait pas non plus. Le clone fera comme lui : lien → salle d'appel propre.
- **Le nom « AI Phone », le logo, les textes, captures, voix propriétaires** : jamais repris. `/replica-brand` donnera un nom à vous.
- **La base de 4M d'utilisateurs, les notes des stores, l'intégration TransAI earbuds** (partenariat matériel).
- **Numéros américains virtuels** : possible techniquement (fournisseur télécom), mais licences, KYC, coûts et risque spam. Reporté en V2, et pas un numéro US pour un public Afrique/Europe.
- **CGU d'AI Phone (§3, §4)** : interdisent la décompilation et l'usage commercial d'un compte. Donc pas d'abonnement payant utilisé pour benchmarker à des fins commerciales ; on reste sur les sources publiques.

## Ce que les utilisateurs détestent (matière pour /replica-entrepreneur)

1. Abonnement **+** crédits : « I paid for a subscription and they still ask me to buy credits. »
2. Coupure quand les crédits tombent à zéro en plein appel.
3. Prix opaques, visibles seulement après achat ; pas de vrai support (« As for support, there is none »).
4. Latence de plusieurs secondes et voix robotique.
5. Numéro virtuel marqué spam, ne reçoit pas les SMS de vérification.
6. Le lien dans WhatsApp « clunky » ; le navigateur intégré de WhatsApp casse parfois le micro.

## Size

Screens 15 (10 en V1), flows 6 (5 en V1), entities 8 (7 en V1).
Parties dures :
1. **Temps réel voix → voix bidirectionnel à faible latence** entre deux navigateurs (WebRTC + moteur de traduction temps réel, anti-écho, tours de parole).
2. **Page invité robuste** dans le navigateur intégré de WhatsApp (iOS surtout) : autorisations micro, repli « ouvrir dans Chrome/Safari ».
3. **Facturation à la minute** côté serveur (compteur fiable, coupure propre, pas de clé API exposée au navigateur), plus paiements stores ou web.

Taille : **M** (quelques semaines) pour la V1 web : PWA hôte + page invité + traduction + historique + crédits. **L** si on ajoute apps natives stores et téléphonie (V2).
