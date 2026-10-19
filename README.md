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
- [Recomendação de produtos (ML)](#recomendação-de-produtos-ml)
- [Assistente de compras (LangGraph + RAG + evals)](#assistente-de-compras-langgraph--rag--evals)
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
| IaC | 10 módulos Terraform, 3 ambientes com state separado, bootstrap de state + GitHub OIDC |
| CI/CD | Testes com Postgres/Redis reais, stack completa em docker compose, plan comentado no PR, deploy por plano salvo, migração e smoke test |
| ML | Recomendação de produtos por filtragem colaborativa treinada no histórico de compras, servida por endpoint **SageMaker Serverless** e chamada pela Lambda da API, com fallback para os mais vendidos |
| IA generativa | Assistente de compras: RAG híbrido (busca textual do PostgreSQL + embeddings do Titan) como Retriever do **LangChain**, orquestrado num grafo **LangGraph**, gerando com **Claude** e medido por **evals** (recuperação no CI, LLM-as-a-judge sob demanda) |
| Observabilidade | Logs JSON com correlation/trace ID e redação de dados sensíveis, X-Ray, OpenTelemetry com collector sidecar, dashboard, alarmes e consultas salvas |

```
ecommerce-serverless/
├── backend/
│   ├── src/
│   │   ├── app.js               # monta o Express (sem abrir porta)
│   │   ├── server.js            # boot HTTP local
│   │   ├── handlers/            # entradas Lambda: api, dispatcher, worker, ops
│   │   ├── api/                 # rotas, middleware, schemas Joi
│   │   ├── services/            # regras: auth, products, orders, outbox, notifications, uploads, recommendations
│   │   ├── recommender/         # cliente do modelo: SageMaker (AWS) ou HTTP (local)
│   │   ├── assistant/           # RAG: embeddings, retriever (LangChain), grafo (LangGraph), Claude
│   │   ├── db/ cache/           # pool pg + transação, migrator, cache-aside
│   │   └── observability/       # logger pino, contexto (correlation id), OTel local
│   ├── migrations/              # SQL versionado, aplicado em ordem
│   ├── scripts/                 # migrate, seed, seed-history, export-training-data, index-products, bootstrap-admin, local-jobs
│   ├── evals/                   # dataset + catálogo de eval, runner, juiz LLM
│   └── tests/                   # Jest + supertest contra Postgres/Redis reais
├── ml/                          # recomendador em Python (só biblioteca padrão)
│   ├── recommender/             # train.py, inference.py (handler SageMaker), serve.py (servidor local)
│   └── tests/                   # unittest: treino, contrato de inferência, servidor HTTP
├── infrastructure/terraform/
│   ├── main.tf …                # módulo raiz
│   ├── modules/                 # networking, database, cache, storage, queue, iam, lambda, apigateway, monitoring, recommender
│   ├── environments/            # dev/staging/prod.tfvars + backend.hcl.example
│   ├── bootstrap/               # bucket de state + OIDC (roda uma vez)
│   └── tests/plan.tftest.hcl    # plan dos 3 ambientes com provider simulado
├── monitoring/                  # collector OTel, dashboard (template), consultas Logs Insights
├── scripts/                     # build-lambda.sh, invoke-artifact.sh, smoke.mjs, smoke-recommendations.mjs, smoke-assistant.mjs, publish-model.sh
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
  api -.->|InvokeEndpoint| sm[SageMaker<br/>endpoint serverless]
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

docker compose up -d --build --wait     # api, postgres, redis, otel-collector, sqs, s3, recommender
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
| `recommender` (`ml/serve.py`) | endpoint SageMaker do recomendador (mesmo contrato `/ping` + `/invocations`) |

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

## Recomendação de produtos (ML)

`GET /api/v1/recommendations?limit=5` (autenticado) devolve produtos que o
cliente provavelmente quer, com base no que **clientes parecidos** compraram.

```mermaid
flowchart LR
  rds[(PostgreSQL<br/>order_items)] -->|ops: export-training-data<br/>usuário anonimizado| s3t[(S3 ml/training/)]
  s3t --> train[ml/recommender/train.py<br/>similaridade item-item]
  train -->|model.tar.gz| s3m[(S3 ml/models/versão/)]
  s3m --> ep[SageMaker endpoint<br/>serverless, container scikit-learn]
  api[Lambda api] -->|histórico do cliente| ep
  ep -->|ids + score| api
  api -->|preço/estoque atuais| rds
```

### Por que não é "fine-tuning"

A ideia original era "fine-tunar um modelo". *Fine-tuning* é ajustar um modelo
**já pré-treinado** (por exemplo, um LLM) com dados seus. Para recomendar a
partir de histórico de compras, isso é a ferramenta errada: exigiria GPU, muito
mais dados do que uma loja pequena tem, e o modelo não sabe nada útil sobre o
**seu** catálogo antes do treino. O caminho clássico — e o que se usa de
verdade em e-commerce como base — é **treinar do zero** um modelo de
**filtragem colaborativa** com o histórico. É isso que o projeto faz. A troca
está registrada em [docs/decisions.md](docs/decisions.md#recomendação-filtragem-colaborativa-e-não-fine-tuning).

### Como o modelo funciona

Dois produtos são parecidos quando **os mesmos clientes** compram os dois.
Para cada par, a similaridade de cosseno é:

```
sim(i, j) = clientes que compraram i e j / √(compradores de i × compradores de j)
```

Exemplo do teste de contrato: 4 clientes compraram camiseta, 3 compraram
moletom, e 3 compraram os dois → `3 / √(4×3) ≈ 0,87`. Para recomendar, soma-se
a similaridade de cada produto do histórico do cliente com seus vizinhos,
descartando o que ele já comprou. Pares vistos juntos por menos de 2 clientes
(`--min-support`) são ignorados: com pouco dado, uma coincidência viraria
similaridade 1,0.

O "modelo" é uma tabela de vizinhos em JSON — dá para abrir e ler. O
`model.tar.gz` tem o formato que o SageMaker espera (`model.json` +
`code/inference.py`) e é **reprodutível**: os mesmos dados geram o mesmo
arquivo, byte a byte, e a versão é o hash do conteúdo.

### O que a API faz com a resposta

| Situação | Resposta | `X-Recommendation-Source` |
|---|---|---|
| Cliente com histórico, modelo respondeu | vizinhos do modelo, completados com mais vendidos se faltar | `model` ou `model+popular` |
| Cliente sem histórico (*cold start*) | mais vendidos com estoque | `popular` |
| Modelo fora do ar, lento (> 800 ms) ou não configurado | mais vendidos com estoque | `popular` |

O modelo só devolve **ids**. Preço e estoque vêm sempre do banco: produto sem
estoque nunca é recomendado, mesmo que o modelo (treinado ontem) o sugira, e id
desconhecido ou malformado é descartado antes da query.

### Rodando localmente

O compose sobe o `recommender`: o `ml/recommender/serve.py`, um servidor com o
mesmo contrato HTTP do container do SageMaker. Sem modelo treinado ele
responde 503 e a API usa os mais vendidos.

```bash
docker compose run --rm api npm run seed:history    # 18 clientes demo com padrões de compra
docker compose run --rm -T api npm run -s export:training-data -- - \
  | docker compose run --rm -T recommender python -m recommender.train - /opt/ml/model
# model <versão>: <n> users, 5 products, 5 with neighbors -> /opt/ml/model/model.tar.gz

node scripts/smoke-recommendations.mjs http://localhost:3000
# recommendations -> 200 source=model+popular HOODIE-001 STICKER-001 MUG-001
```

O servidor relê o `model.json` quando ele muda — treinar de novo não exige
reiniciar nada. Sem Docker, o mesmo fluxo roda com `python3` dentro de `ml/` (testado com 3.12 e 3.14):
`python3 -m recommender.train <csv> model/` e
`python3 -m recommender.serve --model-dir model`, com `RECOMMENDER_URL=http://localhost:8080` na API.

### Na AWS

O recomendador é **opcional** (`enable_recommender = false` por padrão) e sobe
em duas fases, porque o SageMaker baixa o artefato no momento em que cria o
endpoint — ele precisa existir no S3 antes:

```bash
# 1. liga o bucket de ML (ainda sem endpoint)
terraform apply -var-file=environments/dev.tfvars -var enable_recommender=true

# 2. exporta o histórico pela Lambda ops, treina na sua máquina e publica o artefato
scripts/publish-model.sh dev
# publicado: s3://<bucket>/models/<versão>/model.tar.gz

# 3. cria (ou troca) o endpoint com a versão publicada
terraform apply -var-file=environments/dev.tfvars \
  -var enable_recommender=true -var recommender_model_version=<versão>
```

- **Endpoint serverless**: não há instância ligada; cobra por invocação. A troca é o *cold start* de alguns segundos depois de um tempo ocioso — a API corta em 800 ms (`RECOMMENDER_TIMEOUT_MS`) e responde com os mais vendidos.
- **Nome estável**: o endpoint se chama `<projeto>-<ambiente>-recommender` em todas as versões. Uma versão nova troca só a configuração do endpoint; a Lambda não precisa de redeploy.
- **Container oficial de scikit-learn** (`sagemaker-scikit-learn:1.2-1-cpu-py3`): ele já traz o servidor `/ping` + `/invocations` e carrega `code/inference.py` de dentro do `model.tar.gz`. Nada de imagem própria no ECR.
- **IAM**: a Lambda `api` só pode `sagemaker:InvokeEndpoint` nesse endpoint; a `ops` só escreve em `training/`; o role do SageMaker só lê `models/`. O histórico exportado expira em 30 dias.
- **Privacidade**: o export troca o id do cliente por um HMAC com sal aleatório **a cada export** — o modelo só precisa saber que duas compras são da mesma pessoa, e dois exports não podem ser cruzados entre si.

### Limitações (de propósito, para caber num projeto de estudo)

- **Retreino é manual** (`publish-model.sh`). O próximo passo natural é um job agendado: EventBridge → export → *SageMaker Training Job* (ou um Lambda/Fargate rodando o `train.py`) → publicação → atualização do endpoint.
- **Sem avaliação offline.** Não há métrica como precisão@k num conjunto de teste separado; com os dados demo ela seria enganosa. Em produção, avalie antes de trocar a versão.
- **Cliente novo recebe os mais vendidos**, e produto novo só aparece no modelo depois de ser comprado junto com outros por pelo menos 2 clientes.
- **Não verificado numa conta AWS**: o endpoint, o container de scikit-learn carregando o `inference.py` e o `publish-model.sh` foram validados só pelo `terraform validate`/`test` (plan simulado). O contrato JSON em si é testado de ponta a ponta localmente.

## Assistente de compras (LangGraph + RAG + evals)

`POST /api/v1/assistant` recebe uma pergunta em linguagem natural ("vocês têm
caneca pra café?") e devolve uma resposta curta e os produtos do catálogo que
a sustentam. São três peças, cada uma com uma pasta própria:

| Peça | O que faz | Onde |
|---|---|---|
| **RAG** | Recupera os produtos relevantes antes de chamar o LLM; o modelo só vê o que veio da busca | `backend/src/assistant/retriever.js` (um `BaseRetriever` do LangChain) |
| **LangGraph** | Orquestra recuperação → geração → checagem como um grafo de estados com arestas condicionais | `backend/src/assistant/graph.js` |
| **Evals** | Mede a recuperação (determinístico, no CI) e as respostas (LLM-as-a-judge, sob demanda) | `backend/evals/` |

```mermaid
flowchart LR
  q([pergunta]) --> retrieve
  retrieve -->|nada recuperado| empty[resposta fixa<br/>sem LLM]
  retrieve -->|sem chave| extractive[lista dos produtos<br/>recuperados]
  retrieve --> generate[Claude<br/>JSON por schema]
  generate -->|erro, recusa, timeout| extractive
  generate --> ground[grounding:<br/>descarta id fora da busca]
```

### Recuperação híbrida (o "R" do RAG)

Duas buscas sobre o mesmo catálogo, fundidas por posição com **Reciprocal Rank
Fusion** (RRF: `Σ 1/(60 + posição)`), que dispensa calibrar escalas de score
diferentes:

- **Textual** — `tsvector` do próprio PostgreSQL (coluna gerada, configuração
  `portuguese`, nome pesando mais que descrição, termos ligados por OU). Sempre
  em dia com o produto, sem job. Erra variação de grafia: "agua" não casa com
  "água".
- **Vetorial** — embeddings em `product_embeddings` (`real[]`, normalizados, com
  `dot_product` em SQL). Na AWS, **Amazon Titan Text Embeddings v2** pelo
  Bedrock; localmente e no CI, um *feature hashing* de palavras e 4-gramas que
  não custa nada e não sai da máquina. O hashing pega grafia ("agua",
  "camisetas"), mas **não entende sinônimo** — é para isso que existe o Titan.
- Só produto **com estoque** é recuperado. Embedding de produto editado depois
  da indexação deixa de valer (o `md5` do texto não bate) até o
  `npm run index:products` (ou a ação `index-products` da Lambda `ops`) rodar de
  novo; a busca textual cobre o intervalo.

### Geração e as guardas em volta do LLM

- **Claude** (`ASSISTANT_MODEL`, padrão `claude-opus-5-5`) pela API da
  Anthropic, com **structured outputs**: a resposta é JSON validado por schema
  (`{ answer, productIds }`), esforço `low` (pergunta de loja não precisa de
  raciocínio longo) e `fallbacks: "default"` — se o modelo recusar por política,
  a própria API refaz a chamada num modelo alternativo.
- **Grounding no código, não só no prompt**: o nó `ground` descarta qualquer id
  que o LLM cite fora da lista recuperada (inventado ou de outro produto) e
  conta quantos descartou. Preço e estoque vêm do banco, nunca do texto gerado.
- **Prompt injection**: catálogo e pergunta entram entre tags e com `<`/`>`
  removidos; o prompt de sistema trata o conteúdo como dado.
- **LLM é dependência opcional**, como o recomendador: sem chave, com erro,
  recusa ou timeout (`ASSISTANT_TIMEOUT_MS`, 10 s), a resposta cai para a lista
  recuperada. O header `X-Assistant-Source` diz o que aconteceu: `llm`,
  `retrieval` ou `none`.
- **Exige login**: cada pergunta pode custar uma chamada de LLM.

### Evals

O dataset (`backend/evals/dataset.jsonl`, 26 perguntas sobre um catálogo de 24
produtos em `catalog.json`) separa as perguntas pelo que elas testam:
`lexical` (palavra exata), `morphology` (plural, sem acento), `semantic`
(sinônimo, paráfrase), `none` (a loja não vende aquilo) e `stock` (o único
produto que casa está esgotado).

```bash
# banco descartável: o runner apaga o catálogo dele
createdb ecommerce_eval
EVAL_DATABASE_URL=postgres://.../ecommerce_eval npm run eval

# + respostas: gerador e juiz chamam a API da Anthropic (custa)
EVAL_DATABASE_URL=... ANTHROPIC_API_KEY=... npm run eval -- --llm --out eval-report.json
```

Resultado medido com o embedder de hashing (k = 5):

| Modo | hit@5 | lexical | morphology | semantic | abstenção (`none`) | esgotado recuperado |
|---|---|---|---|---|---|---|
| `fts` | 64% | 100% | 80% | 0% | 100% | 0 |
| `vector` | 68% | 100% | 100% | 0% | 100% | 0 |
| `hybrid` | 68% | 100% | 100% | 0% | 100% | 0 |

A linha `semantic` zerada é o resultado esperado, não um bug: nem a busca
textual nem o hashing sabem que "xícara" é "caneca". O eval existe para tornar
isso visível — rode com `EMBEDDINGS_PROVIDER=bedrock` (credenciais AWS) para
medir o Titan no mesmo dataset.

- **Gate no CI**: `tests/assistant-evals.test.js` falha o build se o modo
  `hybrid` cair abaixo de 100% em `lexical` e `morphology`, abstenção abaixo de
  100% ou se recuperar produto esgotado. O job também publica o relatório
  completo (`assistant-eval-report`).
- **Com `--llm`**: métricas de código (respondidas pelo LLM, *grounded* = nenhum
  id descartado, citações corretas) e duas notas binárias de um **juiz LLM**
  (`EVAL_JUDGE_MODEL`, padrão `claude-sonnet-5-5`, outro modelo que o gerador):
  *faithful* (nada além do que está nos produtos) e *helpful* (responde à
  pergunta ou admite que nada serve). O runner soma os tokens de gerador e juiz
  — é o custo de uma rodada.

### Na AWS

```bash
terraform apply -var-file=environments/dev.tfvars -var enable_assistant=true
# a chave entra por fora: nunca no state nem no repositório
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw assistant_secret_arn)" --secret-string "$ANTHROPIC_API_KEY"
aws lambda invoke --function-name "$(terraform output -raw ops_function_name)" \
  --cli-binary-format raw-in-base64-out --payload '{"action":"index-products"}' /dev/stdout
```

- `enable_assistant` cria o segredo **vazio** e liga o Titan
  (`EMBEDDINGS_PROVIDER=bedrock`) em `api` e `ops` — as duas precisam do mesmo
  modelo, porque vetores de modelos diferentes não se comparam. Sem
  `enable_assistant`, a rota funciona do mesmo jeito, com o hashing e sem LLM.
- **IAM**: `api` lê só esse segredo; `api` e `ops` só podem `bedrock:InvokeModel`
  no modelo de embeddings configurado. O acesso ao Titan precisa estar liberado
  no console do Bedrock, na região do deploy.
- A Lambda chega na API da Anthropic e no Bedrock pelo NAT que já existe.

### Limitações

- **Não verificado com LLM nem com Titan**: a chamada ao Claude, o juiz e o
  `BedrockEmbedder` foram testados com clientes dublês (formato da requisição,
  parsing, recusa, corpo inválido). Nenhuma chamada real foi feita, então os
  números de `--llm` e de `semantic` com Titan ainda não existem.
- **Busca vetorial sem índice**: `dot_product` varre a tabela; serve para
  centenas de produtos. Com milhares, o caminho é a extensão `pgvector` com
  índice HNSW (o RDS suporta).
- **Sem limite de taxa por usuário** na rota: o login reduz o abuso, mas cada
  pergunta pode chamar o LLM. Em produção, *usage plan* no API Gateway ou um
  contador no Redis.
- **Uma pergunta por vez**, sem histórico de conversa — o estado do grafo vive
  só durante a requisição.

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

cd ../ml && python3 -m unittest discover -s tests -v   # recomendador (só biblioteca padrão)
```

Os testes usam **PostgreSQL e Redis reais**, de propósito: o que mais importa
aqui (lock de linha, constraint, transação, `SKIP LOCKED`, Redis caindo) não
existe num mock. Dublês só na fronteira com serviço externo: o cliente SQS no teste da outbox e os clientes de SageMaker, Bedrock e da API da Anthropic (o que se testa é o formato da chamada e o tratamento da resposta, não o modelo). O Jest
falha abaixo de **80%** em linhas, branches, funções e statements de `src/`
(handlers incluídos).

Alguns testes que valem a leitura:

- `orders.test.js` — 4 compradores simultâneos para 1 unidade: exatamente um 201; 3 retries concorrentes com a mesma chave viram um pedido só.
- `jobs.test.js` — SQS fora do ar depois do commit: o evento fica na outbox e é publicado quando volta; reentrega não duplica a notificação; mensagem inválida falha sozinha no lote.
- `products.test.js` — Redis numa porta morta e o catálogo continua respondendo.
- `observability.test.js` — 500 sem stack nem mensagem interna, mas com o correlation ID que acha a linha de log; nenhum password/token/email nos logs.
- `handlers.test.js` — o handler Lambda recebendo eventos no formato real do API Gateway HTTP API.
- `recommendations.test.js` — contrato Node ↔ Python sem simulação: exporta do PostgreSQL, treina com `train.py`, sobe o `serve.py` e a API passa de `popular` para `model`; modelo fora do ar vira fallback; id sem estoque ou malformado vindo do modelo é descartado.

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
perfis, que prod sem Multi-AZ é **recusado**, que ambiente inválido é recusado
e que o endpoint de recomendação só existe depois que há um modelo publicado.
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
| `RECOMMENDER_URL` | ✓ | | Servidor local do recomendador (`serve.py`) |
| `RECOMMENDER_ENDPOINT_NAME` | | api | Endpoint SageMaker; sem ele e sem URL, só mais vendidos |
| `RECOMMENDER_TIMEOUT_MS` | 800 | 800 | Tempo máximo esperando o modelo antes do fallback |
| `ML_BUCKET` | | ops | Destino do export de histórico (`training/`) |
| `ANTHROPIC_API_KEY` | vazio (sem LLM) | — | Chave da Anthropic; na AWS vem de `ANTHROPIC_API_KEY_SECRET_ARN` |
| `ANTHROPIC_API_KEY_SECRET_ARN` | | api, com `enable_assistant` | Segredo com a chave (lido no cold start; vazio = sem LLM) |
| `ASSISTANT_MODEL` | `claude-opus-5-5` | `assistant_model` | Modelo que gera a resposta |
| `ASSISTANT_TIMEOUT_MS` | 10000 | 10000 | Tempo máximo esperando o LLM antes de responder só com a busca |
| `ASSISTANT_TOP_K` / `ASSISTANT_MIN_VECTOR_SCORE` | 5 / 0.2 | 5 / 0.2 | Produtos entregues ao LLM / similaridade mínima na busca vetorial |
| `EMBEDDINGS_PROVIDER` | `hashing` | `bedrock` com `enable_assistant` | Embeddings do catálogo e da pergunta |
| `EMBEDDINGS_MODEL_ID` | `amazon.titan-embed-text-v2:0` | idem | Modelo de embeddings no Bedrock |

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
| `X-Recommendation-Source: popular` para quem tem histórico | Log `recommender unavailable, using fallback` (timeout, 503 sem modelo, erro de IAM). Na AWS: status do endpoint no console do SageMaker e logs em `/aws/sagemaker/Endpoints/<nome>`. Logo depois de ocioso, o primeiro pedido pode estourar os 800 ms (*cold start* do serverless) |
| `X-Assistant-Source: retrieval` com chave configurada | Log `assistant llm unavailable, answering from retrieval` (timeout de 10 s, recusa, chave inválida). Na AWS: segredo sem valor (`put-secret-value` não rodou) ou sem rota de saída pelo NAT |
| Assistente não acha por sinônimo | Embeddings em `hashing` (não entende sinônimo) ou catálogo não indexado: rode `index-products` e confira `EMBEDDINGS_PROVIDER=bedrock` em `api` **e** `ops` |
| `AccessDeniedException` do Bedrock | Acesso ao Titan não liberado no console do Bedrock nessa região |
| Endpoint SageMaker falha ao criar | O `model.tar.gz` não está em `models/<versão>/` — rode o `publish-model.sh` antes de preencher `recommender_model_version` |

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
- Os buckets de uploads e de ML só são esvaziados automaticamente em dev (`force_destroy`).
- O **bootstrap** fica de pé (bucket com `prevent_destroy`). Para remover tudo, esvazie o bucket de state, remova o `lifecycle` e rode `terraform destroy` em `bootstrap/`.
- Confira no Cost Explorer, no dia seguinte, que nada ficou cobrando.

## Custos

Estimativa datada (us-east-1, 10/10/2026, **não é fatura**). Os preços
unitários vêm de uma tabela de referência, **não** de consulta à AWS Pricing
Calculator — confirme lá antes do primeiro apply:
**dev ≈ US$ 90/mês (≈ US$ 0,12/h)**, **prod ≈ US$ 200/mês**. O que domina é o
custo fixo de NAT, RDS Proxy, RDS e ElastiCache — não as Lambdas. O
recomendador é serverless e opcional: não soma custo fixo por hora. Detalhamento,
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
| Filtragem colaborativa e formato de modelo SageMaker | `ml/recommender/train.py`, `inference.py` |
| Modelo como dependência opcional (timeout + fallback) | `backend/src/services/recommendations.js`, `src/recommender/client.js` |
| RAG híbrido (texto + vetor + RRF) como Retriever do LangChain | `backend/src/assistant/retriever.js` |
| Grafo LangGraph com arestas condicionais e fallback | `backend/src/assistant/graph.js` |
| Structured outputs, fallback por recusa, prompt injection | `backend/src/assistant/llm.js` |
| Evals de recuperação e LLM-as-a-judge | `backend/evals/lib.js`, `judge.js`, `tests/assistant-evals.test.js` |
| Endpoint em duas fases, IAM por prefixo | `infrastructure/terraform/modules/recommender/main.tf` |
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
| `npm ci`, lint, 87 testes, cobertura ≥ 80% nas 4 métricas | ✅ verificado localmente (Node 24.22, PostgreSQL 18, Redis 7.4) |
| Build do zip + invoke do handler com evento API Gateway | ✅ verificado |
| Smoke test contra a API local | ✅ verificado |
| `terraform fmt`, `validate`, `test` (plan simulado × 3 ambientes) | ✅ verificado (Terraform 1.16.5, AWS provider 6.68) |
| Build da imagem Docker + `docker compose` completo + smoke + evento chegando ao worker com o mesmo correlation ID + spans no collector | ✅ verificado no CI (job `compose`) |
| `terraform plan`/`apply` real, migração e smoke na AWS | ❌ não executado — exige conta AWS configurada |
| Upload: conteúdo da URL assinada (chave no prefixo do usuário, tipo, tamanho máximo, validade) | ✅ verificado nos testes, decodificando a policy assinada |
| Upload: envio real de um arquivo ao bucket (MinIO local ou S3) usando essa URL | ❌ não executado — o passo `curl -F file=@…` da seção de API está documentado, mas não foi rodado |
| Traces no X-Ray / layer OpenTelemetry na Lambda | ❌ não verificado em conta real |
| Recomendador: treino, contrato de inferência e `serve.py` (9 testes Python) | ✅ verificado localmente (Python 3.14) e no CI (job `ml`, Python 3.12) |
| Recomendador ponta a ponta: export do PostgreSQL → `train.py` → `serve.py` → `GET /recommendations` passando de `popular` para `model` | ✅ verificado no Jest e manualmente com a API rodando |
| Recomendador no `docker compose` (seed demo → export → treino → smoke) | ✅ verificado no CI (job `compose`) — Docker não estava disponível na máquina de desenvolvimento |
| Endpoint SageMaker real, container scikit-learn carregando o `inference.py`, `publish-model.sh` | ❌ não executado — validado só por `terraform validate`/`test` |
| Assistente: recuperação híbrida, grafo, grounding, rota e eval de recuperação (fts × vector × hybrid) | ✅ verificado localmente (Jest + `npm run eval`) e manualmente com a API rodando (`smoke-assistant.mjs` → `ASSISTANT_OK`) |
| Assistente no `docker compose` (index + smoke) e relatório de eval no CI | ⏳ adicionado ao CI, ainda não rodado lá |
| Chamada real ao Claude, juiz LLM (`--llm`) e embeddings do Titan | ❌ não executado — sem chave da Anthropic nem conta AWS; testado só com clientes dublês |
| Preços da estimativa de custos | ⚠️ tabela de referência, não consultada na AWS Pricing Calculator |

## Licença

MIT — veja [LICENSE](LICENSE).
