"""Handler de inferência no contrato do container SageMaker (scikit-learn).

O container chama, nesta ordem: model_fn uma vez no boot, e input_fn ->
predict_fn -> output_fn a cada requisição em POST /invocations. Este arquivo
vai dentro do model.tar.gz em code/inference.py e não importa nada além da
biblioteca padrão: o mesmo código roda no SageMaker, no serve.py local e nos
testes.

Contrato:
  requisição  {"productIds": ["<uuid>", ...], "k": 10}
  resposta    {"recommendations": [{"productId": "<uuid>", "score": 0.83}], "modelVersion": "..."}
"""

import json
import os

MAX_INPUT_ITEMS = 200
MAX_K = 100


def model_fn(model_dir):
    with open(os.path.join(model_dir, "model.json"), encoding="utf-8") as f:
        model = json.load(f)
    if not isinstance(model, dict) or not isinstance(model.get("neighbors"), dict):
        raise ValueError("model.json has no neighbors table")
    return model


def input_fn(body, content_type="application/json"):
    if content_type.split(";")[0].strip() != "application/json":
        raise ValueError(f"unsupported content type: {content_type}")
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8")
    data = json.loads(body)
    # json.loads aceita "[]", "7" e "null": só um objeto é requisição válida.
    if not isinstance(data, dict):
        raise ValueError("request body must be a JSON object")

    ids = data.get("productIds")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise ValueError("productIds must be a list of strings")
    if len(ids) > MAX_INPUT_ITEMS:
        raise ValueError(f"productIds accepts at most {MAX_INPUT_ITEMS} items")

    k = data.get("k", 10)
    if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= MAX_K:
        raise ValueError(f"k must be an integer between 1 and {MAX_K}")
    return {"productIds": ids, "k": k}


def recommend(model, product_ids, k):
    """Soma a similaridade de cada produto do histórico com seus vizinhos.

    Produto que o usuário já comprou não é recomendado. Empate desempata pelo
    id, para a mesma entrada dar sempre a mesma saída.
    """
    owned = set(product_ids)
    scores = {}
    for pid in owned:
        for neighbor, similarity in model["neighbors"].get(pid, []):
            if neighbor not in owned:
                scores[neighbor] = scores.get(neighbor, 0.0) + similarity
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:k]
    return [{"productId": pid, "score": round(score, 6)} for pid, score in ranked]


def predict_fn(data, model):
    return {
        "recommendations": recommend(model, data["productIds"], data["k"]),
        "modelVersion": model.get("version"),
    }


def output_fn(prediction, accept="application/json"):
    return json.dumps(prediction), "application/json"
