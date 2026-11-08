# Agent « interprete » — traduction simultanée des appels

Worker Python (LiveKit Agents 1.8.11 + plugin OpenAI) qui rejoint chaque salle d'appel de
Lien Interprète, écoute séparément l'hôte et l'invité, traduit avec OpenAI Realtime et
republie la voix traduite, les sous-titres et le solde. Il écrit aussi la transcription,
le statut d'appel et le résumé dans Supabase (clé `service_role`, jamais côté navigateur).

## Ce que fait l'agent

| sujet | comportement |
| --- | --- |
| dispatch | explicite, `agent_name = "interprete"` (l'app web appelle `AgentDispatchClient.createDispatch`) |
| configuration d'appel | métadonnées de la salle `{room_id, host_lang, guest_lang, host_voice, guest_voice, mute_original_host, mute_original_guest}` ; face-à-face si `face` ou `face_to_face` vaut `true` (salle ou métadonnées du job) |
| traduction | une session Realtime **par locuteur** : le micro de `host` → piste `tr-for-guest` (host_lang→guest_lang), le micro de `guest` → piste `tr-for-host` (guest_lang→host_lang) |
| anti-boucle | une session n'écoute que la piste **micro** de son participant ; les pistes traduites de l'agent ne sont jamais lues ; filtre logiciel d'écho (une sortie qui reprend ≥ 80 % des mots de ce que l'autre vient de dire est coupée) ; « · » = rien à traduire, jamais prononcé |
| face-à-face | une seule session sur le micro de `host`, langue détectée à chaque phrase, sortie sur `tr-for-host` ; le client publie `face_turn` `{"speaker":"host"|"guest"}` (accepté seulement en face-à-face et seulement de `host`) ; le locuteur d'une phrase est figé dès son premier sous-titre, car le client fusionne par `(speaker, seq)` |
| sous-titres | topic `captions` : `{speaker, lang_src, text_src, lang_dst, text_dst, final, seq}` (texte source = transcription d'entrée, texte traduit = transcription de la sortie audio) ; partiels limités à ~7/s, puis un `final:true` par phrase |
| facturation | `debit_call_tick(p_room, p_tick, p_seconds=15)` payé d'avance toutes les 15 s, **uniquement** si les deux participants sont là **et** que quelqu'un a parlé dans les 30 dernières secondes (attente, musique d'attente : pause, reprise à la parole suivante) ; topic `billing` : `{remaining_seconds}` à chaque tranche |
| alertes | sous 120 s puis sous 30 s : `{remaining_seconds, warning_threshold}` sur `billing` + annonce vocale courte dans la langue de chacun |
| solde épuisé | le RPC renvoie `-1` → annonce « crédit épuisé », `remaining_seconds: 0`, fin propre `end_reason = no_credit` |
| remboursement | appel terminé sur **erreur** dans sa première minute → une ligne `credit_ledger` `reason='refund'`, `delta = secondes déjà débitées`, `tick = -1` (au plus une par salle grâce à `unique(room_id, tick)`) |
| fin d'appel | `call_rooms` : `live` + `started_at` quand les deux sont là ; à la fin `ended`, `end_reason`, `ended_at` (sans écraser une salle déjà close par l'app) ; participant parti plus de 30 s → `host_hangup` / `guest_hangup` |
| transcription | phrases finalisées écrites par lots toutes les ~2 s dans `utterances` (`host_id` lu dans `call_rooms`, `seq` croissant, reprise après le plus grand `seq` existant) |
| résumé | en fin d'appel, modèle texte `SUMMARY_MODEL` → `call_summaries` (`summary`, `key_points`, `lang = host_lang`) |
| modèles | `REALTIME_MODEL` (défaut `gpt-realtime-2`), repli automatique sur `REALTIME_FALLBACK_MODEL` (`gpt-realtime-2.1-mini`) si le premier est refusé ou ne se connecte pas |

`mute_original_*` est appliqué par les clients (ils ne s'abonnent pas au micro d'origine de
l'autre) : l'agent ne coupe jamais une piste, car il en a besoin pour traduire.

Voix (côté locuteur) : `host_voice` prononce les paroles traduites de l'hôte sur
`tr-for-guest`, `guest_voice` celles de l'invité sur `tr-for-host`. Valeurs : `auto`
(→ `DEFAULT_VOICE`, `marin` par défaut) ou un nom de voix OpenAI (`marin`, `cedar`, `coral`,
`ash`...). Les langues de `CAPTIONS_ONLY_LANGS` (par défaut `wo`) sont
traduites en texte seulement, sans voix.

## Installation locale

Python 3.11+ (testé en 3.13).

```bash
cd ai-phone-clone/agent
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # puis remplissez vos propres clés
```

Variables (voir `.env.example`) : `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`OPENAI_API_KEY`, `REALTIME_MODEL`, `REALTIME_FALLBACK_MODEL`, `SUMMARY_MODEL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Sans les deux variables Supabase, l'agent
traduit quand même mais **ne facture pas et n'écrit rien** (mode développement, signalé
dans les logs).

## Lancer

```bash
python agent.py dev     # développement : logs détaillés, rechargement
python agent.py start   # production
python agent.py --help
```

Le worker s'enregistre auprès de LiveKit Cloud avec le nom `interprete` et n'est envoyé
que dans les salles où l'app web le demande. Pour un essai : lancez l'app web
(`ai-phone-clone/app`), créez un appel, ouvrez le lien invité dans un autre navigateur.

## Tests

```bash
python -m py_compile agent.py interprete/*.py tests/*.py
pytest
```

Les tests couvrent la logique pure, sans réseau : métadonnées, consignes et langues,
facturation (tranches, arrêt sur `-1`, alertes 120/30 s, pause après 30 s de silence,
remboursement), format des sous-titres, enchaînement des événements Realtime (une phrase,
FIFO, silence, écho, annonces, face-à-face, repli de modèle), lots de phrases et `seq`,
résumé (OpenAI simulé), appels PostgREST (httpx simulé).

## Déployer sur Fly.io (région Paris `cdg`)

```bash
fly auth login
fly apps create lien-interprete-agent        # une seule fois
fly secrets set \
  LIVEKIT_URL=wss://VOTRE-PROJET.livekit.cloud \
  LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
  OPENAI_API_KEY=... \
  SUPABASE_URL=https://VOTRE-PROJET.supabase.co SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
fly logs
```

Les modèles se changent dans `[env]` de `fly.toml` (ou `fly secrets set REALTIME_MODEL=...`).
Aucun port public n'est nécessaire : le worker ouvre lui-même la connexion vers LiveKit ;
le contrôle de santé interroge `GET /` sur le port 8081. `kill_timeout = 120s` laisse les
appels en cours se terminer lors d'un déploiement. Pour plus d'appels simultanés :
`fly scale count 2` (chaque appel = 2 sessions Realtime, environ 1 cœur pour 3 à 5 appels,
à mesurer au jalon 1).

## Limites connues

- Un arrêt brutal du processus (OOM, machine tuée) n'exécute ni la clôture ni le
  remboursement : le job `close-orphans` de l'app web doit clore la salle (et peut
  appliquer la même règle de remboursement).
- La détection de langue en face-à-face combine la transcription (`languages=[a, b]`), un
  détecteur de mots courants et l'indice `face_turn` ; une phrase très courte peut être
  attribuée au mauvais locuteur dans les sous-titres (la traduction, elle, reste correcte).
- Le coût réel par minute est à mesurer (2 sessions Realtime par appel).
