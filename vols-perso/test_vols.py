import unittest
from datetime import date

import vols


class TestVols(unittest.TestCase):
    def test_cts_par_mile(self):
        self.assertEqual(vols.cts_par_mile(2400, 250, 60000), 3.58)

    def test_verdict_miles_et_achat(self):
        v, lignes = vols.verdict(2400, 250, 60000, prix_achat_mile=2.0)
        self.assertGreater(v, vols.SEUIL_CTS_PAR_MILE)
        self.assertIn("MILES", lignes[1])
        self.assertIn("1450.0 EUR", lignes[2])  # 60000*0.02 + 250

    def test_verdict_cash(self):
        _, lignes = vols.verdict(400, 150, 30000)
        self.assertIn("CASH", lignes[1])

    def test_jours(self):
        self.assertEqual(len(vols.jours(date(2026, 12, 15), 3)), 7)

    def test_liens(self):
        l = vols.liens("DSS", "CDG", date(2026, 12, 15), date(2026, 12, 22), "affaires")
        self.assertIn("/dss/cdg/261215/261222/", l["Skyscanner"])
        self.assertTrue(l["Kayak"].endswith("/2026-12-22/business"))
        self.assertIn("business%20class", l["Google Flights"])

    def test_filtrer_miles(self):
        rows = [
            {"Date": "2026-12-15", "Source": "flyingblue", "JAvailable": True,
             "JMileageCost": "55000", "JTotalTaxes": 30000, "TaxesCurrency": "EUR",
             "JDirect": True, "JAirlines": "AF"},
            {"Date": "2026-12-16", "Source": "aeroplan", "JAvailable": True,
             "JMileageCost": "45000", "JTotalTaxes": 10000, "TaxesCurrency": "USD",
             "JDirect": False, "JAirlines": "TP, HC"},
            {"Date": "2026-12-16", "Source": "united", "JAvailable": False},
        ]
        res = vols.filtrer_miles(rows, "affaires")
        self.assertEqual([r["programme"] for r in res], ["aeroplan", "flyingblue"])
        self.assertEqual(res[0]["taxes_eur"], 92.0)
        self.assertEqual(res[1]["taxes_eur"], 300.0)
        self.assertIn("Air Sénégal", vols.marque_air_senegal(res[0]["compagnies"]))

    def test_filtrer_cash(self):
        rows = [
            {"departure_at": "2026-12-15T10:00:00+00:00", "price": 520, "airline": "TK",
             "transfers": 1, "link": "/search/x"},
            {"departure_at": "2026-12-14T10:00:00+00:00", "price": 380, "airline": "AT",
             "transfers": 1},
            {"departure_at": "2026-12-30T10:00:00+00:00", "price": 100, "airline": "XX"},
        ]
        res = vols.filtrer_cash(rows, {"2026-12-14", "2026-12-15"})
        self.assertEqual([r["prix_eur"] for r in res], [380, 520])
        self.assertTrue(res[1]["lien"].startswith("https://www.aviasales.com/"))


if __name__ == "__main__":
    unittest.main()
