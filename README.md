# ecommerce-serverless

API de e-commerce em **AWS Lambda**, com infraestrutura em **Terraform**,
CI/CD em **GitHub Actions** e observabilidade com **CloudWatch, X-Ray e
OpenTelemetry**. É um projeto **de estudo**: cada decisão está explicada, cada
garantia tem um teste que a prova, e tudo roda localmente sem conta AWS.

> **Status honesto.** Testes, lint, build do artefato Lambda, `terraform
> validate` e o plan simulado dos três ambientes passam (ver
> [O que foi verificado](#o-que-foi-verificado-e-o-que-não-foi)). O deploy
> numa conta AWS real **ainda não foi executado** — o pipeline está pronto e
> desligado até a conta ser configurada. Não chame isto de "production-ready".

## Sumário

- [O que tem aqui](#o-que-tem-aqui)
- [Arquitetura](#arquitetura)
- [Rodando localmente](#rodando-localmente)
- [Usando a API (curl)](#usando-a-api-curl)
- [Testes](#testes)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Deploy na AWS](#deploy-na-aws)
- [CI/CD](#cicd)
- [Observabilidade](#observabilidade)
- [Diagnóstico](#diagnóstico)
- [Recuperação de deploy e migrações](#recuperação-de-deploy-e-migrações)
- [Limpeza (destroy)](#limpeza-destroy)
- [Custos](#custos)
- [Cadastro no Swarm](#cadastro-no-swarm)
- [O que estudar em cada arquivo](#o-que-estudar-em-cada-arquivo)

## O que tem aqui

| Área | Conteúdo |
|---|---|
| API | Express 5 em Node.js 24: cadastro/login com JWT, catálogo paginado com cache, pedidos transacionais e idempotentes, upload por URL pré-assinada |
| Assíncrono | Transactional outbox → EventBridge (1 min) → SQS → worker idempotente com partial batch failure e DLQ |
| Dados | PostgreSQL (RDS + RDS Proxy), Valkey/Redis (ElastiCache) com fallback, S3 privado |
| IaC | 9 módulos Terraform, 3 ambientes com state separado, bootstrap de state + GitHub OIDC |
| CI/CD | Testes com Postgres/Redis reais, stack completa em docker compose, plan comentado no PR, deploy por plano salvo, migração e smoke test |
| Observabilidade | Logs JSON com correlation/trace ID e redação de dados sensíveis, X-Ray, OpenTelemetry com collector sidecar, dashboard, alarmes e consultas salvas |

```
ecommerce-serverless/
├── backend/
│   ├── src/
│   │   ├── app.js               # monta o Express (sem abrir porta)
│   │   ├── server.js            # boot HTTP local
│   │   ├── handlers/            # entradas Lambda: api, dispatcher, worker, ops
│   │   ├── api/                 # rotas, middleware, schemas Joi
│   │   ├── services/            # regras: auth, products, orders, outbox, notifications, uploads
│   │   ├── db/ cache/           # pool pg + transação, migrator, cache-aside
│   │   └── observability/       # logger pino, contexto (correlation id), OTel local
│   ├── migrations/              # SQL versionado, aplicado em ordem
│   ├── scripts/                 # migrate, seed, bootstrap-admin, local-jobs
│   └── tests/                   # Jest + supertest contra Postgres/Redis reais
├── infrastructure/terraform/
│   ├── main.tf …                # módulo raiz
│   ├── modules/                 # networking, database, cache, storage, queue, iam, lambda, apigateway, monitoring
│   ├── environments/            # dev/staging/prod.tfvars + backend.hcl.example
│   ├── bootstrap/               # bucket de state + OIDC (roda uma vez)
│   └── tests/plan.tftest.hcl    # plan dos 3 ambientes com provider simulado
├── monitoring/                  # collector OTel, dashboard (template), consultas Logs Insights
├── scripts/                     # build-lambda.sh, invoke-artifact.sh, smoke.mjs
├── docs/                        # openapi.yaml, architecture.md, decisions.md, costs.md
└── docker-compose.yml
```

## Arquitetura

```mermaid
flowchart LR
  client([Cliente]) -->|HTTPS| apigw[API Gateway HTTP API]
  apigw --> api[Lambda api]
  api --> proxy[RDS Proxy] --> rds[(PostgreSQL)]
  api --> redis[(Valkey/Redis)]
  api -.->|presigned POST| s3[(S3 privado)]
  sched[EventBridge 1 min] --> disp[Lambda dispatcher]
  disp --> proxy
  disp --> sqs[[SQS]] --> worker[Lambda worker] --> proxy
  sqs -.-> dlq[[DLQ]]
```

Diagramas completos, fluxo de um pedido e tabela de garantias:
[docs/architecture.md](docs/architecture.md). Por que cada escolha (NAT vs
endpoints, RDS Proxy, outbox, Valkey, sidecar na Lambda…):
[docs/decisions.md](docs/decisions.md).

## Rodando localmente

### Pré-requisitos

| Ferramenta | Versão usada | Para quê |
|---|---|---|
| Docker + Compose v2 | 24+ | stack local |
| Node.js | 24 (`.nvmrc`) | rodar testes/scripts fora do container |
| Terraform | ≥ 1.11 (CI usa 1.13.4) | só para a parte de infraestrutura |
| AWS CLI | v2 | só para deploy manual |

### Subindo

```bash
git clone https://github.com/wasdevv/ecommerce-serverless.git
cd ecommerce-serverless

docker compose up -d --build --wait     # api, postgres, redis, otel-collector, sqs, s3
docker compose run --rm api npm run migrate
docker compose run --rm api npm run seed  # 5 produtos fictícios
docker compose up -d jobs               # dispatcher da outbox + worker (simula EventBridge + SQS)

curl -s localhost:3000/api/v1/health    # {"status":"ok"}
```

O que cada serviço do compose representa na AWS:

| Compose | AWS |
|---|---|
| `api` | Lambda `api` atrás do API Gateway |
| `jobs` | EventBridge → Lambda `dispatcher` + SQS → Lambda `worker` |
| `postgres` | RDS PostgreSQL (+ Proxy) |
| `redis` | ElastiCache |
| `sqs` (ElasticMQ) | SQS + DLQ (mesma política: 5 tentativas) |
| `s3` (MinIO) | bucket de uploads |
| `otel-collector` | collector OpenTelemetry — o **sidecar** |

### Administrador local

Não existe usuário admin padrão nem senha versionada. Crie um:

```bash
docker compose run --rm -e ADMIN_EMAIL=admin@example.test \
  -e ADMIN_PASSWORD='uma-senha-longa-sua' api npm run bootstrap-admin
```

## Usando a API (curl)

Contrato completo: [docs/openapi.yaml](docs/openapi.yaml) (abra no
[Swagger Editor](https://editor.swagger.io/)). Dinheiro sempre em **centavos**,
moeda única **BRL**.

```bash
API=http://localhost:3000/api/v1

# cadastro e login
curl -s -X POST $API/auth/register -H 'content-type: application/json' \
  -d '{"email":"ana@example.test","password":"senha-segura-123"}'
TOKEN=$(curl -s -X POST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@example.test","password":"senha-segura-123"}' | jq -r .data.accessToken)

# catálogo (repita e veja o header X-Cache passar de miss para hit)
curl -si "$API/products?page=1&pageSize=5" | grep -i x-cache
PRODUCT=$(curl -s "$API/products" | jq -r '.data[0].id')

# pedido — Idempotency-Key é obrigatória
KEY=$(uuidgen)
curl -si -X POST $API/orders -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H "idempotency-key: $KEY" \
  -H 'x-correlation-id: meu-primeiro-pedido' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT\",\"quantity\":1}]}"
# repita o MESMO comando: 200 + "Idempotent-Replayed: true", mesmo pedido, estoque intacto
# mude a quantidade com a mesma KEY: 409 idempotency_key_reused

curl -s $API/orders -H "authorization: Bearer $TOKEN" | jq

# upload: peça o formulário assinado e envie o arquivo direto ao S3/MinIO
curl -s -X POST $API/uploads/presign -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"contentType":"image/png","sizeBytes":2048}' > presign.json
args=$(jq -r '.data.fields | to_entries[] | "-F \(.key)=\(.value)"' presign.json)
curl -s -o /dev/null -w '%{http_code}\n' $args -F file=@foto.png "$(jq -r .data.url presign.json)"   # 204
```

Alguns segundos depois do pedido, o worker registra a notificação — e o mesmo
correlation ID aparece nos logs da API e do worker:

```bash
docker compose logs jobs | grep meu-primeiro-pedido
docker compose exec postgres psql -U ecommerce -c 'select * from notifications'
```

Formato de erro (o mesmo em toda a API; 500 nunca leva detalhe interno):

```json
{ "error": { "code": "insufficient_stock", "message": "Insufficient stock",
             "correlationId": "meu-primeiro-pedido", "details": { "productId": "…", "available": 0 } } }
```

## Testes

```bash
docker compose up -d --wait postgres redis
docker compose exec postgres createdb -U ecommerce ecommerce_test
cd backend
npm ci
npm run lint
TEST_DATABASE_URL=postgres://ecommerce:ecommerce@localhost:5432/ecommerce_test \
TEST_REDIS_URL=redis://localhost:6379/15 \
npm run test:coverage
```

Os testes usam **PostgreSQL e Redis reais**, de propósito: o que mais importa
aqui (lock de linha, constraint, transação, `SKIP LOCKED`, Redis caindo) não
existe num mock. O único dublê é o cliente SQS no teste da outbox. O Jest
falha abaixo de **80%** em linhas, branches, funções e statements de `src/`
(handlers incluídos).

Alguns testes que valem a leitura:

- `orders.test.js` — 4 compradores simultâneos para 1 unidade: exatamente um 201; 3 retries concorrentes com a mesma chave viram um pedido só.
- `jobs.test.js` — SQS fora do ar depois do commit: o evento fica na outbox e é publicado quando volta; reentrega não duplica a notificação; mensagem inválida falha sozinha no lote.
- `products.test.js` — Redis numa porta morta e o catálogo continua respondendo.
- `observability.test.js` — 500 sem stack nem mensagem interna, mas com o correlation ID que acha a linha de log; nenhum password/token/email nos logs.
- `handlers.test.js` — o handler Lambda recebendo eventos no formato real do API Gateway HTTP API.

Infraestrutura:

```bash
bash scripts/build-lambda.sh        # build/function.zip + build/layer.zip (determinístico)
bash scripts/invoke-artifact.sh     # extrai os zips como a Lambda faz e invoca o handler
cd infrastructure/terraform
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
terraform test                      # plan de dev/staging/prod com provider AWS simulado
```

`terraform test` usa `mock_provider`: prova que a configuração resolve nos três
perfis, que prod sem Multi-AZ é **recusado** e que ambiente inválido é recusado.
Não prova que a AWS aceita os recursos — isso só um plan/apply real prova.

## Variáveis de ambiente

| Variável | Local | Lambda | Descrição |
|---|---|---|---|
| `DATABASE_URL` | ✓ | | URL completa do PostgreSQL |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSL` | | ✓ | Endpoint do RDS Proxy (TLS) |
| `DB_SECRET_ARN` | | ✓ | Segredo do RDS com `username`/`password` |
| `DB_POOL_MAX` | 10 | 2 | Conexões por processo |
| `REDIS_URL`, `REDIS_TLS` | ✓ | ✓ (`rediss://`) | Cache; ausente = sem cache |
| `CACHE_TTL_SECONDS` | 60 | 60 | TTL das entradas |
| `JWT_SECRET` | ✓ | | Chave HS256 (só local) |
| `JWT_SECRET_ARN` | | ✓ | Chave HS256 no Secrets Manager |
| `JWT_EXPIRES_IN` | 1h | 1h | Validade do token |
| `ORDER_EVENTS_QUEUE_URL` | ✓ | ✓ | Fila de eventos |
| `UPLOADS_BUCKET` | ✓ | ✓ | Bucket de uploads |
| `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS` | 5 MiB, 300 | idem | Limites do upload |
| `AWS_ENDPOINT_URL_SQS`, `AWS_ENDPOINT_URL_S3` | ✓ | | Emuladores locais |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ✓ | | Liga o SDK OTel local (collector) |
| `LOG_LEVEL` | info | info | Nível do pino |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | script | | Bootstrap de admin local |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_SECRET_ARN` | | ops | Bootstrap de admin na AWS |

`.env.example` tem os valores locais. Nenhum `.env` real é versionado.

## Deploy na AWS

> Custa dinheiro a partir do primeiro minuto (~US$ 0,12/h no `dev`). Leia
> [Custos](#custos) e crie um AWS Budget antes.

### 1. Bootstrap (uma vez, com credencial de administrador)

Cria o bucket do state remoto e os roles que o GitHub Actions assume via
**OIDC** — nenhuma chave de acesso fica guardada no GitHub.

```bash
cd infrastructure/terraform/bootstrap
terraform init
terraform apply -var github_repository=<owner>/ecommerce-serverless
terraform output
```

O state do bootstrap fica local (`terraform.tfstate`, ignorado pelo git).
Guarde-o com cuidado: ele descreve o bucket de state e os roles de deploy.

### 2. Deploy manual (de uma máquina)

```bash
bash scripts/build-lambda.sh
cd infrastructure/terraform
cp environments/backend.hcl.example environments/dev.backend.hcl   # preencha bucket/região
terraform init -backend-config=environments/dev.backend.hcl
terraform plan -var-file=environments/dev.tfvars -out=tfplan
terraform apply tfplan

OPS=$(terraform output -raw ops_function_name)
aws lambda invoke --function-name $OPS --cli-binary-format raw-in-base64-out \
  --payload '{"action":"migrate"}' /dev/stdout
aws lambda invoke --function-name $OPS --cli-binary-format raw-in-base64-out \
  --payload '{"action":"bootstrap-admin"}' /dev/stdout
# senha do admin: só no Secrets Manager, nunca em output
aws secretsmanager get-secret-value --secret-id "$(terraform output -raw admin_password_secret_arn)" \
  --query SecretString --output text

node ../../scripts/smoke.mjs "$(terraform output -raw api_endpoint)"
```

Cada ambiente usa um `key` diferente no bucket → **state isolado**, e também
separado do state de qualquer outro projeto na mesma conta.

### 3. Deploy pelo GitHub Actions

No repositório, em **Settings → Secrets and variables → Actions → Variables**:

| Variável (repositório) | Valor |
|---|---|
| `AWS_REGION` | ex.: `us-east-1` |
| `TF_STATE_BUCKET` | output `state_bucket` do bootstrap |
| `AWS_PLAN_ROLE_ARN` | output `plan_role_arn` |
| `AWS_DEPLOY_ENABLED` | `true` (liga os jobs de deploy) |

Em **Settings → Environments**, crie `dev`, `staging` e `prod`, cada um com a
variável `AWS_DEPLOY_ROLE_ARN` (output `deploy_role_arns`). Em `prod`, marque
**Required reviewers** — o role de prod só é assumível por um job que declarou
`environment: prod`, então a aprovação é obrigatória de fato.

Slack é opcional: crie o secret `SLACK_WEBHOOK_URL` se quiser a notificação;
sem ele o passo é pulado, e se o Slack falhar o deploy continua válido.

## CI/CD

```mermaid
flowchart LR
  pr[Pull request] --> t[tests.yml<br/>lint · jest+cobertura · build · invoke do zip<br/>compose + smoke · terraform fmt/validate/test · docs]
  pr --> p[terraform-plan.yml<br/>plan real × 3 ambientes<br/>resumo sanitizado no PR]
  main[push main] --> c[checks = tests.yml] --> dev[deploy dev<br/>plan salvo → apply → migrate → smoke]
  dev --> prod[deploy prod<br/>aprovação manual no Environment]
```

- **PR nunca aplica infraestrutura.** O role de plan é `ReadOnlyAccess`, e PR de fork não recebe credencial nenhuma — o job de plan aparece como pulado, com o motivo no resumo.
- **Sem AWS configurada**, os checks locais rodam e passam de verdade; os jobs remotos aparecem como *skipped* com a razão no resumo. Nenhum check verde finge um deploy.
- **Deploy serializado por ambiente** (`concurrency` sem cancelamento: um apply nunca é interrompido no meio).
- O plano aplicado é o **plano salvo** no mesmo job, a partir dos artefatos gerados e testados em `checks`.
- O comentário do plan no PR lista só ações e endereços de recurso, nunca valores.

## Observabilidade

**Logs** — uma linha JSON por requisição:

```json
{"level":"info","time":"2026-10-11T02:28:02.237Z","service":"ecommerce-api",
 "correlationId":"7b0753ef-…","traceId":"6acaf49a…","method":"POST",
 "route":"/api/v1/orders/","status":200,"durationMs":4.3,"msg":"request completed"}
```

`route` é o template (`/orders/:id`), não a URL com IDs. Corpo, query string e
headers não são logados; `password`, `token`, `authorization`, `email` e
`secret` são redigidos pelo logger mesmo se alguém logar por engano.

**Correlation ID** — envie `X-Correlation-Id` (ou receba um gerado). Ele vai
para a outbox, vira atributo da mensagem SQS e volta ao contexto do worker.
Na AWS, a consulta salva `trace-correlation-id` no Logs Insights mostra a
requisição, a publicação e o processamento numa linha do tempo.

**Traces** — localmente, o SDK OpenTelemetry instrumenta HTTP, Express, pg,
ioredis e AWS SDK e exporta para o collector (veja os spans com
`docker compose logs otel-collector`). Na Lambda, X-Ray *active tracing* vem
ligado; spans de pg/Redis dentro da Lambda exigem a layer OpenTelemetry
(`adot_layer_arn`). Por que o "sidecar" é um container no compose e uma
*extension* na Lambda: [docs/architecture.md](docs/architecture.md#observabilidade-e-o-sidecar).

**Dashboard e alarmes** (`monitoring/`, aplicados pelo Terraform): tráfego,
latência p50/p95/p99, 4xx/5xx, erros e throttles por função, fila e DLQ.
Alarmes: 5xx, latência p95, erros/throttles de cada Lambda, **qualquer
mensagem na DLQ**, mensagem com mais de 5 min na fila. Defina `alarm_email`
para receber por email (confirme a assinatura do SNS).

## Diagnóstico

| Sintoma | Onde olhar |
|---|---|
| Cliente reporta erro 500 | Peça o `correlationId` da resposta → Logs Insights `trace-correlation-id` |
| Pedido criado mas sem notificação | `outbox_events` com `published_at IS NULL` e `last_error` (dispatcher); depois log do worker e DLQ |
| Alarme de DLQ | Leia a mensagem no console do SQS (`order-events-dlq`), corrija a causa, use *Start DLQ redrive* |
| Latência alta | Dashboard → p95 por função; X-Ray → service map; `slowest-routes.query` |
| `X-Cache: miss` sempre | Redis inacessível: log `cache unavailable, falling back to database` (a API segue funcionando) |
| Timeout conectando no banco | SG do Proxy só aceita o SG das Lambdas; Proxy exige TLS (`DB_SSL=true`) |
| `password authentication failed` depois de dias funcionando | Rotação automática da senha do RDS (a cada 7 dias por padrão): a Lambda leu o segredo no cold start e guardou a senha antiga. Contorno imediato: forçar novos ambientes de execução (ex.: novo deploy ou `aws lambda update-function-configuration` mudando uma variável). Correção definitiva: IAM auth no RDS Proxy — ver [decisions.md](docs/decisions.md#segredos-fora-do-state-do-terraform) |
| Lambda sem acesso a SQS/Secrets | Rota da sub-rede privada para o NAT; IAM do role da função |

## Recuperação de deploy e migrações

- **Código quebrado em produção:** reverta o commit em `main` (`git revert`) e deixe o pipeline aplicar. O Terraform publica o zip anterior.
- **Migrações só avançam.** Reverter o código **não** desfaz schema. Por isso, toda migração deve ser compatível com o código anterior (adicione colunas como opcionais, remova só depois que nenhum código usa). Para desfazer, escreva uma migração nova.
- **Apply falhou no meio:** rode o workflow de novo — o Terraform retoma do state. O lock (`.tflock` no S3) impede dois applies simultâneos; um lock órfão sai com `terraform force-unlock <id>` depois de confirmar que nenhum job está rodando.
- **Banco:** backups automáticos (1 dia no dev, 7 no prod) e snapshot final no destroy de prod. Restauração = nova instância a partir do snapshot/PITR, depois aponte o Proxy.

## Limpeza (destroy)

```bash
cd infrastructure/terraform
terraform destroy -var-file=environments/dev.tfvars
```

- Em **prod**, `deletion_protection` do RDS impede o destroy: desligue com `db_deletion_protection = false`, aplique, e então destrua. Um snapshot final é criado.
- Segredos de prod ficam 30 dias em janela de recuperação (dev/staging são apagados na hora).
- O bucket de uploads só é esvaziado automaticamente em dev (`force_destroy`).
- O **bootstrap** fica de pé (bucket com `prevent_destroy`). Para remover tudo, esvazie o bucket de state, remova o `lifecycle` e rode `terraform destroy` em `bootstrap/`.
- Confira no Cost Explorer, no dia seguinte, que nada ficou cobrando.

## Custos

Estimativa datada (us-east-1, 10/10/2026, **não é fatura**). Os preços
unitários vêm de uma tabela de referência, **não** de consulta à AWS Pricing
Calculator — confirme lá antes do primeiro apply:
**dev ≈ US$ 90/mês (≈ US$ 0,12/h)**, **prod ≈ US$ 200/mês**. O que domina é o
custo fixo de NAT, RDS Proxy, RDS e ElastiCache — não as Lambdas. Detalhamento,
pressupostos e como estudar gastando centavos: [docs/costs.md](docs/costs.md).

## Cadastro no Swarm

Este repositório é registrado no [Swarm](https://github.com/wasdevv/swarm)
(ambiente local de agentes) pelo fluxo normal de projetos: **Projects → New**,
com `repo_path` apontando para o clone local e `default_branch = main`. Para os
botões de check/preview do Swarm, sugestão:

- **Check command:** `cd backend && npm run lint && npm test`
- **Preview command:** `cd backend && npm start` (usa `PORT` do Swarm)

## O que estudar em cada arquivo

| Conceito | Arquivo |
|---|---|
| Mesmo app local e na Lambda | `backend/src/app.js`, `server.js`, `handlers/api.js` |
| Transação, lock e idempotência | `backend/src/services/orders.js` |
| Transactional outbox | `backend/src/services/outbox.js`, `handlers/dispatcher.js` |
| Consumidor idempotente + partial batch | `backend/src/services/notifications.js`, `handlers/worker.js` |
| Cache que não derruba a API | `backend/src/cache/cache.js` |
| Upload seguro direto ao S3 | `backend/src/services/uploads.js` |
| Logs estruturados e correlação | `backend/src/observability/` |
| Segredos fora do state | `infrastructure/terraform/main.tf` (`ephemeral`, `secret_string_wo`) |
| IAM mínimo por função | `infrastructure/terraform/modules/iam/main.tf` |
| OIDC GitHub → AWS | `infrastructure/terraform/bootstrap/main.tf` |
| Guardas de ambiente | `check "prod_is_multi_az"` em `main.tf`, `tests/plan.tftest.hcl` |
| Pipeline | `.github/workflows/` |

Referência dos módulos (gerada por `terraform-docs`):
[infrastructure/terraform/README.md](infrastructure/terraform/README.md) e um
README por módulo em `infrastructure/terraform/modules/*/`.

## O que foi verificado e o que não foi

| Item | Situação |
|---|---|
| `npm ci`, lint, 59 testes, cobertura ≥ 80% nas 4 métricas | ✅ verificado localmente (Node 24.21, PostgreSQL 18, Redis 7.4) |
| Build do zip + invoke do handler com evento API Gateway | ✅ verificado |
| Smoke test contra a API local | ✅ verificado |
| `terraform fmt`, `validate`, `test` (plan simulado × 3 ambientes) | ✅ verificado (Terraform 1.16.5, AWS provider 6.68) |
| Build da imagem Docker + `docker compose` completo + smoke + evento chegando ao worker com o mesmo correlation ID + spans no collector | ✅ verificado no CI (job `compose`) |
| `terraform plan`/`apply` real, migração e smoke na AWS | ❌ não executado — exige conta AWS configurada |
| Upload: conteúdo da URL assinada (chave no prefixo do usuário, tipo, tamanho máximo, validade) | ✅ verificado nos testes, decodificando a policy assinada |
| Upload: envio real de um arquivo ao bucket (MinIO local ou S3) usando essa URL | ❌ não executado — o passo `curl -F file=@…` da seção de API está documentado, mas não foi rodado |
| Traces no X-Ray / layer OpenTelemetry na Lambda | ❌ não verificado em conta real |
| Preços da estimativa de custos | ⚠️ tabela de referência, não consultada na AWS Pricing Calculator |

## Licença

MIT — veja [LICENSE](LICENSE).
