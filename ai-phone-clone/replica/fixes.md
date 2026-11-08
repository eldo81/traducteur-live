# Ce que les utilisateurs d'AI Phone détestent, et ce que le clone fait à la place

Étape : `/replica-entrepreneur`. Date : 2026-11-08. Suite : `/replica-brand`, puis `/replica-launch` (prix).
Fichiers : `reviews.csv` (les avis, mot pour mot, avec lien), `themes.json` (thèmes adaptés à la traduction d'appel, FR/EN/ES), `feedback.md` (sortie brute de `reviews.py`), ce fichier.

## Échantillon : ce qui a été lu, et ses limites

| source | méthode | lus | gardés |
| --- | --- | --- | --- |
| App Store US, tri « plus récents », page 1 | flux RSS officiel d'Apple | 50 | 12 (lus un par un ; les avis d'un mot, « Bueno », écartés) |
| App Store US, tri « plus utiles », pages 1 et 2 | flux RSS officiel | 100 | voir total |
| App Store France, page 1 (« plus récents ») | flux RSS officiel | 50 | 24 (lus un par un) |
| App Store Royaume-Uni, page 1 (« plus utiles ») | flux RSS officiel | 27 (la page n'en a pas plus) | voir total |
| Google Play (fiche en_US et fr / Sénégal) | lecture de la fiche publique | 6 (les 3 avis mis en avant de chaque fiche) | 6 |
| Reddit r/iphone (fil sur la traduction live d'Apple, concurrent gratuit) | lecture du fil public | 1 fil | 5 extraits de commentaires |
| Trustpilot | page `trustpilot.com/review/aiphone.ai` | refus 403 | 0 |
| Hacker News | API Algolia, une requête | résultats sans rapport (2012, brevets) | 0 |
| Tableau d'idées / roadmap public | aucun trouvé | — | — |
| Changelog | non lu (version iOS 3.43.3) | — | — |

**157 avis gardés** (174 lignes lues, 4 doublons, 13 trop courts pour porter un sens), 146 avec étoiles : 83 à 1 étoile, 4 à 2, 10 à 3, 12 à 4, 37 à 5. Du 2024-01-30 au 2026-10-31.

Biais à garder en tête :
- La moitié de l'échantillon vient du tri « plus utiles », qui fait remonter les avis longs et négatifs. La note globale de l'app reste 4,7/5 sur l'App Store (64,3K notes d'après apppricinglab.com ; 83K d'après la recon). L'échantillon dit **ce qui fait mal**, pas **combien de gens ont mal**.
- Google Play : la fiche publique n'affiche ni la date ni les étoiles de ces 6 avis (seule la date de la réponse de l'éditeur est visible). Champs laissés vides, rien deviné. Pas de lien par avis : les 3 avis d'une fiche portent l'URL de la fiche (avec `#r2`, `#r3` pour les distinguer).
- Les liens App Store pointent sur la page du flux RSS d'où l'avis a été copié, suivie de `#<id de l'avis Apple>`. Apple ne publie pas de lien web par avis.
- Les avis Reddit parlent de la traduction live d'Apple, pas d'AI Phone : c'est la concurrence gratuite et la limite de la techno, pas des plaintes contre l'original.
- Dans `reviews.csv`, la colonne `text` = titre de l'avis + « — » + corps, tous deux copiés tels quels (colonnes `title` et `body` séparées aussi).

Thèmes regroupés (comptés sur `reviews.csv` avec `themes.json`, un avis peut tomber dans plusieurs) :

| groupe | thèmes | avis | sources |
| --- | --- | --- | --- |
| Argent | prix, abonnement + crédits, essai qui facture, remboursement, coupure à solde nul | 63 (50 à ≤ 2★) | 5 |
| Ça ne marche pas | ne fonctionne pas, appel WhatsApp / lien qui échoue côté invité | 41 (35 à ≤ 2★) | 4 |
| Qualité | traduction, voix robotique, délai, langues, bruit / tours de parole | 38 | 6 |
| Support et remboursements | support absent, impossible d'annuler ou d'être remboursé | 28 | 4 |
| Téléphonie (V2) | numéro virtuel, codes SMS, spam, appels entrants | 18 | 4 |

## 1. Ce qu'ils détestent

1. **Payer deux fois : un abonnement, puis des crédits qui s'épuisent.** 17 avis sur le thème exact, 4 sources ; 27 de plus sur « trop cher / prix opaque » (4 sources). Le cœur de la colère.
   - « Abonnement + achat de crédits pour téléphoner… » (App Store FR, 1★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#12505895089
   - « I paid for a subscription and they still ask me to buy credits. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#12824656105
   - « J’ai payé 9,99 euro pour une semaine mais ça ne sert à rien. Pour un appel ou une traduction il faut acheter des crédits en plus. » (App Store FR, 1★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14536112443
2. **Impossible d'essayer sans payer ; « l'essai gratuit » facture.** 22 avis, 3 sources.
   - « Impossible de tester sans payer. » (App Store FR, 1★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#13944168737
   - « They say u have 3 day free trial but charge for the annual fee right away. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=2/id=6465173251/sortBy=mostHelpful/json#14275308316
3. **L'appel par lien WhatsApp échoue côté invité, ou ne marche plus.** 41 avis, 4 sources.
   - « When on a call through WhatsApp, we couldn't hear each other , and the closed captions were only working for me not the other person. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14609345838
   - « The video goes black. It's hard to get both videos to come app at the same time. » (Google Play, étoiles non affichées) https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=en_US#r3
   - « Je n’ai jamais réussi à avoir une traduction instantanée sur whatsapp ou Messenger » (App Store FR, 1★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#13924450099
4. **Voix robotique, délai de plusieurs secondes, langues hors Europe faibles.** 38 avis, 6 sources (dont 12 sur une paire de langues précise : chinois, vietnamien, bulgare, bosnien, géorgien, cantonais).
   - « Sounds very much robotic. There is a huge delay on translation with long sentences. » (App Store FR, 2★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#12236629888
   - « There is about a five second delay between each translation, dragging the conversation to a crawl. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#11733935254
   - « Ok pour le Français-Anglais mais sur le Face à Face Français-Bosnien, erreurs et blocages fréquents » (App Store FR, 3★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#12563041667
5. **Pas de support humain, pas de remboursement.** 28 avis, 4 sources.
   - « As for support, there is none. » (Google Play) https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=en_US
   - « I have sent messages to the developer and have never gotten a response » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14633185118
6. **Coupure sèche quand le solde tombe à zéro ; l'attente consomme les crédits.** 5 avis, 2 sources (thème mince, mais les avis sont longs et précis, et la décision produit est déjà prise).
   - « The app kept using my credits while I was only listening to hold music. Then, when my credits ran out, it simply disconnected the call without a clear warning or giving me a chance to add more credits and continue. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14510707461
   - « Le décompte du crédit a été consommé avec la mise en attente. » (App Store FR, 1★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#12505895089
7. **Annonce d'introduction entendue par l'appelé, voix originale par-dessus la traduction, pas de bouton pour couper la traduction.** 5 avis, 3 sources (mince).
   - « when you call the other person, he hears a long introduction, with information that this call comes from this application and this is an automatic translation function. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#13068259226
   - « I wish I could turn the translator off so I can speak with my real voice because most Italians speak English. » (App Store US, 5★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#12530296371
8. **Téléphonie : numéro virtuel refusé par WhatsApp, codes SMS qui n'arrivent pas, numéros +33 / +44 refusés, appels signalés comme arnaque.** 18 avis, 4 sources. Hors V1 (pas de téléphonie), mais c'est une raison de plus de ne pas en faire en V1.
   - « prendre en compte les numéros locaux . car une agence peut rediriger vers des opérateur anglais. actuellement inutilisable pour aider un ami dans le pétrin car l'appli refuse le bon format de numéro de téléphone+33 » (Google Play FR) https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=fr&gl=SN

## 2. Ce qui manque (demandé par son nom)

1. **Un vrai essai, sans carte.** 3 demandes explicites, 3 sources (mince, mais rejoint le thème n°2 qui en compte 22).
   - « Pienso que la prueba gratis sea sin tener que poner un número de tarjeta » (App Store US, titre d'un avis 5★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14544848460
   - « nul, aucun moyen de tester sans payer. » (Google Play FR) https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=fr&gl=SN#r2
2. **Une alerte de solde bas et une recharge avant que l'appel coupe.** 1 demande explicite (mince ; voir thème 6).
   - « There should be an obvious low-credit warning and an option for automatic renewal before disconnecting an active call. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14510707461
3. **Payer à l'usage, sans abonnement annuel, pour un usage occasionnel.** 3 demandes, 1 source (mince).
   - « If they had a lifetime set price, I’d be all over it. » (App Store US, 1★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#11165250189
   - « I would appreciate if they offered bonus deals if you surge a certain amount or something like that.. » (App Store US, 5★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#13842475618
4. **Couper la traduction en cours d'appel (parler en direct quand l'autre comprend).** 1 demande (mince).
   - Citation au thème 7 ci-dessus (#12530296371).
5. **Plus de langues en appel live (ourdou, hindi…).** 1 demande (mince).
   - « Does this app also support Urdu or Hindi language on live calls? » (App Store US, 5★) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#13358766915
6. **Un moyen de payer sans compte ni carte.** 3 avis, 2 sources (mince, mais c'est exactement le marché visé).
   - « Le problème, je ne sais pas comment le payer parce que j’ai pas encore un compte, j’aime bien cette application » (App Store FR, 5★) https://itunes.apple.com/fr/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#13826875276

## 3. Ce qui n'est pas résolu (groupes et métiers ignorés : le positionnement)

1. **Les appels d'affaires.** 11 avis parlent de clients, fournisseurs, banques, médecins ou de travail ; les avis positifs les plus votés sont des usages pros. La fiche Google Play d'AI Phone vise « global professionals, travelers, immigrants, international students, multilingual families » (https://play.google.com/store/apps/details?id=com.aiphone.secondphonenumber&hl=en_US) : le mot « professionals » y est, mais rien n'est construit pour eux. Personne ne parle aux commerçants qui négocient avec un fournisseur. Thème : 11 avis, 3 sources.
   - « I have clients that only speak Spanish and now I will be able to call them without having to have an interpreter there on the call. » (App Store US, 5★, 17 votes) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostHelpful/json#11973811573
   - « 没想到有这样的传译电话软件，有这个软件太好了，可以解决我和外国客户的顺利沟通。 » (App Store US, 5★ ; traduction libre, pas une citation : ça lui permet de communiquer sans accroc avec ses clients étrangers) https://itunes.apple.com/us/rss/customerreviews/page=1/id=6465173251/sortBy=mostRecent/json#14667389382
2. **Les gens qui paient sans carte bancaire ni compte store.** Afrique francophone : Wave et Orange Money, pas Apple Pay. Aucune plainte directe dans l'échantillon (le marché n'est pas là, justement), sauf l'avis « je ne sais pas comment le payer » ci-dessus. **Preuve indirecte, à valider sur le terrain**, pas une tendance.
3. **Les paires de langues du commerce hors Europe : chinois, turc, arabe.** 12 avis sur des paires précises + 5 commentaires Reddit sur la techno elle-même. C'est la limite du secteur, pas d'AI Phone seul : à mesurer avant de promettre.
   - « However mandarin to English was unusable. Like completely unusable. » (Reddit r/iphone, sur la traduction d'Apple) https://www.reddit.com/r/iphone/comments/1pvyc7w/i_tried_ios26_live_translation_with_my_gfs_non/
   - « But English and any turk or semitic language: bad. » (Reddit r/iphone, commentaire) https://www.reddit.com/r/iphone/comments/1pvyc7w/i_tried_ios26_live_translation_with_my_gfs_non/#redditoglio
4. **L'usage occasionnel.** Un commerçant appelle un fournisseur quelques fois par mois, pas tous les jours. Un forfait hebdo/annuel ne lui va pas (voir l'avis #11165250189 cité plus haut). 3 avis, 1 source (mince).

## 4. Le plan de correction

Classé par preuve × coût de la correction. Chaque ligne est ajoutée à `features.csv` (`original=no`, `clone=no`).

| # | quoi construire | taille | skill | preuve |
| --- | --- | --- | --- | --- |
| F1 | **Minutes prépayées, prix au minute affiché avant d'acheter** : chaque pack dit « X min » et « Y FCFA/min » en gros ; pas d'abonnement ; minutes valables 12 mois ; reçu / facture au nom de l'entreprise | S | `/replica-launch` (grille), `/replica-backend` | Argent : 63 avis, 5 sources |
| F2 | **3 minutes offertes à l'inscription, sans carte ni paiement** (déjà dans `schema.sql` : cadeau de 180 s) + **appel test gratuit de 30 s** avec soi-même pour vérifier micro et son | S | `/replica-backend`, `/replica-build` | Essai qui facture : 22 avis, 3 sources |
| F3 | **Facturation honnête** : le compteur ne démarre que quand les deux sont connectés **et** que quelqu'un parle ; pause du compteur après 30 s de silence (attente, musique) ; minutes recréditées automatiquement si l'appel échoue dans la 1re minute | M | `/replica-backend` (agent + `debit_call_tick`) | Coupure / attente : 5 avis, 2 sources ; ça ne marche pas : 41 avis |
| F4 | **Recharge en plein appel par Wave / Orange Money sans raccrocher** : alerte à 2 min et 30 s, bouton « Recharger », 60 s de grâce pendant le paiement ; complète la ligne existante « Avertissement avant crédits épuisés » | M | `/replica-backend` (PayDunya/CinetPay), `/replica-build` (S07) | Coupure : 5 avis + demande explicite #14510707461 |
| F5 | **Vérification côté invité avant de rejoindre** : test micro + haut-parleur, « je vous entends ? » dans les deux sens, sous-titres testés des deux côtés, indicateur de réseau ; si navigateur WhatsApp bloqué → « Ouvrir dans Chrome/Safari » | M | `/replica-build` (S06), `/replica-test` | WhatsApp / lien côté invité : 16 avis ; ça ne marche pas : 41 avis, 4 sources |
| F6 | **Qualité par paire de langues, dite honnêtement** : étiquette « Excellent / Bon / Bêta » par paire, mesurée sur nos propres tests (FR⇄EN, FR⇄ZH, FR⇄AR, FR⇄TR, FR⇄ES, FR⇄PT) ; **lexique métier** (noms de produits, Incoterms, unités) et **relecture des chiffres** (prix, quantités, dates répétés et affichés en gros) | M | `/replica-build`, agent | Qualité : 38 avis, 6 sources ; langues : 12 avis |
| F7 | **Support humain sur WhatsApp** (numéro affiché dans l'app, réponse sous 24 h ouvrées) + remboursement en minutes d'un appel raté, en un clic depuis l'historique | S | `/replica-launch`, `/replica-backend` | Support et remboursements : 28 avis, 4 sources |
| F8 | **Récap commercial après l'appel envoyé sur WhatsApp** : prix, quantités, délais, engagements de chaque partie, dans les deux langues (prolonge la ligne « Résumé IA ») | S | `/replica-build` (S08) | Usage pro : 11 avis, 3 sources (positionnement) |
| F9 | **Bouton « Traduction en pause »** en plein appel, pour parler en direct ; pas d'annonce longue à l'invité (une ligne de consentement sur la page invité suffit) | S | `/replica-build` (S07) | Thème 7 : 5 avis, 3 sources (mince) |

Laissés de côté : numéro virtuel, SMS, appels vers vrais numéros (18 avis, mais V2 et risqué) ; iPad (1 avis) ; traduction de flux vidéo / TV (1 avis).

## 5. Le positionnement

**Option A : l'argent, payé comme on paie à Dakar** (thème Argent : 63 avis, 5 sources)
> Pour les commerçants et PME d'Afrique francophone qui appellent fournisseurs et clients en Chine, en Turquie ou à Dubaï, et qui refusent de payer un abonnement **plus** des crédits par carte bancaire, [nom] vend des minutes prépayées payables par Wave ou Orange Money : vous envoyez un lien sur WhatsApp, votre fournisseur clique, chacun parle sa langue, et vous ne payez que les minutes parlées.
> Preuve : abonnement + crédits et prix opaques, 63 avis sur 5 sources ; essai qui facture, 22 avis sur 3 sources.

**Option B : l'appel qui marche du premier coup chez l'autre** (thème Ça ne marche pas : 41 avis, 4 sources)
> Pour ceux qui ont envoyé un lien et entendu un silence, [nom] vérifie le micro et le son des deux côtés avant le début de l'appel et ne fait payer qu'une fois que vous vous entendez.
> Preuve : 41 avis sur 4 sources.

**Option C : la négociation, pas la conversation** (thèmes Qualité + Usage pro : 38 + 11 avis)
> Pour les importateurs que la traduction automatique trahit sur un prix ou une quantité, [nom] répète et affiche chaque chiffre, connaît le vocabulaire du commerce, et vous envoie le récap de la négociation sur WhatsApp.
> Preuve : qualité, 38 avis sur 6 sources ; usage pro, 11 avis sur 3 sources.

**Recommandé : A**, avec B et C comme preuves sur la page d'accueil. A s'appuie sur le thème le plus lourd, que l'original ne peut pas corriger sans casser son modèle d'abonnement, et sur le seul avantage qu'un concurrent américain n'a pas : Wave / Orange Money et le français. B et C sont des engagements produit (F3, F5, F6, F8) qui rendent A crédible.

En une phrase : **la traduction d'appel pour les commerçants d'Afrique francophone, sans abonnement : des minutes payées par Wave, un lien WhatsApp, et chaque prix répété pour que rien ne se perde.**

Règles : ne pas mettre « AI Phone » dans notre nom, nos pubs ou notre fiche store. Ne pas reprendre les avis ci-dessus comme témoignages. Une page de comparaison nominative relève d'un avocat.

## 6. Prix (à reprendre dans `/replica-launch`)

### Ce que facture la concurrence

| offre | prix public | minutes | prix par minute | source |
| --- | --- | --- | --- | --- |
| AI Phone, forfait hebdo | 8,99 $ | ~20 min (100 crédits, d'après un avis ; 5 crédits/min, d'après la lecture des CGU par la recon) | ~0,45 $/min, **plus** le forfait qui se renouvelle | apppricinglab.com/app/apple/6465173251 ; avis #11985458277 |
| AI Phone, forfait mensuel | 14,99 $ | non publié | — | apppricinglab.com |
| AI Phone, forfait annuel | 59,99 $ | ~300 min (1 500 crédits / 5) | ~0,20 $/min, payé d'avance pour un an | apppricinglab.com ; avis #11985458277 |
| AI Phone, packs de crédits | 5,99 / 12,99 / 29,99 / 69,99 $ | nombre de crédits non publié sur les stores | — | apppricinglab.com |
| AI Phone, crédits vendus par TransAI | 59 $ | 3 600 crédits ≈ 720 min à 5 crédits/min | ~0,08 $/min | transai.ai/products/ai-phone-translation-credits |
| Bridgecall Light / Essential / Plus | 15 / 29 / 59 $ par mois | 100 / 250 / 600 | 0,15 / 0,116 / 0,098 $/min | bridgecall.app |
| Bridgecall recharge | 19 $ | 100 (reportées) | 0,19 $/min | bridgecall.app |
| AI Call (1aicall.com) | prix dans l'app seulement | 1er appel gratuit jusqu'à 2 min | non publié | 1aicall.com |
| Traduction live d'Apple, Google, Samsung | gratuite sur certains appareils et certaines langues | — | 0 | avis #13984017909 (« Apple has video chat translation included for free ») ; Reddit |

Réserve : les **5 crédits par minute** viennent de la lecture des CGU dans `recon.md` ; le tableau des tarifs de la page CGU ne s'affichait plus le 2026-11-08 (« Specific Rates: » vide). Les prix par minute d'AI Phone sont donc des **estimations**.

### Notre coût

- Moteur (OpenAI Realtime, deux sens de traduction) + salle : **0,10 à 0,30 $ par minute d'appel**, estimation de `architecture.md`, **à mesurer au jalon 1**.
- Change (hypothèse, à mettre à jour) : 1 $ = 570 FCFA ; 1 € = 655,957 FCFA (parité fixe). Donc coût bas = 0,10 × 570 = **57 FCFA/min** (0,087 €) ; coût haut = 0,30 × 570 = **171 FCFA/min** (0,261 €).
- Frais de paiement (hypothèses à vérifier sur les grilles des prestataires) : Wave / Orange Money via PayDunya ou CinetPay **3 %** ; Stripe carte UE **1,5 % + 0,25 €**.
- TVA (hypothèse) : prix affichés TTC ; **18 %** Sénégal sur les packs FCFA, **21 %** (taux belge, le plus haut de nos marchés) sur les packs en euros.
- Hors calcul : hébergement fixe (Vercel, Fly.io, Supabase), support, acquisition.

### Grille recommandée (packs prépayés, sans abonnement, minutes valables 12 mois)

| pack | FCFA TTC | € TTC | minutes | FCFA/min | €/min |
| --- | --- | --- | --- | --- | --- |
| Bienvenue | 0 | 0 | 3 (à l'inscription, sans carte) | — | — |
| Découverte | 3 000 | 4,90 | 10 | 300 | 0,49 |
| Standard | 7 500 | 11,90 | 28 | 268 | 0,425 |
| Pro | 15 000 | 23,90 | 60 | 250 | 0,398 |
| Business | 35 000 | 54,90 | 150 | 233 | 0,366 |

Montants ronds en FCFA, faciles à payer par Wave. Un pack Business de 150 min, c'est environ 15 appels fournisseurs de 10 min.

### Marge brute par pack : le calcul

Formule : **net = prix TTC ÷ (1 + TVA) − frais de paiement** ; **coût = minutes × coût/min** ; **marge = net − coût** ; **marge % = marge ÷ net**.

Packs en FCFA (TVA 18 %, frais 3 % du TTC) :

| pack | net | coût bas (57/min) | marge bas | coût haut (171/min) | marge haut |
| --- | --- | --- | --- | --- | --- |
| Découverte | 3 000 ÷ 1,18 − 90 = **2 452** | 10 × 57 = 570 | 1 882 (**76,8 %**) | 10 × 171 = 1 710 | 742 (**30,3 %**) |
| Standard | 7 500 ÷ 1,18 − 225 = **6 131** | 28 × 57 = 1 596 | 4 535 (**74,0 %**) | 28 × 171 = 4 788 | 1 343 (**21,9 %**) |
| Pro | 15 000 ÷ 1,18 − 450 = **12 262** | 60 × 57 = 3 420 | 8 842 (**72,1 %**) | 60 × 171 = 10 260 | 2 002 (**16,3 %**) |
| Business | 35 000 ÷ 1,18 − 1 050 = **28 611** | 150 × 57 = 8 550 | 20 061 (**70,1 %**) | 150 × 171 = 25 650 | 2 961 (**10,3 %**) |

Packs en euros (TVA 21 %, Stripe 1,5 % + 0,25 €) :

| pack | net | coût bas (0,087 €/min) | marge bas | coût haut (0,261 €/min) | marge haut |
| --- | --- | --- | --- | --- | --- |
| Découverte | 4,90 ÷ 1,21 − 0,32 = **3,73 €** | 0,87 € | 2,86 € (**76,7 %**) | 2,61 € | 1,12 € (**30,0 %**) |
| Standard | 11,90 ÷ 1,21 − 0,43 = **9,41 €** | 2,43 € | 6,97 € (**74,1 %**) | 7,30 € | 2,11 € (**22,4 %**) |
| Pro | 23,90 ÷ 1,21 − 0,61 = **19,14 €** | 5,21 € | 13,93 € (**72,8 %**) | 15,64 € | 3,50 € (**18,3 %**) |
| Business | 54,90 ÷ 1,21 − 1,07 = **44,30 €** | 13,03 € | 31,26 € (**70,6 %**) | 39,10 € | 5,20 € (**11,7 %**) |

Coût des 3 minutes offertes : 3 × 57 = 171 FCFA (bas) à 3 × 171 = 513 FCFA (haut) par inscrit.

### Ce que ça veut dire

- **Toutes les cases restent positives**, même au coût haut. Mais à 0,30 $/min, le pack Business ne laisse que 10 % : il ne paierait ni le support ni l'acquisition.
- **Règle à appliquer après la mesure du jalon 1** : si le coût réel dépasse **0,18 $/min**, soit passer les appels standard sur `gpt-realtime-2.1-mini` et garder le grand modèle pour les paires difficiles, soit monter le pack Business à 40 000 FCFA / 150 min. Si le coût réel est près de 0,10 $/min, baisser les prix est facile ; les monter après le lancement ne l'est pas. D'où une grille qui démarre prudente.
- **Face à la concurrence** : on est au-dessus de Bridgecall (0,10 à 0,19 $/min, sur abonnement mensuel, carte bancaire, en anglais) et en dessous du forfait hebdo d'AI Phone (~0,45 $/min + renouvellement). Notre argument n'est pas le prix le plus bas mais **zéro abonnement, Wave / Orange Money, le français, et la minute affichée avant d'acheter**.
- À tester avant de figer : le prix psychologique d'un appel fournisseur (un pack de 3 000 FCFA = un appel de 10 min) auprès de 10 commerçants à Dakar.

## Prochaine étape

`/replica-brand` : nom, voix, couleurs, sur l'option A. Puis `/replica-launch` : page d'accueil et prix à partir de la section 6.
