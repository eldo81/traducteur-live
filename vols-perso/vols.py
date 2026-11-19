#!/usr/bin/env python3
"""Vols perso — trouver les billets d'avion les moins chers (cash ET miles).

Usage :
  python3 vols.py chercher DSS CDG 2026-12-15 --retour 2026-12-22 --classe affaires --flex 3
  python3 vols.py valeur --cash 2400 --miles 60000 --taxes 250
  python3 vols.py alerte            (lit alertes.json)

Clés API optionnelles (variables d'environnement) :
  TRAVELPAYOUTS_TOKEN  -> prix cash économie (gratuit : travelpayouts.com)
  SEATS_AERO_KEY       -> places en miles sur 20+ programmes (seats.aero Pro)
Sans clé : liens directs prêts à cliquer vers les comparateurs.

Aucune dépendance : Python 3.9+ standard.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta

CLASSES = {
    "eco": ("Y", "economy"),
    "premium": ("W", "premium_economy"),
    "affaires": ("J", "business"),
    "premiere": ("F", "first"),
}
# Hubs où les promos Affaires/Première sont fréquentes (départ alternatif).
HUBS_POSITIONNEMENT = ["CMN", "LIS", "MAD", "BRU", "CDG", "IST", "CAI", "ADD"]
SEUIL_CTS_PAR_MILE = 1.5  # en centimes d'euro : au-dessus -> les miles valent le coup
USD_EUR = 0.92  # conversion indicative des taxes seats.aero si en USD


# ---------------------------------------------------------------- utilitaires
def jours(centre: date, flex: int):
    return [centre + timedelta(days=d) for d in range(-flex, flex + 1)]


def http_json(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "vols-perso/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def cts_par_mile(cash_eur, taxes_eur, miles):
    if miles <= 0:
        raise ValueError("miles doit être > 0")
    return round((cash_eur - taxes_eur) / miles * 100, 2)


def verdict(cash_eur, taxes_eur, miles, seuil=SEUIL_CTS_PAR_MILE, prix_achat_mile=None):
    v = cts_par_mile(cash_eur, taxes_eur, miles)
    lignes = [f"Valeur obtenue : {v} centimes d'euro par mile "
              f"(({cash_eur} - {taxes_eur}) / {miles} x 100)"]
    if v >= seuil:
        lignes.append(f"=> MILES : au-dessus du seuil de {seuil} ct/mile. Payer en miles.")
    else:
        lignes.append(f"=> CASH : sous le seuil de {seuil} ct/mile. Payer cash et accumuler des miles.")
    if prix_achat_mile:
        cout = round(miles * prix_achat_mile / 100 + taxes_eur, 2)
        eco = round(cash_eur - cout, 2)
        pct = round(eco / cash_eur * 100, 1) if cash_eur else 0
        lignes.append(f"Si miles achetés à {prix_achat_mile} ct : coût total {cout} EUR "
                      f"(miles + taxes) -> économie {eco} EUR ({pct} %) vs cash.")
    return v, lignes


# ---------------------------------------------------------------- liens directs
def liens(orig, dest, aller: date, retour, classe):
    cab = CLASSES[classe][1]
    gf_classe = {"eco": "economy", "premium": "premium economy",
                 "affaires": "business class", "premiere": "first class"}[classe]
    q = f"Flights to {dest} from {orig} on {aller.isoformat()}"
    if retour:
        q += f" through {retour.isoformat()}"
    q += f" {gf_classe}"
    sky_cab = {"economy": "economy", "premium_economy": "premiumeconomy",
               "business": "business", "first": "first"}[cab]
    sky = f"https://www.skyscanner.fr/transport/vols/{orig.lower()}/{dest.lower()}/{aller:%y%m%d}/"
    if retour:
        sky += f"{retour:%y%m%d}/"
    sky += f"?adultsv2=1&cabinclass={sky_cab}"
    kayak_cab = {"economy": "", "premium_economy": "/premium", "business": "/business",
                 "first": "/first"}[cab]
    kayak = f"https://www.kayak.fr/flights/{orig}-{dest}/{aller.isoformat()}"
    if retour:
        kayak += f"/{retour.isoformat()}"
    kayak += kayak_cab
    return {
        "Google Flights": "https://www.google.com/travel/flights?q=" + urllib.parse.quote(q),
        "Skyscanner": sky,
        "Kayak": kayak,
    }


# ---------------------------------------------------------------- sources API
def prix_cash_travelpayouts(orig, dest, dates, retour_offset, token):
    """Prix économie en cache Aviasales/Travelpayouts (EUR). Renvoie liste triée."""
    mois = sorted({d.strftime("%Y-%m") for d in dates})
    voulus = {d.isoformat() for d in dates}
    out = []
    for m in mois:
        p = {"origin": orig, "destination": dest, "departure_at": m, "currency": "eur",
             "sorting": "price", "limit": 1000, "one_way": "true" if retour_offset is None else "false",
             }
        # Jeton en en-tête (pas dans l'URL -> n'apparaît pas dans les logs)
        data = http_json("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?"
                         + urllib.parse.urlencode(p), headers={"X-Access-Token": token})
        for r in data.get("data", []):
            if r.get("departure_at", "")[:10] in voulus:
                out.append(r)
    return filtrer_cash(out, voulus)


def filtrer_cash(rows, voulus):
    res = []
    for r in rows:
        if r.get("departure_at", "")[:10] not in voulus:
            continue
        res.append({
            "date": r["departure_at"][:10],
            "retour": (r.get("return_at") or "")[:10],
            "prix_eur": r.get("price"),
            "compagnie": r.get("airline", "?"),
            "escales": r.get("transfers", "?"),
            "lien": "https://www.aviasales.com" + r["link"] if r.get("link") else "",
        })
    return sorted(res, key=lambda x: x["prix_eur"] or 10**9)


def places_miles_seatsaero(orig, dest, dates, classe, key):
    p = {"origin_airport": orig, "destination_airport": dest,
         "start_date": min(dates).isoformat(), "end_date": max(dates).isoformat(),
         "cabin": CLASSES[classe][1].replace("_economy", ""), "take": 500}
    data = http_json("https://seats.aero/partnerapi/search?" + urllib.parse.urlencode(p),
                     headers={"Partner-Authorization": key, "accept": "application/json"})
    return filtrer_miles(data.get("data", []), classe)


def filtrer_miles(rows, classe):
    c = CLASSES[classe][0]
    res = []
    for r in rows:
        if not r.get(f"{c}Available"):
            continue
        try:
            miles = int(str(r.get(f"{c}MileageCost", "0")).replace(",", ""))
        except ValueError:
            continue
        taxes = (r.get(f"{c}TotalTaxes") or 0) / 100  # unités mineures -> unités
        devise = r.get("TaxesCurrency") or "USD"
        taxes_eur = round(taxes * (USD_EUR if devise == "USD" else 1), 2)
        res.append({
            "date": r.get("Date"),
            "programme": r.get("Source") or (r.get("Route") or {}).get("Source", "?"),
            "miles": miles,
            "taxes_eur": taxes_eur,
            "direct": r.get(f"{c}Direct"),
            "compagnies": r.get(f"{c}Airlines", ""),
        })
    return sorted(res, key=lambda x: (x["miles"], x["taxes_eur"]))


def marque_air_senegal(compagnies: str) -> str:
    return "  ⚠ Air Sénégal (HC)" if "HC" in (compagnies or "").replace(" ", "").split(",") else ""


# ---------------------------------------------------------------- commandes
def cmd_chercher(a):
    aller = date.fromisoformat(a.aller)
    retour = date.fromisoformat(a.retour) if a.retour else None
    dates = jours(aller, a.flex)
    off = (retour - aller).days if retour else None
    print(f"\n=== {a.origine} -> {a.destination} | {a.classe} | {aller} ±{a.flex} j"
          + (f" | retour {retour}" if retour else "") + " ===")
    print("Règle : toujours vérifier que le tarif est REMBOURSABLE avant de payer.\n")

    tp = os.environ.get("TRAVELPAYOUTS_TOKEN")
    if tp and a.classe in ("eco", "premium"):
        try:
            res = prix_cash_travelpayouts(a.origine, a.destination, dates, off, tp)[:10]
            print("— Prix cash (cache Aviasales, économie, EUR) —")
            for r in res:
                print(f"  {r['date']}  {r['prix_eur']:>6} EUR  {r['compagnie']}"
                      f"  escales:{r['escales']}{marque_air_senegal(r['compagnie'])}  {r['lien']}")
            if not res:
                print("  aucun prix en cache sur ces dates")
        except Exception as e:  # réseau / clé
            print(f"  Travelpayouts indisponible : {e}")
    elif not tp:
        print("(Astuce : export TRAVELPAYOUTS_TOKEN=... pour les prix cash économie)")

    sk = os.environ.get("SEATS_AERO_KEY")
    if sk:
        try:
            res = places_miles_seatsaero(a.origine, a.destination, dates, a.classe, sk)[:15]
            print(f"\n— Places en miles ({a.classe}) —")
            for r in res:
                print(f"  {r['date']}  {r['programme']:<14} {r['miles']:>7} miles + "
                      f"{r['taxes_eur']:>7} EUR taxes  direct:{r['direct']}  {r['compagnies']}"
                      f"{marque_air_senegal(r['compagnies'])}")
                if a.cash:
                    v, _ = verdict(a.cash, r["taxes_eur"], r["miles"])
                    print(f"      -> {v} ct/mile vs cash {a.cash} EUR "
                          f"({'MILES' if v >= SEUIL_CTS_PAR_MILE else 'CASH'})")
            if not res:
                print("  aucune place en miles trouvée sur ces dates")
        except Exception as e:
            print(f"  seats.aero indisponible : {e}")
    else:
        print("(Astuce : export SEATS_AERO_KEY=... pour les places en miles)")

    print("\n— Liens directs (vérifier le prix réel + conditions de remboursement) —")
    for d in [aller] if a.flex == 0 else [aller - timedelta(days=a.flex), aller, aller + timedelta(days=a.flex)]:
        r = d + timedelta(days=off) if off is not None else None
        for nom, url in liens(a.origine, a.destination, d, r, a.classe).items():
            print(f"  [{d}] {nom:<15} {url}")

    if a.classe in ("affaires", "premiere"):
        print("\n— Départ alternatif (promos Affaires/Première fréquentes depuis ces hubs) —")
        for h in HUBS_POSITIONNEMENT:
            if h in (a.origine, a.destination):
                continue
            r = aller + timedelta(days=off) if off is not None else None
            print(f"  {h}->{a.destination} : {liens(h, a.destination, aller, r, a.classe)['Google Flights']}")
            print(f"     + vol eco {a.origine}->{h} : "
                  f"{liens(a.origine, h, aller - timedelta(days=1), None, 'eco')['Google Flights']}")
    print("\nRéductions : as-tu un code promo, voucher ou crédit en attente à utiliser sur ce vol ?\n")


def cmd_valeur(a):
    _, lignes = verdict(a.cash, a.taxes, a.miles, a.seuil, a.prix_achat_mile)
    print("\n".join(lignes))


def cmd_alerte(a):
    with open(a.fichier, encoding="utf-8") as f:
        alertes = json.load(f)
    tp, sk = os.environ.get("TRAVELPAYOUTS_TOKEN"), os.environ.get("SEATS_AERO_KEY")
    trouve = []
    for al in alertes:
        aller = date.fromisoformat(al["aller"])
        dates = jours(aller, al.get("flex", 3))
        classe = al.get("classe", "eco")
        nom = f"{al['origine']}->{al['destination']} {classe} {aller}±{al.get('flex', 3)}j"
        try:
            if tp and al.get("max_eur") and classe in ("eco", "premium"):
                for r in prix_cash_travelpayouts(al["origine"], al["destination"], dates, None, tp):
                    if r["prix_eur"] <= al["max_eur"]:
                        trouve.append(f"{nom} : {r['prix_eur']} EUR le {r['date']} ({r['compagnie']}) {r['lien']}")
                        break
            if sk and al.get("max_miles"):
                for r in places_miles_seatsaero(al["origine"], al["destination"], dates, classe, sk):
                    if r["miles"] <= al["max_miles"]:
                        trouve.append(f"{nom} : {r['miles']} miles + {r['taxes_eur']} EUR "
                                      f"({r['programme']}) le {r['date']}")
                        break
        except Exception as e:
            print(f"[erreur] {nom} : {e}", file=sys.stderr)
    for t in trouve:
        print(t)
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Vols perso : cash vs miles, toutes classes")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("chercher", help="chercher un vol")
    c.add_argument("origine", type=str.upper)
    c.add_argument("destination", type=str.upper)
    c.add_argument("aller", help="AAAA-MM-JJ")
    c.add_argument("--retour", help="AAAA-MM-JJ")
    c.add_argument("--classe", choices=CLASSES, default="eco")
    c.add_argument("--flex", type=int, default=3, help="± jours autour de la date")
    c.add_argument("--cash", type=float, help="prix cash connu (EUR) pour comparer aux miles")
    c.set_defaults(f=cmd_chercher)

    v = sub.add_parser("valeur", help="cash ou miles ?")
    v.add_argument("--cash", type=float, required=True, help="prix cash EUR")
    v.add_argument("--miles", type=int, required=True)
    v.add_argument("--taxes", type=float, default=0, help="taxes du billet prime EUR")
    v.add_argument("--seuil", type=float, default=SEUIL_CTS_PAR_MILE)
    v.add_argument("--prix-achat-mile", type=float, help="prix d'achat d'un mile en centimes EUR")
    v.set_defaults(f=cmd_valeur)

    al = sub.add_parser("alerte", help="vérifier les alertes")
    al.add_argument("--fichier", default="alertes.json")
    al.set_defaults(f=cmd_alerte)

    a = p.parse_args(argv)
    return a.f(a) or 0


if __name__ == "__main__":
    sys.exit(main())
