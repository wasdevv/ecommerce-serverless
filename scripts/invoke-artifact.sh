#!/usr/bin/env bash
# Prova que o ZIP gerado (e não o código-fonte) funciona: extrai layer e
# função como a Lambda faz (/opt/nodejs/node_modules + /var/task) e invoca o
# handler da API com um evento HTTP API 2.0 representativo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ROOT/build/layer.zip" -d "$WORK/opt"
unzip -q "$ROOT/build/function.zip" -d "$WORK/task"

cd "$WORK/task"
NODE_PATH="$WORK/opt/nodejs/node_modules" JWT_SECRET="${JWT_SECRET:-artifact-check}" LOG_LEVEL=silent node -e '
const { handler } = require("./src/handlers/api");
const event = {
  version: "2.0", routeKey: "$default", rawPath: "/api/v1/health", rawQueryString: "",
  headers: { host: "example.execute-api.us-east-1.amazonaws.com" },
  requestContext: { http: { method: "GET", path: "/api/v1/health", protocol: "HTTP/1.1", sourceIp: "203.0.113.1", userAgent: "artifact-check" },
    requestId: "artifact", routeKey: "$default", stage: "$default", timeEpoch: Date.now() },
  isBase64Encoded: false,
};
handler(event, { getRemainingTimeInMillis: () => 3000 }).then((res) => {
  console.log(res.statusCode, res.body);
  process.exit(res.statusCode === 200 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
'
