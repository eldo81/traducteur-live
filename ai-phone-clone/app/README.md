# Lien Interprète (nom provisoire) - application web

Appels traduits en direct par lien partagé. L'hôte crée un lien, l'envoie par
WhatsApp ; l'invité l'ouvre dans son navigateur, sans compte, et chacun entend
l'autre traduit dans sa langue, avec sous-titres bilingues.

- Next.js 16 (App Router) + TypeScript + Tailwind 4 (jetons de `replica/design`)
- Supabase : connexion (lien magique, Google) + Postgres avec RLS
- LiveKit Cloud : la salle d'appel (WebRTC)
- Agent de traduction Python séparé : `../agent/` (nom d'agent `interprete`)
- Stripe Checkout pour les packs de minutes (PayDunya prévu, en attente)

## 1. Prérequis

- Node.js 20.9 ou plus récent, npm
- Comptes à votre nom : Supabase, LiveKit Cloud, Stripe (mode test), Vercel
- La CLI Stripe pour tester les webhooks en local (facultatif)

## 2. Installation

```bash
cd ai-phone-clone/app
npm install
cp .env.example .env.local   # puis remplissez les valeurs
```

## 3. Base de données (Supabase)

1. Créez un projet Supabase (région Europe, par exemple Francfort ou Paris).
2. Ouvrez **SQL Editor**, collez le contenu de `supabase/migrations/0001_init.sql`, exécutez.
   Avec la CLI : `supabase link --project-ref <ref>` puis `supabase db push`.
3. **Authentication > URL Configuration** :
   - Site URL : votre `NEXT_PUBLIC_APP_URL`
   - Redirect URLs : `http://localhost:3000/auth/callback` et `https://votre-domaine/auth/callback`
4. **Authentication > Providers** : activez Email (lien magique) et Google
   (identifiants OAuth créés dans **votre** projet Google Cloud).
5. Chaque nouvel utilisateur reçoit 3 minutes offertes (déclencheur SQL).

## 4. Variables d'environnement

| variable | où la trouver | côté |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | URL publique de l'app (liens partagés, retours Stripe) | public |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project settings > API | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem, clé `anon` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | idem, clé `service_role` | **serveur uniquement** |
| `LIVEKIT_URL` | LiveKit Cloud > Settings, `wss://...` | serveur |
| `NEXT_PUBLIC_LIVEKIT_URL` | la même URL `wss://` | public |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit Cloud > Keys | serveur |
| `STRIPE_SECRET_KEY` | Stripe > Developers > API keys (`sk_test_...`) | serveur |
| `STRIPE_WEBHOOK_SECRET` | Stripe > Webhooks (`whsec_...`) | serveur |
| `PAYDUNYA_*` | réservé, PayDunya n'est pas encore branché | serveur |
| `UPSTASH_REDIS_*` | réservé, limiteur partagé à venir | serveur |

La clé `service_role` et les secrets ne sont lus que dans le code serveur
(`import "server-only"`). Sans clés, `npm run build` passe quand même : les
pages affichent « non configuré » et les routes API répondent 503.

## 5. Lancer en local

```bash
npm run dev          # http://localhost:3000
npm test             # tests unitaires (vitest)
npm run typecheck    # next typegen + tsc
npm run lint
npm run build
```

Pour qu'un appel fonctionne, l'agent `../agent/` doit tourner et être
connecté au même projet LiveKit (voir son README). Pour tester l'invité sur
un téléphone, exposez le serveur en HTTPS (le micro exige HTTPS), par exemple
avec un tunnel, et mettez cette URL dans `NEXT_PUBLIC_APP_URL`.

Webhooks en local :

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## 6. Déployer sur Vercel

1. Importez le dépôt dans Vercel, **Root Directory** : `ai-phone-clone/app`.
2. Ajoutez toutes les variables de `.env.example` (Production et Preview).
   `NEXT_PUBLIC_APP_URL` = l'URL de production.
3. Déployez. Puis :
   - **Stripe > Webhooks** : point de terminaison `https://votre-domaine/api/webhooks/stripe`,
     événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`.
     Copiez le secret dans `STRIPE_WEBHOOK_SECRET`.
   - **LiveKit Cloud > Settings > Webhooks** : `https://votre-domaine/api/webhooks/livekit`
     (signé avec votre clé API LiveKit).
   - **Supabase** : ajoutez l'URL de production aux Redirect URLs.
4. Installez l'app depuis le navigateur du téléphone (« Ajouter à l'écran d'accueil ») : c'est une PWA.

## 7. Contrat avec l'agent de traduction

Défini dans `src/lib/contract.ts` (à changer en même temps que `../agent/interprete/config.py`).

- Nom de salle LiveKit = `call_rooms.id` (uuid). Identités : `host`, `guest`.
- Dispatch explicite : `AgentDispatchClient.createDispatch(room, "interprete", { metadata })`.
- Métadonnées de salle (JSON, exactement ces clés) :
  `{room_id, host_lang, guest_lang, host_voice, guest_voice, mute_original_host, mute_original_guest}`.
  Côté locuteur : `mute_original_host = true` → l'invité n'entend pas la voix d'origine de l'hôte ;
  `host_voice` = voix qui prononce la traduction de l'hôte (entendue par l'invité).
  En face-à-face, les métadonnées du job ajoutent `face_to_face: true`.
- Pistes audio publiées par l'agent : `tr-for-host`, `tr-for-guest`. Chaque client ne s'abonne
  qu'à la sienne (+ la voix d'origine de l'autre à faible volume si elle n'est pas coupée).
- Données : sujet `captions` `{speaker, lang_src, text_src, lang_dst, text_dst, final, seq}` ;
  sujet `billing` `{remaining_seconds}` ; sujet `face_turn` `{speaker}` (client → agent, face-à-face).
- Alertes de solde côté interface : 120 s puis 30 s, fin propre à 0.

## 8. Structure

```
src/app/            pages (/, /appel, /appel/[id], /j/[token], /historique, /face, /credits) et routes API
src/components/     interface (ui/, call/)
src/lib/            contrat, jetons, limiteur, détection navigateur intégré, paiements, Supabase, LiveKit
src/styles/         tokens.css (copie de replica/design/tailwind-tokens.css)
supabase/migrations 0001_init.sql (copie de replica/schema.sql)
public/             icônes PWA, service worker
```
