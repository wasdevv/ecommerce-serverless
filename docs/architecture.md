# Arquitetura

## Visão geral na AWS

```mermaid
flowchart LR
  client([Cliente]) -->|HTTPS| apigw[API Gateway<br/>HTTP API]
  client -.->|POST pré-assinado| s3[(S3 uploads<br/>privado)]

  subgraph vpc[VPC — sub-redes privadas em 2 AZs]
    api[Lambda api<br/>Express]
    disp[Lambda dispatcher]
    worker[Lambda worker]
    ops[Lambda ops<br/>migrate / bootstrap]
    proxy[RDS Proxy<br/>TLS]
    rds[(RDS PostgreSQL<br/>Multi-AZ em prod)]
    redis[(ElastiCache Valkey<br/>TLS)]
  end

  apigw --> api
  api --> proxy
  api --> redis
  disp --> proxy
  worker --> proxy
  ops --> proxy
  proxy --> rds

  sched[EventBridge<br/>rate 1 min] --> disp
  disp -->|SendMessageBatch| sqs[[SQS order-events]]
  sqs -->|event source mapping<br/>partial batch response| worker
  sqs -.->|5 falhas| dlq[[SQS DLQ]]

  api -.->|InvokeEndpoint<br/>timeout 800 ms| rec[SageMaker endpoint<br/>serverless, opcional]
  ops -.->|export anonimizado| ml[(S3 ml<br/>training/ · models/)]
  ml -.->|model.tar.gz| rec

  sm[Secrets Manager] -.-> api & disp & worker & ops
  api & disp & worker -.->|traces| xray[X-Ray]
  api & disp & worker -.->|logs JSON| cw[CloudWatch Logs<br/>dashboard + alarmes]
```

Saída das sub-redes privadas para APIs AWS (SQS, Secrets Manager, X-Ray):
NAT Gateway. S3: endpoint de gateway (gratuito). Detalhe em
[decisions.md](decisions.md#nat-gateway-em-vez-de-endpoints-de-interface).

## Fluxo de um pedido

```mermaid
sequenceDiagram
  participant C as Cliente
  participant A as Lambda api
  participant DB as PostgreSQL
  participant D as dispatcher
  participant Q as SQS
  participant W as worker

  C->>A: POST /orders (Idempotency-Key, X-Correlation-Id)
  A->>DB: BEGIN
  A->>DB: INSERT idempotency_keys (PK serializa retries)
  A->>DB: UPDATE products SET stock = stock - q WHERE stock >= q
  A->>DB: INSERT orders, order_items, outbox_events
  A->>DB: COMMIT
  A-->>C: 201 + X-Correlation-Id
  Note over A,Q: se o SQS estiver fora agora, nada se perde:<br/>o evento já está na outbox
  D->>DB: SELECT ... FOR UPDATE SKIP LOCKED (pendentes)
  D->>Q: SendMessageBatch (correlationId como atributo)
  D->>DB: UPDATE published_at
  Q->>W: lote de até 10 mensagens
  W->>DB: INSERT processed_events ON CONFLICT DO NOTHING + INSERT notifications
  W-->>Q: batchItemFailures (só as que falharam)
```

### Garantias e onde elas moram

| Garantia | Mecanismo | Teste |
|---|---|---|
| Estoque nunca negativo | `UPDATE ... WHERE stock >= q` sob row lock + `CHECK (stock >= 0)` | `orders.test.js` — 4 compradores, 1 unidade |
| Sem deadlock entre pedidos | locks sempre na ordem de `product_id` | (por construção) |
| Idempotência | PK `(user_id, key)` + hash canônico do payload | `orders.test.js` — retries concorrentes, payload diferente → 409 |
| Evento não se perde entre commit e fila | transactional outbox | `jobs.test.js` — SQS fora, depois volta |
| Sem publicação dupla por dispatchers concorrentes | `FOR UPDATE SKIP LOCKED` | `jobs.test.js` |
| Reentrega não duplica efeito | `processed_events` + efeito na mesma transação | `jobs.test.js` |
| Mensagem ruim não trava o lote | partial batch response → DLQ após 5 tentativas | `jobs.test.js` + `ReportBatchItemFailures` no Terraform |
| Pedido alheio invisível | filtro `user_id` na query; 404 igual a inexistente | `orders.test.js` |
| Catálogo sobrevive ao Redis | cache-aside que trata erro como miss, timeouts curtos | `products.test.js` — Redis numa porta morta |
| Recomendação sobrevive ao modelo | timeout de 800 ms + fallback para mais vendidos; header diz a origem | `recommendations.test.js` — modelo lançando erro, servidor sem modelo (503) |
| Recomendação nunca oferece o que não dá para vender | ids do modelo filtrados por UUID válido e `stock > 0` no banco | `recommendations.test.js` |

## Recomendação de produtos

O modelo (tabela de vizinhos item-item) é treinado pelo `ml/recommender/train.py`
e empacotado como `model.tar.gz` com `code/inference.py` — o formato que o
container de scikit-learn do SageMaker carrega. O mesmo `inference.py` roda no
`serve.py` local, então o contrato JSON testado localmente é o que o endpoint
recebe:

```
POST /invocations  {"productIds": ["<uuid>", ...], "k": 10}
200                {"recommendations": [{"productId": "<uuid>", "score": 0.87}], "modelVersion": "1072f23be992"}
```

O endpoint não está na VPC (endpoints serverless não suportam VPC): a Lambda
`api` chega nele pela API pública do SageMaker Runtime, via NAT, autenticada
por IAM. O fluxo de treino e as limitações estão no
[README](../README.md#recomendação-de-produtos-ml).

## Assistente de compras (RAG)

```
POST /api/v1/assistant {"question": "..."}
  └─ grafo LangGraph (src/assistant/graph.js)
       retrieve   PostgreSQL: tsvector (texto) + product_embeddings (vetor), fundidos por RRF
       generate   API da Anthropic (Claude, JSON por schema)       ← opcional: sem chave/erro/timeout pula
       ground     descarta id que não veio da busca; preço/estoque do banco
200 {"data": {"answer": "...", "products": [...]}}   X-Assistant-Source: llm | retrieval | none
```

Embeddings do catálogo são gerados fora da requisição (ação `index-products`
da Lambda `ops`, incremental por `md5` do texto); na requisição só a pergunta
vira vetor. Na AWS, Titan pelo Bedrock; local e CI, hashing. Detalhes e evals
no [README](../README.md#assistente-de-compras-langgraph--rag--evals).

## Observabilidade e o "sidecar"

O rascunho original pedia um *sidecar pattern*. Sidecar é um container ao
lado do container da aplicação, no mesmo pod/task. **Lambda não tem
containers lado a lado**, então o projeto aplica o padrão onde ele existe e
usa o equivalente da plataforma onde não existe:

| Onde | O que faz o papel do sidecar |
|---|---|
| Local (`docker compose`) | container `otel-collector` ao lado do `api`. A aplicação só conhece `OTEL_EXPORTER_OTLP_ENDPOINT`; batching, destino e credenciais ficam no collector. É um sidecar de verdade. |
| Lambda | **Lambda Extension** — um processo que roda no mesmo ambiente de execução da função, com ciclo de vida próprio. A layer ADOT/OpenTelemetry é exatamente isso. Opcional aqui (`adot_layer_arn`); sem ela, o X-Ray *active tracing* nativo registra cada invocação. |

Em ambos os casos os logs são JSON (pino) com `timestamp`, `level`,
`correlationId`, `traceId`, `route`, `status` e `durationMs`, e campos
sensíveis (`password`, `token`, `authorization`, `email`, `secret`) são
redigidos na origem.

O `correlationId` atravessa o sistema: header HTTP → coluna
`outbox_events.correlation_id` → atributo da mensagem SQS → contexto do
worker. Uma consulta salva no Logs Insights
(`monitoring/queries/trace-correlation-id.query`) junta as três pontas.
