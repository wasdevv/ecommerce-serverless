"""Servidor local com o mesmo contrato HTTP de um container SageMaker.

    GET  /ping         saúde do container
    POST /invocations  input_fn -> predict_fn -> output_fn

No SageMaker quem faz esse papel é o servidor do container de scikit-learn;
aqui é a biblioteca padrão. A API conversa com este processo pelo mesmo JSON
que mandaria ao endpoint (RECOMMENDER_URL em vez de RECOMMENDER_ENDPOINT_NAME).

O modelo é relido quando o model.json muda: treinar de novo não exige
reiniciar o container. Sem modelo, /invocations responde 503 e a API cai no
fallback de mais vendidos.

    python -m recommender.serve --model-dir model --port 8080
"""

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from recommender import inference

MAX_BODY_BYTES = 64 * 1024


class ModelStore:
    def __init__(self, model_dir):
        self.path = os.path.join(model_dir, "model.json")
        self.model_dir = model_dir
        self.lock = threading.Lock()
        self.mtime = None
        self.model = None

    def get(self):
        try:
            mtime = os.stat(self.path).st_mtime_ns
        except FileNotFoundError:
            return None
        with self.lock:
            if mtime != self.mtime:
                self.model = inference.model_fn(self.model_dir)
                self.mtime = mtime
            return self.model


def make_handler(store):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/ping":
                return self._send(404, {"error": "not found"})
            self._send(200, {"status": "ok", "modelLoaded": store.get() is not None})

        def do_POST(self):
            if self.path != "/invocations":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                return self._send(413, {"error": "body too large"})
            model = store.get()
            if model is None:
                return self._send(503, {"error": "model not trained yet"})
            try:
                data = inference.input_fn(self.rfile.read(length), self.headers.get("Content-Type", ""))
            except ValueError as error:
                return self._send(400, {"error": str(error)})
            body, _ = inference.output_fn(inference.predict_fn(data, model))
            self._send(200, json.loads(body))

        def log_message(self, fmt, *args):
            sys.stderr.write("recommender %s\n" % (fmt % args))

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local SageMaker-compatible recommender server")
    parser.add_argument("--model-dir", default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(ModelStore(args.model_dir)))
    # A porta real (útil com --port 0 nos testes) vai para o stdout.
    print(f"listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
