"""Testes do recomendador: treino, contrato de inferência e servidor local.

    cd ml && python -m unittest discover -s tests -v
"""

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
import urllib.error
import urllib.request

from recommender import inference, train

ML_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dois "gostos": quem leva camiseta leva moletom; quem leva caneca leva livro.
# O adesivo aparece uma vez só ao lado da camiseta (abaixo do min_support).
HISTORY = [
    ("u1", "tshirt"), ("u1", "hoodie"),
    ("u2", "tshirt"), ("u2", "hoodie"),
    ("u3", "tshirt"), ("u3", "hoodie"), ("u3", "sticker"),
    ("u4", "mug"), ("u4", "book"),
    ("u5", "mug"), ("u5", "book"),
    ("u6", "mug"),
]


def write_csv(directory, rows=HISTORY, header="user,product_id,quantity"):
    path = os.path.join(directory, "order_items.csv")
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\n")
        for user, product in rows:
            f.write(f"{user},{product},1\n")
    return path


class TrainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def run_train(self, out="model", **kwargs):
        args = [write_csv(self.tmp.name), os.path.join(self.tmp.name, out)]
        for key, value in kwargs.items():
            args += [f"--{key.replace('_', '-')}", str(value)]
        return train.main(args)

    def test_cosine_similarity_between_products_bought_by_the_same_users(self):
        model = self.run_train()
        # tshirt e hoodie: 3 compradores cada, 3 em comum -> 3 / sqrt(3*3) = 1.0
        self.assertEqual(model["neighbors"]["tshirt"], [["hoodie", 1.0]])
        # mug: 3 compradores, book: 2, 2 em comum -> 2 / sqrt(6)
        self.assertAlmostEqual(model["neighbors"]["book"][0][1], 2 / 6 ** 0.5, places=6)
        self.assertNotIn("sticker", model["neighbors"], "single co-purchase is below min_support")
        self.assertEqual(model["stats"], {
            "users": 6, "products": 5, "productsWithNeighbors": 4, "trainingRows": 12,
        })

    def test_min_support_one_keeps_rare_pairs(self):
        model = self.run_train(min_support=1)
        self.assertIn("sticker", dict(model["neighbors"]["tshirt"]))

    def test_package_has_the_layout_sagemaker_expects_and_is_reproducible(self):
        first = self.run_train(out="a")
        second = self.run_train(out="b")
        self.assertEqual(first["version"], second["version"])

        archives = [os.path.join(self.tmp.name, d, "model.tar.gz") for d in ("a", "b")]
        digests = []
        for path in archives:
            with open(path, "rb") as f:
                digests.append(hashlib.sha256(f.read()).hexdigest())
        self.assertEqual(digests[0], digests[1], "same data must produce the same artifact")

        with tarfile.open(archives[0]) as tar:
            self.assertEqual(sorted(tar.getnames()), ["code/inference.py", "model.json"])
            packed = json.load(tar.extractfile("model.json"))
        self.assertEqual(packed["version"], first["version"])

    def test_rejects_unexpected_header(self):
        path = write_csv(self.tmp.name, header="user_id,product,qty")
        with self.assertRaisesRegex(ValueError, "expected header"):
            train.read_history(path)


class InferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as tmp:
            train.main([write_csv(tmp), tmp])
            cls.model = inference.model_fn(tmp)

    def invoke(self, payload):
        data = inference.input_fn(json.dumps(payload).encode(), "application/json")
        body, content_type = inference.output_fn(inference.predict_fn(data, self.model))
        self.assertEqual(content_type, "application/json")
        return json.loads(body)

    def test_recommends_neighbors_and_never_what_the_user_already_owns(self):
        out = self.invoke({"productIds": ["tshirt"], "k": 5})
        self.assertEqual(out["recommendations"], [{"productId": "hoodie", "score": 1.0}])
        self.assertEqual(out["modelVersion"], self.model["version"])
        self.assertEqual(self.invoke({"productIds": ["tshirt", "hoodie"]})["recommendations"], [])

    def test_scores_add_up_across_the_history(self):
        out = self.invoke({"productIds": ["mug", "tshirt"], "k": 10})
        self.assertEqual([r["productId"] for r in out["recommendations"]], ["hoodie", "book"])

    def test_unknown_products_and_k_limit(self):
        self.assertEqual(self.invoke({"productIds": ["never-seen"]})["recommendations"], [])
        self.assertEqual(len(self.invoke({"productIds": ["mug", "tshirt"], "k": 1})["recommendations"]), 1)

    def test_input_validation(self):
        bad = [
            ("[]", "application/json"),
            ("7", "application/json"),
            ("null", "application/json"),
            ('{"productIds": "tshirt"}', "application/json"),
            ('{"productIds": [1]}', "application/json"),
            ('{"productIds": [], "k": 0}', "application/json"),
            ('{"productIds": [], "k": true}', "application/json"),
            ('{"productIds": []}', "text/csv"),
            (json.dumps({"productIds": ["x"] * 201}), "application/json"),
        ]
        for body, content_type in bad:
            with self.subTest(body=body[:40], content_type=content_type):
                with self.assertRaises(ValueError):
                    inference.input_fn(body, content_type)


class ServeTest(unittest.TestCase):
    """Sobe o serve.py de verdade e conversa por HTTP, como a API faria."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "recommender.serve", "--model-dir", self.tmp.name, "--host", "127.0.0.1", "--port", "0"],
            cwd=ML_DIR, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
        self.addCleanup(self.proc.wait, 5)
        self.addCleanup(self.proc.terminate)
        line = self.proc.stdout.readline()
        self.base = "http://" + line.strip().removeprefix("listening on ")

    def request(self, method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, json.load(res)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_answers_503_until_trained_then_picks_up_the_model_without_restart(self):
        self.assertEqual(self.request("GET", "/ping"), (200, {"status": "ok", "modelLoaded": False}))
        self.assertEqual(self.request("POST", "/invocations", {"productIds": ["tshirt"]})[0], 503)

        train.main([write_csv(self.tmp.name), self.tmp.name])
        status, body = self.request("POST", "/invocations", {"productIds": ["tshirt"]})
        self.assertEqual(status, 200)
        self.assertEqual(body["recommendations"][0]["productId"], "hoodie")
        self.assertEqual(self.request("POST", "/invocations", {"productIds": 3})[0], 400)
        self.assertEqual(self.request("GET", "/nope")[0], 404)


if __name__ == "__main__":
    unittest.main()
