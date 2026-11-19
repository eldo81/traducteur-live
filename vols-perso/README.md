# Vols perso

Outil personnel pour trouver les billets d'avion les moins chers en Économie, Premium, Affaires et Première : prix cash vs miles, dates flexibles ±3 jours, départ alternatif et alertes quotidiennes.

Python 3.9+ standard, aucune dépendance.

## 1. Chercher un vol

```bash
python3 vols.py chercher DSS CDG 2027-01-20 --retour 2027-01-27 --classe affaires --flex 3 --cash 2400
```

Résultat :
- **Prix cash en classe économie** (si `TRAVELPAYOUTS_TOKEN` est défini). Ce sont des prix gardés en cache, à reconfirmer sur le lien.
- **Places payables en miles** sur plus de 20 programmes : Flying Blue, Aeroplan, Turkish et autres (si `SEATS_AERO_KEY` est défini). Pour chaque place, l'outil indique s'il vaut mieux payer en miles ou en cash quand vous donnez `--cash`.
- **Liens Google Flights, Skyscanner et Kayak** à J-3, J et J+3.
- **En Affaires et en Première :** départ alternatif depuis Casablanca, Lisbonne, Madrid, Bruxelles, Paris, Istanbul, Le Caire ou Addis-Abeba, avec le vol éco à prendre la veille depuis Dakar.
- Les vols opérés par Air Sénégal (code HC) sont signalés par ⚠.

Classes : `eco`, `premium`, `affaires`, `premiere`.

## 2. Cash ou miles ?

```bash
python3 vols.py valeur --cash 2400 --miles 60000 --taxes 250 --prix-achat-mile 2
```

L'outil calcule la valeur obtenue par mile : (prix cash − taxes) ÷ miles. Au-dessus de 1,5 centime d'euro par mile, il conseille de payer en miles (seuil modifiable avec `--seuil`). Avec `--prix-achat-mile`, il calcule aussi l'économie si vous achetez les miles.

## 3. Alertes automatiques (gratuites, par email)

1. Modifier `alertes.json` (trajet, date, classe, `max_eur` et/ou `max_miles`).
2. Sur GitHub : **Settings → Secrets and variables → Actions**, ajouter `TRAVELPAYOUTS_TOKEN` et/ou `SEATS_AERO_KEY`.
3. Chaque jour à 6 h 17 (heure de Dakar), si un prix passe sous le seuil, une *issue* est ouverte dans le dépôt et GitHub vous prévient par email.

## Clés API

| Variable | Contenu | Coût | Où |
|---|---|---|---|
| `TRAVELPAYOUTS_TOKEN` | Prix cash éco en cache | Gratuit | travelpayouts.com → Profil → API token |
| `SEATS_AERO_KEY` | Places en miles, toutes classes | Abonnement Pro seats.aero | seats.aero → Settings → API |

Sans clé, l'outil donne quand même les liens directs et le calcul cash ou miles.

## Règles

- Toujours vérifier que le tarif est **remboursable** avant de payer.
- Les transferts de points sont **irréversibles** : ne transférer qu'après avoir vu la place réellement réservable.
- L'outil ne paie jamais rien : c'est vous qui réservez.

## Tests

```bash
python3 -m unittest -v
```
