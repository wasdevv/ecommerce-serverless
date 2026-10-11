#!/usr/bin/env bash
# Gera os artefatos da Lambda em build/:
#   build/layer.zip     -> nodejs/node_modules (dependências de produção, sem OTel)
#   build/function.zip  -> src/ + migrations/ (código próprio, sem node_modules)
# Um zip de código para as quatro funções (api, dispatcher, worker, ops): o que
# muda entre elas é só o handler. Dependências ficam só na layer, não nos dois.
#
# Determinístico: datas fixas e ordem estável, para que o hash (source_code_hash
# no Terraform) só mude quando o conteúdo mudar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
OUT="$ROOT/build"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

rm -rf "$OUT" && mkdir -p "$OUT"

# Layer: deps de produção para linux/arm64 (Graviton). As deps são JS puro —
# bcryptjs em vez de bcrypt justamente para não depender de binário nativo.
mkdir -p "$STAGE/layer/nodejs"
cp "$BACKEND/package.json" "$BACKEND/package-lock.json" "$STAGE/layer/nodejs/"
(cd "$STAGE/layer/nodejs" && npm ci --omit=dev --omit=optional --ignore-scripts --cpu=arm64 --os=linux --no-audit --no-fund >/dev/null)
rm "$STAGE/layer/nodejs/package.json" "$STAGE/layer/nodejs/package-lock.json"

mkdir -p "$STAGE/function"
cp -R "$BACKEND/src" "$BACKEND/migrations" "$STAGE/function/"
# Boot local e tracing local não rodam na Lambda.
rm "$STAGE/function/src/server.js" "$STAGE/function/src/observability/tracing.js"

for name in layer function; do
  (cd "$STAGE/$name" && find . -exec touch -h -d '2020-01-01T00:00:00Z' {} + \
    && find . -type f | LC_ALL=C sort | zip -X -q -D "$OUT/$name.zip" -@)
done

ls -l "$OUT"
sha256sum "$OUT"/*.zip
