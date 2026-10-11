#!/usr/bin/env bash
# Ciclo de treino na AWS, a partir da sua máquina (credenciais de quem opera
# o ambiente, não do CI):
#   1. Lambda ops exporta o histórico anonimizado para s3://<ml>/training/
#   2. baixa o CSV e treina localmente (só biblioteca padrão do Python)
#   3. publica o model.tar.gz em s3://<ml>/models/<versão>/
# Depois é só aplicar o Terraform com recommender_model_version=<versão>.
#
#   scripts/publish-model.sh dev
#
# Requer o ambiente aplicado com enable_recommender = true. NÃO verificado
# numa conta AWS neste repositório.
set -euo pipefail

ENV="${1:?usage: publish-model.sh <dev|staging|prod>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="$ROOT/infrastructure/terraform"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ops="$(terraform -chdir="$TF" output -raw ops_function_name)"
bucket="$(terraform -chdir="$TF" output -raw ml_bucket 2>/dev/null || true)"
if [ -z "$bucket" ] || [ "$bucket" = "null" ]; then
  echo "ml_bucket vazio: aplique o ambiente $ENV com enable_recommender = true primeiro" >&2
  exit 1
fi

aws lambda invoke --function-name "$ops" --cli-binary-format raw-in-base64-out \
  --payload '{"action":"export-training-data"}' "$WORK/export.json" > "$WORK/invoke.json"
if grep -q FunctionError "$WORK/invoke.json"; then cat "$WORK/export.json" >&2; exit 1; fi
uri="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uri"])' "$WORK/export.json")"
echo "export: $uri"

aws s3 cp --only-show-errors "$uri" "$WORK/order_items.csv"
(cd "$ROOT/ml" && python3 -m recommender.train "$WORK/order_items.csv" "$WORK/model")
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$WORK/model/model.json")"

aws s3 cp --only-show-errors "$WORK/model/model.tar.gz" "s3://$bucket/models/$version/model.tar.gz"
echo
echo "publicado: s3://$bucket/models/$version/model.tar.gz"
echo "próximo passo: recommender_model_version = \"$version\" em environments/$ENV.tfvars e terraform apply"
