# Architecture : nom provisoire « Lien Interprète » (reconstruction des fonctions cœur d'AI Phone)

Nom provisoire uniquement, en attendant `/replica-brand`. V1 = web : application installable côté hôte (PWA) + page web côté invité. Apps stores en V2.

## Le choix qui structure tout : où tourne la traduction

| option | principe | verdict |
| --- | --- | --- |
| A. Dans chaque navigateur | chaque participant ouvre sa propre session OpenAI Realtime (jeton éphémère) et envoie l'audio traduit à l'autre | rejeté : l'invité doit tenir 2 connexions WebRTC dans le navigateur intégré de WhatsApp ; facturation contournable côté client ; impossible de couper proprement à solde nul |
| **B. Agent serveur dans la salle** | les deux navigateurs rejoignent une salle audio/vidéo ; un agent serveur écoute chaque piste, traduit, republie la voix traduite pour l'autre et diffuse les sous-titres | **retenu** : l'invité n'a qu'une connexion ; clé API jamais dans un navigateur ; minutes comptées et coupées côté serveur ; transcription écrite en base par le serveur |

## Stack

| layer | choice | why |
| --- | --- | --- |
| web (hôte + invité) | Next.js (App Router) + TypeScript | une seule app : pages hôte, page invité `/j/[token]`, routes API |
| styling | Tailwind + tokens de `/replica-design` | rapide, cohérent |
| salle temps réel | **LiveKit Cloud** (SFU WebRTC managé) | gère NAT/TURN, 4G faible, mobile ; SDK web léger pour l'invité ; offre gratuite pour démarrer |
| agent de traduction | **LiveKit Agents (Python)** sur **Fly.io** | worker qui rejoint chaque salle ; plugin OpenAI Realtime prêt à l'emploi |
| moteur de traduction | **OpenAI Realtime** : `gpt-realtime-2` (qualité) / `gpt-realtime-2.1-mini` (économique) | déjà éprouvé dans `traducteur-live` ; voix → voix + texte en un seul modèle, latence la plus basse |
| résumé d'appel | modèle texte OpenAI, appelé par l'agent en fin d'appel | une requête par appel |
| database | Postgres sur **Supabase** | une seule base ; RLS ; auth incluse |
| auth | **Supabase Auth** (lien magique email + Google) | pas de mot de passe à gérer |
| payments | **Stripe Checkout** (packs prépayés, paiement unique) via une entité UE ; **PayDunya ou CinetPay** pour Wave / Orange Money en Afrique de l'Ouest | Stripe n'ouvre pas de compte marchand à une société sénégalaise : il faut une entité UE (Belgique/France) ou un prestataire local. Abstraction `PaymentProvider`, table `purchases.provider` |
| email | Resend | emails de connexion et reçus |
| jobs | Vercel Cron | expiration des liens, ménage |
| hosting | Vercel (web) + Fly.io (agent, région `cdg` Paris, la plus proche de Dakar et du Benelux) | managé, pas cher à zéro utilisateur |

Pas de microservices : 1 app web, 1 worker, 1 base.

## Comment se déroule un appel (flux F01 + F02)

```
Hôte (PWA)                        Serveur Next.js            LiveKit Cloud            Agent (Fly.io)            OpenAI Realtime
  | POST /api/rooms ------------->| crée call_rooms, token    |                         |                         |
  |<-------- lien https://.../j/TOKEN                          |                         |                         |
  | partage WhatsApp (navigator.share)                         |                         |                         |
  | GET /api/rooms/:id/token ---->| vérifie solde > 0, jeton LiveKit hôte                |                         |
  | rejoint la salle ------------------------------------------>|                         |                         |
Invité clique le lien /j/TOKEN                                 |                         |                         |
  | POST /api/join/TOKEN -------->| salle valide ? jeton LiveKit invité, dispatch agent ->| rejoint la salle         |
  | rejoint la salle ------------------------------------------>|<------------------------| 2 sessions Realtime :    |
  |                                                             | piste hôte ------------>| FR→EN ----------------->|
  |                                                             | piste invité ---------->| EN→FR ----------------->|
  |                                                             |<-- voix traduite + sous-titres (data) ------------|
  |                                         toutes les 15 s : debit_call_tick() ; si -1 → message « solde épuisé » 30 s avant, puis fin propre
  | raccroche ---------------------------------------------------------------------------> agent écrit utterances, résumé, ended
```

Chaque participant entend la voix traduite de l'autre ; la voix originale est coupée par défaut (option `mute_original_*`), ou laissée en fond à faible volume.

## Schema

Tables : 7 (+ 1 vue). Accès : **RLS Supabase**. Le navigateur lit ses propres données ; il n'écrit que son profil et la création de salle. Statut d'appel, minutes, transcriptions, résumés et achats sont écrits uniquement par le serveur (clé `service_role`, jamais envoyée au client). Les invités n'ont pas de compte et ne touchent jamais la base.

Voir `schema.sql`, **testé sur Postgres 16** : création, cadeau de bienvenue 180 s, débit par tranche, rejeu d'une tranche non refacturé, refus à solde insuffisant.

| table | rôle |
| --- | --- |
| profiles | préférences (langues, voix, seuil d'alerte solde) |
| call_rooms | le lien partagé et l'état de l'appel ; 1 appel actif max par hôte |
| participants | hôte + 1 invité (pas de groupe, comme l'original) ; détecte le navigateur intégré WhatsApp |
| utterances | sous-titres / transcription bilingue horodatée |
| call_summaries | résumé IA + points clés |
| purchases | packs achetés ; `unique(provider, provider_ref)` contre les webhooks en double |
| credit_ledger | grand livre en secondes ; le solde = la somme ; `unique(room_id, tick)` contre la double facturation |

Choix produit inscrit dans le schéma : **des minutes prépayées, pas d'abonnement + crédits** (plainte n°1 sur AI Phone), et une alerte avant épuisement (pas de coupure sèche).

## API

### F01 Hôte lance un appel par lien

| method path | does | who | input | output |
| --- | --- | --- | --- | --- |
| POST /api/rooms | crée la salle, génère `link_token` (crypto, 24 car.) | hôte connecté | `mode, host_lang, guest_lang, voices, mute_*` | `{room_id, url}` |
| GET /api/rooms/:id/token | jeton LiveKit de l'hôte, refuse si solde < 30 s | hôte propriétaire | — | `{livekit_url, token}` ou 402 |
| POST /api/rooms/:id/end | termine l'appel | hôte propriétaire | — | `{billed_seconds}` |

### F02 Invité rejoint

| method path | does | who | input | output |
| --- | --- | --- | --- | --- |
| GET /j/:token | page invité (détecte WhatsApp in-app, affiche « Ouvrir dans Chrome/Safari » si besoin) | public | — | HTML |
| POST /api/join/:token | vérifie salle `waiting`/`live` et non expirée, crée participant, jeton LiveKit invité, déclenche l'agent | public, limité 10 req/min/IP | `display_name?` | `{livekit_url, token, langs}` ou 410 expiré |

### F04 Historique / transcription

| method path | does | who |
| --- | --- | --- |
| GET (Supabase, RLS) call_rooms, utterances, call_summaries | listes et détail | hôte |
| GET /api/rooms/:id/transcript.txt | export texte | hôte propriétaire |
| DELETE (Supabase, RLS) utterances / call_summaries | effacer (RGPD) | hôte |

### F03 Face-à-face

| method path | does | who |
| --- | --- | --- |
| POST /api/face/token | crée une salle `mode=voice` à un seul participant + agent en mode alterné ; facturé comme un appel | hôte connecté |

### F05 Achat

| method path | does | who |
| --- | --- | --- |
| GET /api/packs | liste des packs (prix EUR et XOF) | public |
| POST /api/checkout | crée la session Stripe ou PayDunya/CinetPay, `purchases` en `pending` | hôte connecté |
| POST /api/webhooks/stripe | vérifie signature, `paid` + ligne `credit_ledger` (idempotent) | Stripe |
| POST /api/webhooks/paydunya (ou cinetpay) | idem, après re-vérification du statut par appel API sortant | prestataire |

**Webhooks entrants** : Stripe, PayDunya/CinetPay, LiveKit (`participant_left`, `room_finished`) pour clore les appels orphelins. **Sortants** : aucun en V1.

**Agent → base** (clé service_role) : `debit_call_tick` toutes les 15 s, insertion `utterances` par lots de 2 s, `call_summaries` + statut `ended` en fin d'appel.

**Jobs** : `expire-rooms` toutes les 15 min (salles `waiting` dépassant `expires_at` → `expired`) ; `close-orphans` toutes les 5 min (salles `live` sans participant depuis 2 min → `ended`, `end_reason=timeout`).

Uniquement des API officielles avec vos propres clés : LiveKit, OpenAI, Supabase, Stripe, PayDunya/CinetPay. Rien d'AI Phone.

## The parts that bite

- **Latence** : budget cible < 1,5 s de la fin d'une phrase à la voix traduite. Agent à Paris (`cdg`), salle LiveKit en Europe, VAD serveur réglé court. À mesurer au jalon 1 avant tout le reste.
- **Écho / boucle** : chaque session Realtime n'écoute qu'une seule piste (celle d'un locuteur) ; la voix traduite est publiée sur une piste séparée que l'agent n'écoute pas. Annulation d'écho du navigateur activée côté clients.
- **Navigateur intégré WhatsApp** : iOS WKWebView peut refuser le micro → détection user-agent + écran « Ouvrir dans Safari/Chrome » + bouton copier le lien. À tester sur iPhone et Android réels au jalon 1.
- **Idempotence** : webhooks de paiement reçus deux fois → `unique(provider, provider_ref)` et `unique(purchase_id)` ; ticks rejoués → `unique(room_id, tick)`.
- **Courses** : deux appels simultanés du même hôte → index unique `one_live_call_per_host` ; débit sous verrou consultatif par utilisateur.
- **Coupure à solde nul** : alerte vocale + bandeau à 60 s et 30 s, puis fin propre. Jamais de dette.
- **Coût réel** : ~0,05 à 0,15 $ la minute par sens de traduction (estimation reprise de `traducteur-live`, à vérifier sur la page Pricing d'OpenAI). Un appel = 2 sens → compter **0,10 à 0,30 $/min** de moteur + LiveKit. Le prix de vente doit être fixé après mesure au jalon 1.
- **Abus du lien** : jeton aléatoire long, expiration 24 h, 1 invité max, limite de requêtes sur `/api/join`.
- **Fuseaux horaires** : tout en `timestamptz` UTC ; affichage dans le fuseau du navigateur.
- **RGPD / loi sénégalaise 2008-12 (CDP)** : transcriptions supprimables par l'hôte ; option « ne pas enregistrer la transcription » ; politique de conservation (90 jours par défaut, job de purge en V1.1) ; registre des sous-traitants (OpenAI, LiveKit, Supabase).
- **Consentement de l'invité** : la page invité annonce que l'appel est traduit par IA et transcrit avant de rejoindre.

## Build order

1. **Tranche verticale** (preuve technique, moche) : S04, S05, S06, S07 ; tables `call_rooms`, `participants`, `credit_ledger` ; routes `POST /api/rooms`, `GET /api/rooms/:id/token`, `POST /api/join/:token` ; agent FR⇄EN voix seule. Critère de sortie : un appel FR⇄EN de 5 min entre un PC et un iPhone ouvert depuis WhatsApp, latence mesurée, minutes débitées.
2. **Indispensables** : sous-titres bilingues (S07), transcription + historique (S02, S09, `utterances`), compte et connexion, compteur de solde + alerte, aide navigateur WhatsApp, face-à-face (S10), langues FR/EN/ES/AR/PT (+ wolof si le moteur le supporte de façon fiable, à tester), contrôles d'appel.
3. **Importants** : appel vidéo, choix de voix, couper la voix originale, résumé IA (S08, `call_summaries`), export transcription, Type-to-Speak, achats Stripe + PayDunya/CinetPay (S15, `purchases`, webhooks), interface FR/EN.
4. **Corrections issues de `/replica-entrepreneur`** : à remplir après son passage (déjà prévu : prix lisibles avant achat, pas de coupure sèche, support humain par WhatsApp).
5. **V2** : apps natives (Expo), appels vers de vrais numéros (fournisseur télécom), réponses rapides, mode écoute.

## Configuration à fournir (comptes à votre nom)

| service | quoi | coût de départ |
| --- | --- | --- |
| Supabase | projet `lien-interprete`, URL + clé anon + clé service_role | gratuit |
| LiveKit Cloud | projet, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | offre gratuite |
| OpenAI | projet dédié, clé API, budget plafonné (procédure du README de `traducteur-live`) | prépayé |
| Fly.io | app `lien-interprete-agent`, région `cdg` | quelques $/mois |
| Vercel | projet relié au dépôt | gratuit |
| Stripe | compte rattaché à une entité UE | à la transaction |
| PayDunya ou CinetPay | compte marchand Sénégal (Wave, Orange Money) | à la transaction |
