import json
import math
import pathlib
import unittest

import futures_trade_math as ftm

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[2] / "test-vectors.json").read_text("utf-8"))
REL = VECTORS["tolerance"]["relative"]
ABS = VECTORS["tolerance"]["absolute"]


class TestVectors(unittest.TestCase):
    def test_shared_vectors(self):
        for case in VECTORS["cases"]:
            with self.subTest(case["id"]):
                fn = getattr(ftm, case["fn"])
                if case.get("throws"):
                    with self.assertRaises(ValueError):
                        fn(**case["args"])
                    continue
                got = fn(**case["args"])
                self.assertTrue(
                    math.isclose(got, case["expected"], rel_tol=REL, abs_tol=ABS),
                    f"{case['id']}: got {got!r}, expected {case['expected']!r}",
                )

    def test_every_public_function_has_a_vector(self):
        covered = {c["fn"] for c in VECTORS["cases"]}
        self.assertEqual(set(ftm.__all__) - covered, set())


class TestIdentities(unittest.TestCase):
    def test_win_rate_matches_effective_reward_risk(self):
        for w, l, c in [(2, 1, 0.1), (1.5, 1, 0.3), (3, 2, 0)]:
            p = ftm.break_even_win_rate(w, l, c)
            rr = ftm.effective_reward_risk(w, l, c)
            self.assertAlmostEqual(p, 1 / (1 + rr), places=12)

    def test_long_break_even_has_zero_net_pnl(self):
        e, q, fin, fout, f = 50000, 0.2, 0.0005, 0.0005, 3
        p = ftm.break_even_price("long", e, q, fin, fout, f)
        net = q * (p - e) - q * e * fin - q * p * fout - f
        self.assertAlmostEqual(net, 0, places=9)

    def test_rejects_bool_and_nan(self):
        with self.assertRaises(ValueError):
            ftm.funding_apr(True)
        with self.assertRaises(ValueError):
            ftm.round_trip_fee(float("nan"), 0.0005, 0.0005)


if __name__ == "__main__":
    unittest.main()
