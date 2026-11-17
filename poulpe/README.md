# Poulpe — extraction web visuelle + IA

Outil d'extraction de données web auto-hébergé, dans la lignée des scrapers « pointer-cliquer » du marché, avec ce qui leur manque : une IA qui lit les pages sans sélecteur, des API officielles d'appels d'offres, un enrichissement des lignes, une détection des nouveautés, et un envoi direct vers n8n. Aucun abonnement, aucune limite de lignes, les données restent sur votre machine.

## Ce que fait Poulpe

| Fonction | Détail |
|---|---|
| **Éditeur visuel pointer-cliquer** | La page s'affiche telle que le robot la voit. Un clic sur un titre ajoute la colonne pour *tous* les blocs similaires (généralisation automatique). Contour bleu = blocs répétés, vert = champs, violet = bouton « suivant ». |
| **Détection automatique** | Repère les listes répétées (résultats, fiches, lignes de tableau) et propose les colonnes, avec aperçu. |
| **Assistant IA** | Vous décrivez le besoin en français (« les AO avec organisme, pays, date limite et lien ») : Claude propose sélecteurs, colonnes et pagination, testés immédiatement sur la page. |
| **Mode IA sans sélecteur** | Claude lit le texte de la page et renvoie les colonnes demandées. Insensible aux changements de design. Les pages très longues sont découpées, jamais tronquées. |
| **Pagination** | Bouton « suivant » (lien ou JavaScript), défilement infini, bouton « charger plus », URL numérotée `{page}`. Arrêt automatique si la page ne change plus. |
| **Pages de détail** | Ouvre chaque lien (en parallèle, 1 à 6 onglets) et complète la ligne, par sélecteurs ou par IA. |
| **Actions préalables** | Clic, saisie, touche, liste déroulante, attente, défilement : bannière cookies, recherche, filtres, connexion. Mots de passe via `${ENV:VARIABLE}`, jamais en clair. |
| **Sessions** | Cookies conservés entre exécutions. `login` ouvre un vrai navigateur pour les sites à CAPTCHA ou double authentification : vous vous connectez une fois à la main. |
| **API JSON** | Source `api` (GET/POST, pagination page/offset, chemin des éléments, valeurs multilingues) : TED, Banque mondiale, toute API publique. Plus rapide et plus fiable que le navigateur. |
| **Nettoyage** | Nombres FR/EN (`1 234,56 €` → 1234.56), dates FR/EN → AAAA-MM-JJ, URL absolues, email, téléphone, regex, remplacements. |
| **Filtres** | contient, contient l'un de, regex, >, <, non vide, après/avant `today+7`… avant et après l'IA. |
| **Enrichissement IA** | Colonnes calculées par Claude sur chaque ligne : pertinence, secteur, score de lead, résumé, traduction. |
| **Incrémental** | Dédoublonnage par clé ; chaque exécution signale les lignes *nouvelles* (`_first_seen`). Idéal pour la veille AO et prix. |
| **Planification** | Cron par tâche, fuseau Africa/Dakar par défaut. Déclenchement externe par webhook entrant. |
| **Sorties** | CSV (Excel FR, `;` + BOM), Excel .xlsx (en-têtes, filtres, liens cliquables), JSON, webhook sortant par paquets de 500 (n8n → Google Sheets, CRM, email, WhatsApp), dossier d'export automatique. |
| **Politesse & robustesse** | robots.txt respecté par défaut (crawl-delay inclus), pauses aléatoires, 3 essais avec attente progressive sur erreur 429/5xx, rotation de proxys, blocage images/polices. |
| **API REST + CLI** | Tout ce que fait l'interface est scriptable. |

Ce que Poulpe ne fait pas, volontairement : contourner les CAPTCHA, masquer l'automatisation ou forcer un site qui refuse les robots.

## Installation Windows en 3 clics

1. Installez **Node.js LTS** depuis nodejs.org (bouton « Windows Installer (.msi) », options par défaut ; si une fenêtre « Install Additional Tools » s'ouvre à la fin, fermez-la).
2. Décompressez le dossier du projet, ouvrez `poulpe`, double-cliquez sur **`Lancer-Poulpe.bat`**. La première fois, il installe tout (2 à 5 min), puis ouvre le navigateur.
3. Onglet **Réglages** : collez votre clé API Anthropic (`sk-ant-…`) → **Enregistrer**. Elle est vérifiée puis gardée sur ce PC.

Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** → **Exécuter quand même**.

## Installation (Windows, Mac, Linux) en ligne de commande

Prérequis : **Node.js 20 ou plus** (nodejs.org).

```bash
cd poulpe
npm install                 # installe aussi Chromium pour Playwright
npm start                   # → http://127.0.0.1:8787
```

Activer l'IA (assistant, mode IA, enrichissement) :

```bash
# macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...
# Windows PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

| Variable | Rôle | Défaut |
|---|---|---|
| `ANTHROPIC_API_KEY` | Fonctions IA (sinon : onglet Réglages) | absente = IA désactivée |
| `POULPE_MODEL` | Modèle Claude | `claude-opus-5-5` |
| `POULPE_EFFORT` | Effort de raisonnement (`low`, `medium`, `high`) | `low` |
| `PORT` / `HOST` | Écoute du serveur | `8787` / `127.0.0.1` |
| `POULPE_TOKEN` | Jeton obligatoire pour l'API et l'interface | aucun |
| `POULPE_DATA` | Dossier des données | `./data` |
| `POULPE_MAX_PARALLEL` | Exécutions simultanées | `2` |
| `POULPE_CHROMIUM` | Chemin d'un Chromium déjà installé | Chromium de Playwright |

**Serveur exposé sur Internet** (VPS pour la planification 24 h/24) : définissez `POULPE_TOKEN` (32 caractères aléatoires), `HOST=0.0.0.0`, et mettez un reverse proxy HTTPS (Caddy, Nginx) devant. Sans jeton, n'importe qui peut lancer des robots depuis votre serveur.

## Prise en main (5 minutes)

1. Onglet **Modèles** → *Démo : catalogue de livres* → **Utiliser** → **Tester (2 pages)**. Vous devez obtenir 40 livres avec prix, note, UPC et catégorie.
2. **Éditeur** → collez votre URL → **Charger la page** → **Détection automatique** → **Utiliser** sur la bonne liste.
3. Supprimez les colonnes inutiles, renommez les autres, cliquez dans la page pour en ajouter.
4. **Pagination** → type → mode « Bouton suivant » → clic sur le bouton de la page.
5. **Tester (2 pages)**, puis **Enregistrer**. Onglet **Données** : CSV, Excel, JSON.

## Modèles fournis

| Modèle | Source | Usage |
|---|---|---|
| Démo livres | books.toscrape.com (site d'entraînement) | Vérifier l'installation |
| TED — produits de la mer | API officielle TED v3 | Avis UE 7 derniers jours, CPV poisson / produits de la mer, jours ouvrés 7h |
| Banque mondiale — Afrique de l'Ouest | API publique procnotices | Avis récents filtrés Sénégal + pays voisins |
| UNGM — avis publics | Page publique, lecture IA | Avis ONU + tri de pertinence DIONEO par IA |
| Annuaire B2B → leads | Toute page d'annuaire, lecture IA | Entreprise, activité, contacts, scoring |
| Veille prix | Boutique en ligne | Nouveau produit ou nouveau prix = nouvelle ligne |

Les modèles TED, Banque mondiale et UNGM s'appuient sur des formats que ces organismes peuvent modifier. Au premier lancement, regardez le journal : une colonne vide ou « HTTP 400 » signale un nom de champ à ajuster dans « JSON de la tâche ».

## Brancher n8n (Google Sheets, email, WhatsApp)

1. Dans n8n : nœud **Webhook** (POST) → copiez l'URL de production.
2. Dans la tâche : *Planification & envoi* → **Webhook** = cette URL, « N'envoyer que les nouvelles lignes » coché.
3. Charge reçue :

```json
{ "task": "TED — produits de la mer (7 jours)", "taskId": "…", "runId": "…",
  "newRows": 4, "totalRows": 112, "batch": 1, "batches": 1,
  "rows": [ { "reference": "…", "titre": "…", "date_limite": "2026-12-04", "lien": "…" } ] }
```

4. Dans n8n : **Split Out** sur `rows` → **Google Sheets (Append)** ou **Send Email**.

Déclencher une tâche depuis n8n : `POST http://hôte:8787/api/hooks/run/<id>?token=<POULPE_TOKEN>&wait=1` renvoie les nouvelles lignes dans la réponse.

## Ligne de commande

```bash
node src/cli.js run templates/01-demo-livres.json --out livres.xlsx
node src/cli.js run <id> --pages 2 --out test.csv
node src/cli.js list
node src/cli.js import ma-tache.json
node src/cli.js login <id> https://www.site.com/login
```

Planification sans laisser l'interface ouverte : `npm start` sous `pm2` ou en service systemd ; ou une tâche cron système qui appelle `node src/cli.js run <id>`.

## API REST

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/tasks` | Liste des tâches + dernière exécution + prochaine planifiée |
| POST / PUT / DELETE | `/api/tasks[/:id]` | Créer, modifier, supprimer |
| POST | `/api/tasks/:id/run` | Lancer (`{maxPages, maxRows}` facultatifs) |
| POST | `/api/hooks/run/:id?wait=1` | Lancer depuis l'extérieur et attendre le résultat |
| GET | `/api/runs/:runId?task=:id` | Statut et journal |
| GET | `/api/tasks/:id/results?format=json\|csv\|xlsx&since=ISO&q=texte` | Données |
| GET | `/api/templates` | Modèles |

Avec `POULPE_TOKEN` : en-tête `Authorization: Bearer <jeton>` ou `?token=`.

## Format d'une tâche

```json
{
  "name": "AO — exemple",
  "startUrls": ["https://site.org/avis"],
  "actions": [{ "type": "clickIfExists", "selector": "#accept-cookies", "optional": true }],
  "extract": {
    "mode": "list",
    "listSelector": "table.results > tbody > tr",
    "fields": [
      { "name": "titre", "selector": "td:nth-of-type(2)", "attr": "text" },
      { "name": "date_limite", "selector": "td.deadline", "attr": "text", "transform": "date" },
      { "name": "lien", "selector": "a", "attr": "href" }
    ]
  },
  "pagination": { "type": "next", "selector": "a[rel=next]", "maxPages": 20 },
  "detail": { "enabled": true, "linkField": "lien", "mode": "ai",
              "ai": { "fields": [{ "name": "budget", "type": "number", "description": "Montant estimé" }] } },
  "filters": [{ "field": "date_limite", "op": "after", "value": "today+5" }],
  "enrich": { "enabled": true, "prompt": "Pertinent pour un négociant à Dakar ?",
              "fields": [{ "name": "pertinent", "type": "boolean" }] },
  "postFilters": [{ "field": "pertinent", "op": "equals", "value": "true" }],
  "dedupKey": ["lien"],
  "schedule": { "enabled": true, "cron": "0 7 * * 1-5", "timezone": "Africa/Dakar" },
  "outputs": { "onlyNew": true, "webhook": { "url": "https://n8n.exemple/webhook/poulpe" }, "xlsx": true, "folder": "./exports" },
  "browser": { "respectRobots": true, "blockResources": true, "delayMs": [800, 2000], "proxies": [] }
}
```

Attributs : `text`, `ownText`, `href`, `src`, `html`, `value` ou tout attribut HTML (`title`, `datetime`, `data-id`…). Champ `multiple: true` = tous les éléments joints par ` | `.

## Coûts IA (ordre de grandeur, Claude Opus 5.5 : 4 $ / M tokens entrée, 20 $ / M sortie)

| Usage | Coût indicatif |
|---|---|
| Mode IA, une page de liste (~15 000 tokens lus, 2 000 écrits) | ~0,10 $ |
| Enrichissement de 100 lignes | ~0,05 à 0,15 $ |
| Assistant de configuration (une fois par site) | ~0,10 à 0,30 $ |

Le mode sélecteurs est gratuit : utilisez l'IA pour configurer, puis les sélecteurs pour exécuter tous les jours. `POULPE_MODEL=claude-haiku-5-5` divise le coût par 40 pour l'enrichissement simple.

## Cadre légal

Respectez les conditions d'utilisation des sites, robots.txt et le RGPD (données personnelles : base légale, information, droit d'opposition). Préférez une API officielle quand elle existe. Les données publiques d'appels d'offres (TED, Banque mondiale, UNGM) sont publiées pour être consultées ; leur réutilisation commerciale reste soumise aux conditions de chaque plateforme.

## Tests

```bash
npm test     # mini-site local : liste, pagination lien et JavaScript, défilement infini,
             # fiches, robots.txt, API JSON, détection auto, incrémental, exports, IA simulée
```

## Structure

```
src/server.js      API REST + interface + éditeur visuel (sessions d'inspection)
src/engine.js      Moteur Playwright et API JSON : actions, pagination, fiches, nettoyage
src/runner.js      File d'exécution, journaux, sorties, planification cron
src/ai.js          Claude : extraction, assistant de configuration, enrichissement
src/transforms.js  Nettoyage, filtres, clés anti-doublon
src/store.js       Stockage fichiers JSON (data/)
src/export.js      CSV, Excel, JSON, webhook
src/robots.js      robots.txt
src/cli.js         Ligne de commande
public/            Interface (vanilla JS) ; public/lib/domkit.js = logique DOM partagée aperçu ↔ robot
templates/         Modèles prêts à l'emploi
```
