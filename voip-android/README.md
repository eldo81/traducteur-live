# Dioneo Call — app Android d'appels VoIP vers fixes et mobiles (Belgique + monde)

Application Android native (Kotlin + Jetpack Compose) qui passe des appels **SIP/RTP** vers n'importe quel fixe ou mobile via un **opérateur SIP wholesale** (Telnyx, Zadarma, ou votre propre PBX). Vous payez le prix de gros de l'opérateur, sans la marge d'une app grand public.

## Ce que fait l'app

| Écran | Fonctions |
|---|---|
| **Clavier** | Choix du pays (BE par défaut, favoris SN/FR/NL/LU/CI/MA…), saisie libre `0470…`, `+221…`, `00…`, sélecteur de contacts, détection **mobile/fixe** (libphonenumber Google), tarif/minute affiché avant d'appeler |
| **Appel** | Muet, haut-parleur / Bluetooth, mise en attente, clavier DTMF (serveurs vocaux, codes banque), durée + **coût estimé en direct**, capteur de proximité, écran verrouillé |
| **Historique** | Journal des appels, rappel en un tap, **coût total estimé** |
| **Tarifs** | Grille par préfixe (324 = mobiles belges, 2217 = mobiles sénégalais…), modifiable, devise réglable |
| **Compte** | Préréglages Telnyx / Zadarma / PBX perso, TLS, SRTP, STUN, format du numéro (+E164 / E164 / 00) |

Bonus : l'app s'enregistre pour les liens `tel:` → depuis l'app Contacts, « Appeler avec Dioneo Call ».

**Stack technique** : Linphone SDK 5.3 (SIP, Opus/G.711/G.722, TLS, SRTP, jitter buffer, annulation d'écho), service de premier plan « micro » pour tenir l'appel écran éteint, identifiants chiffrés (Android Keystore).

## 1. Installer l'APK

Chaque push sur `voip-android/` déclenche GitHub Actions, qui compile l'APK et le publie en **pré-release** :
`https://github.com/eldo81/traducteur-live/releases`

Sur le téléphone : ouvrir le lien → `DioneoCall-1.0.X.apk` → autoriser l'installation depuis le navigateur. Android 8.0 minimum.

> L'APK est signé avec la clé de debug : suffisant pour vous et votre équipe. Pour le Play Store, il faut une clé de release (voir §5).

## 2. Ouvrir le compte opérateur (le vrai levier de coût)

### Option A — Telnyx (recommandé : TLS + SRTP, facturation à la seconde, API)
1. Créer un compte sur telnyx.com, valider l'identité (KYC), créditer 20 $.
2. **Voice → Outbound Voice Profiles** → créer un profil, cocher les destinations : Belgique, France, Sénégal, etc. (tout ce qui n'est pas coché est refusé = protection contre la fraude).
3. **Voice → SIP Trunking → Create SIP Connection** → type **Credentials** → noter *username* + *password*. Associer l'Outbound Voice Profile.
4. Onglet Inbound/Outbound de la connexion : activer SRTP si vous voulez la voix chiffrée.
5. Acheter un numéro (DID) belge ou autre et l'assigner comme **Caller ID**. Sans numéro valide présenté, beaucoup d'opérateurs mobiles rejettent ou marquent l'appel en spam.
6. Dans l'app → **Compte** → Telnyx → identifiant + mot de passe → « Enregistrer et se connecter ».

### Option B — Zadarma (le plus simple, prépayé, interface en français)
1. Compte sur zadarma.com, recharger.
2. **Paramètres → Numéros SIP** : récupérer l'identifiant à 6 chiffres et le mot de passe.
3. Dans l'app → **Compte** → Zadarma.

### Option C — Votre PBX (Asterisk / FreeSWITCH / FusionPBX)
Pour un service multi-utilisateurs : le PBX fait le **routage au moindre coût (LCR)** entre plusieurs trunks (ex. Telnyx pour l'Europe, un transitaire Afrique de l'Ouest pour le Sénégal) et la facturation par utilisateur.

## 3. Coûts réels — ce qu'il faut savoir

| Destination | Grand public (apps VoIP) | Wholesale SIP (ordre de grandeur) |
|---|---|---|
| Belgique fixe | 0,02 – 0,05 €/min | 0,01 – 0,02 €/min |
| Belgique mobile | 0,10 – 0,20 €/min | 0,03 – 0,08 €/min* |
| France mobile | 0,05 – 0,10 €/min | 0,01 – 0,03 €/min |
| Sénégal mobile | 0,20 – 0,35 €/min | 0,15 – 0,30 €/min |

\* **Piège majeur (surcharge « non-EEE »)** : les opérateurs mobiles belges et européens facturent beaucoup plus cher la terminaison d'un appel qui **arrive de l'extérieur de l'UE/EEE**. Exemple publié par Twilio pour la Belgique mobile : **0,5576 $/min** en origine hors EEE contre **0,0387 $/min** en origine EEE. Avec un DID belge/européen en caller ID et une connexion SIP sortant par l'Europe, vous payez le tarif EEE. Vérifiez cette ligne dans la grille de votre opérateur avant de lancer du volume.

Les tarifs pré-remplis dans l'onglet **Tarifs** sont **indicatifs** : remplacez-les par la grille de votre opérateur (Telnyx → Pricing → Elastic SIP ; Zadarma → Tarifs). Seul l'opérateur facture.

**Données mobiles** : ~30-40 kB/s par sens en G.711, ~10-15 kB/s en Opus. 10 min ≈ 25-50 Mo.

## 4. Dépannage

| Symptôme | Cause | Correction |
|---|---|---|
| « identifiants SIP incorrects » | User/mot de passe ou Auth ID | Recopier depuis le portail ; Telnyx : connexion de type *Credentials* |
| « refusé par l'opérateur » (403) | Destination non autorisée / crédit / caller ID | Cocher le pays dans l'Outbound Voice Profile, recharger, assigner un DID |
| « codec/chiffrement refusé » (488) | SRTP non activé côté opérateur | Désactiver SRTP dans l'app ou l'activer côté opérateur |
| Appel connecté mais pas de son | NAT / 4G | Laisser STUN activé ; essayer TCP ou TLS au lieu d'UDP |
| Connexion impossible en wifi d'entreprise/hôtel | Port 5060 bloqué | TLS (5061) passe mieux |

## 5. Limites connues et prochaines étapes

- **Appels entrants** : reçus uniquement quand l'app est ouverte ou récente. Pour sonner app fermée, il faut un push (FCM) côté serveur SIP (Flexisip ou PBX avec push). L'app est pensée pour l'appel **sortant**.
- **Licence Linphone SDK : AGPLv3.** Usage interne ou app open source : OK. Pour distribuer une app commerciale fermée (Play Store, revente), il faut la **licence commerciale de Belledonne Communications**, ou basculer le moteur sur PJSIP (GPL/commerciale) ou le SDK WebRTC Telnyx (MIT). Le moteur est isolé dans `Sip.kt` pour faciliter ce changement.
- **Monétisation (revente de minutes)** : nécessite un backend (comptes clients, crédit prépayé, paiement Wave / Orange Money / Stripe, CDR) et un PBX multi-tenant. En Belgique, revendre de la téléphonie au public = notification à l'**IBPT** (opérateur de communications électroniques). Au Sénégal, l'**ARTP** encadre la VoIP vers le réseau public.
- **Play Store** : générer un keystore de release, le stocker en secret GitHub, et l'ajouter au workflow.

## Structure

```
voip-android/
├── app/src/main/java/com/dioneo/call/
│   ├── Sip.kt          moteur Linphone : compte, appels, audio, erreurs SIP traduites
│   ├── Config.kt       opérateurs, format numéro, tarifs, stockage chiffré
│   ├── Phone.kt        parsing international (libphonenumber), pays, drapeaux
│   ├── MainActivity.kt clavier, historique, tarifs, compte
│   ├── CallActivity.kt écran d'appel
│   ├── CallService.kt  service premier plan + notification « Raccrocher »
│   └── App.kt
└── .github/workflows/voip-android.yml (à la racine du dépôt) → APK en pré-release
```

Build local : Android Studio (Ladybug ou plus récent) → ouvrir `voip-android/` → Run.
