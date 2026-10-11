"""Treina o recomendador item-a-item a partir do histórico de compras.

Filtragem colaborativa por similaridade de cosseno entre produtos: dois
produtos são parecidos quando os mesmos clientes compram os dois. Só a
biblioteca padrão — o modelo é uma tabela de vizinhos, não uma rede neural.

    python -m recommender.train data/order_items.csv model/
    ... | python -m recommender.train - model/      (CSV pelo stdin)

Entrada: CSV com cabeçalho user,product_id,quantity (o que o export da API
gera; user já vem anonimizado). Saída em OUTPUT_DIR:
    model.json          tabela de vizinhos + metadados
    code/inference.py   handler que o container SageMaker carrega
    model.tar.gz        os dois acima, no formato que o SageMaker baixa do S3

Determinístico: os mesmos dados geram o mesmo model.tar.gz, byte a byte.
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import shutil
import sys
import tarfile
from collections import defaultdict
from itertools import combinations

HEADER = ["user", "product_id", "quantity"]
INFERENCE_SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inference.py")


def read_history(path):
    """Devolve {user: set(product_id)}. Quantidade não pesa: comprar 3
    canecas não torna a caneca 3x mais parecida com o resto do carrinho."""
    baskets = defaultdict(set)
    rows = 0
    f = sys.stdin if path == "-" else open(path, newline="", encoding="utf-8")
    with f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header != HEADER:
            raise ValueError(f"expected header {','.join(HEADER)}, got {header}")
        for line, row in enumerate(reader, start=2):
            if len(row) != 3:
                raise ValueError(f"line {line}: expected 3 columns")
            user, product_id, quantity = row
            if int(quantity) < 1:
                raise ValueError(f"line {line}: quantity must be positive")
            baskets[user].add(product_id)
            rows += 1
    return baskets, rows


def train(baskets, min_support=2, top_k=20):
    """Cosseno entre produtos: co(i,j) / sqrt(n_i * n_j).

    n_i = clientes que compraram i; co(i,j) = clientes que compraram os dois.
    min_support descarta pares vistos juntos por poucos clientes: com dados
    escassos, uma única coincidência viraria similaridade 1.0.
    """
    buyers = defaultdict(int)
    together = defaultdict(int)
    for items in baskets.values():
        for item in items:
            buyers[item] += 1
        for a, b in combinations(sorted(items), 2):
            together[(a, b)] += 1

    neighbors = defaultdict(list)
    for (a, b), count in together.items():
        if count < min_support:
            continue
        similarity = count / math.sqrt(buyers[a] * buyers[b])
        neighbors[a].append((b, similarity))
        neighbors[b].append((a, similarity))

    table = {
        item: [[pid, round(sim, 6)] for pid, sim in sorted(pairs, key=lambda p: (-p[1], p[0]))[:top_k]]
        for item, pairs in sorted(neighbors.items())
    }
    return {
        "algorithm": "item-item-cosine",
        "params": {"minSupport": min_support, "topK": top_k},
        "stats": {"users": len(baskets), "products": len(buyers), "productsWithNeighbors": len(table)},
        "neighbors": table,
    }


def _tar_add(tar, name, data):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = 0
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(data))


def package(output_dir, model_bytes):
    """model.tar.gz com mtime zerado no tar e no gzip: hash estável."""
    with open(INFERENCE_SOURCE, "rb") as f:
        code = f.read()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        _tar_add(tar, "model.json", model_bytes)
        _tar_add(tar, "code/inference.py", code)
    path = os.path.join(output_dir, "model.tar.gz")
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as gz:
        gz.write(buffer.getvalue())
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input_csv")
    parser.add_argument("output_dir")
    parser.add_argument("--min-support", type=int, default=2)
    parser.add_argument("--top-k", type=int, default=20)
    args = parser.parse_args(argv)

    baskets, rows = read_history(args.input_csv)
    model = train(baskets, min_support=args.min_support, top_k=args.top_k)
    model["stats"]["trainingRows"] = rows
    # A versão é o hash do próprio conteúdo: identifica o modelo sem relógio.
    body = json.dumps(model, sort_keys=True, separators=(",", ":"))
    model["version"] = hashlib.sha256(body.encode()).hexdigest()[:12]
    model_bytes = json.dumps(model, sort_keys=True, indent=1).encode()

    os.makedirs(os.path.join(args.output_dir, "code"), exist_ok=True)
    tmp = os.path.join(args.output_dir, "model.json.tmp")
    with open(tmp, "wb") as f:
        f.write(model_bytes)
    shutil.copyfile(INFERENCE_SOURCE, os.path.join(args.output_dir, "code", "inference.py"))
    archive = package(args.output_dir, model_bytes)
    # Rename atômico por último: o serve.py nunca lê um model.json pela metade.
    os.replace(tmp, os.path.join(args.output_dir, "model.json"))

    stats = model["stats"]
    print(
        f"model {model['version']}: {stats['users']} users, {stats['products']} products, "
        f"{stats['productsWithNeighbors']} with neighbors -> {archive}"
    )
    return model


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
