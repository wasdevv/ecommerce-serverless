# Decisões de arquitetura

Registro curto de cada escolha que não é óbvia: o contexto, a decisão e o que
se perdeu com ela. Escrito para quem estuda o projeto perguntar "por que não
X?" e achar a resposta.

## Node.js 24 + Express, sem PHP/Laravel

- **Contexto:** o rascunho previa manter Laravel (via Bref) ou reescrever em Node. Não havia código Laravel existente para migrar.
- **Decisão:** Node.js 24 + Express 5, rodando igual localmente (`server.js`) e na Lambda (`handlers/api.js` via `@codegenie/serverless-express`).
- **Por quê:** um único app Express testável com supertest e servido nos dois ambientes; runtime `nodejs24.x` com suporte da AWS até 2028 (o `nodejs22.x` é descontinuado em 30/04/2027, segundo a [tabela de runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), consultada em 10/10/2026).
- **Custo:** um único Lambda "monolítico" para a API tem cold start maior que funções por rota. Para um catálogo + pedidos, aceitável.

## Uma função de API, não uma por rota

O roteamento fica no Express e o API Gateway tem uma única rota `$default`.
Uma Lambda por rota multiplicaria IAM, logs e deploy sem ganho real neste
tamanho. As funções separadas são as que têm **gatilho** diferente: API
Gateway (api), EventBridge (dispatcher), SQS (worker) e invocação manual (ops).

## Transactional outbox em vez de publicar no SQS direto

Publicar no SQS logo depois do `COMMIT` deixa uma janela: se o processo morre
(ou o SQS falha) entre os dois, o pedido existe e o evento não. A outbox grava
o evento **na mesma transação** do pedido; o dispatcher publica depois.
**Custo:** até ~1 minuto de atraso (frequência do EventBridge) e entrega
"ao menos uma vez" — por isso o worker deduplica pelo `eventId`.

## Estoque reservado na transação do pedido, não no worker

Reservar no worker permitiria aceitar pedidos que não podem ser atendidos (o
cliente recebe 201 e depois "desculpe, acabou"). O débito condicional
`stock >= q` dentro da transação garante que um 201 significa estoque
reservado. O worker só registra a notificação.

## RDS Proxy

Cada ambiente de execução Lambda abre suas próprias conexões. Um pico de
concorrência esgotaria o `max_connections` de um `db.t4g.micro` (~80). O Proxy
mantém o pool e multiplexa. O pool por Lambda é `DB_POOL_MAX=2`.
**Custo:** o Proxy é cobrado por vCPU da instância (mínimo de 2 vCPUs) —
é uma das maiores linhas do custo fixo (ver [costs.md](costs.md)).

## NAT Gateway em vez de endpoints de interface

As Lambdas estão na VPC (para alcançar RDS e Redis) e precisam de SQS, Secrets
Manager e X-Ray. Opções:

| Opção | Custo fixo/mês (us-east-1, 2 AZs) |
|---|---|
| 1 NAT Gateway (dev) | ~US$ 32,85 + IPv4 público ~US$ 3,65 |
| Endpoints de interface: SQS, Secrets Manager, X-Ray, CloudWatch Logs (4 × 2 AZs) | ~US$ 58,40 |

NAT é mais barato aqui e cobre qualquer serviço futuro. Em prod há um NAT por
AZ para que a queda de uma AZ não corte a saída da outra. S3 usa endpoint de
**gateway**, que é gratuito.

## Valkey no ElastiCache, sem AUTH token

Valkey é o fork open source do Redis, compatível com o protocolo (o `ioredis`
conecta igual) e mais barato no ElastiCache. TLS em trânsito está ligado; o
controle de acesso é o security group, que só aceita o SG das Lambdas. Um
AUTH token seria mais uma credencial para rotacionar sem ganho real dentro de
uma VPC privada; RBAC do ElastiCache é a evolução se houver mais clientes.

## Segredos fora do state do Terraform

- Senha do banco: `manage_master_user_password` — o RDS gera e guarda no Secrets Manager; o Terraform nunca vê o valor.
- JWT e senha do admin: `ephemeral "random_password"` + `secret_string_wo` (argumento *write-only*, Terraform ≥ 1.11). O valor vai para o Secrets Manager e **não** é gravado no state. Para rotacionar, incremente `secrets_version`.
- Outputs só expõem ARNs e endpoints.

**Limitação conhecida:** o RDS rotaciona a senha gerenciada a cada 7 dias por
padrão. A Lambda lê o segredo no cold start e o guarda em memória; um ambiente
de execução que sobreviva à rotação passa a falhar na autenticação até ser
reciclado. A correção é autenticar no Proxy com **IAM auth** (token
temporário a cada conexão) em vez de senha — próximo passo natural, não feito
aqui para manter o fluxo de segredos legível.

## Terraform é o único dono do deploy

O código da Lambda é publicado pelo `terraform apply` (o `source_code_hash`
muda quando o zip muda). Não há `serverless.yml`, SAM nem `aws lambda
update-function-code` no pipeline — dois mecanismos de deploy brigando pelo
mesmo recurso geram drift. O build é determinístico (datas fixas no zip), então
um commit que não mexe no backend não gera diff nas funções.

## Migrações pela Lambda `ops`

O RDS está em sub-rede privada; o runner do GitHub não alcança. A Lambda `ops`
(sem rota HTTP, só `lambda:InvokeFunction` do role de deploy) roda
`migrate`, `bootstrap-admin` e `smoke-fixture` — uma lista fechada de ações.
As migrações usam `pg_advisory_lock`, então dois deploys simultâneos não
aplicam a mesma migração duas vezes.

## Presigned POST, não PUT

Só a *policy* do POST permite `content-length-range`: com PUT o cliente
poderia enviar um arquivo maior que o declarado. A chave é gerada pelo servidor
dentro de `users/<sub do JWT>/`, então um usuário não consegue escrever no
prefixo de outro.

## JWT no middleware, sem Lambda authorizer

Um authorizer separado adiciona latência, uma função e cache de política. Com
uma única função de API, validar o JWT no middleware do Express é mais simples
e igualmente seguro. HS256 com segredo no Secrets Manager; se outros serviços
precisarem validar tokens, a evolução é RS256 com JWKS.

## OpenTelemetry: SDK local, extension na Lambda

Os pacotes `@opentelemetry/*` são `optionalDependencies` e ficam fora da layer
(reduzem ~40 MB e o cold start). Localmente o SDK exporta para o collector do
compose. Na Lambda, o X-Ray ativo vem ligado; para spans de PostgreSQL/Redis
na Lambda, configure `adot_layer_arn` com a layer OpenTelemetry para Node.js
(ARNs publicados em [opentelemetry-lambda/releases](https://github.com/open-telemetry/opentelemetry-lambda/releases))
— isso **não foi verificado numa conta AWS** neste repositório.

## Bucket de state com lock nativo do S3

`use_lockfile = true` (Terraform ≥ 1.10) faz o lock com um objeto `.tflock` no
próprio bucket — sem tabela DynamoDB. Cada ambiente tem seu `key`, e o role de
deploy de um ambiente só consegue escrever no prefixo dele.

## Recomendação: filtragem colaborativa, e não fine-tuning

- **Contexto:** a proposta era "fine-tunar um modelo para recomendar com base no histórico do usuário", servido por um endpoint SageMaker e chamado pela Lambda.
- **Decisão:** treinar **do zero** um modelo de filtragem colaborativa item-item (similaridade de cosseno entre produtos comprados pelos mesmos clientes) e servi-lo num endpoint **SageMaker Serverless Inference** com o container oficial de scikit-learn. Lambda e endpoint seguem o desenho proposto; o que muda é o tipo de modelo.
- **Por quê:** *fine-tuning* ajusta um modelo pré-treinado (um LLM, por exemplo) — exige GPU, volume de dados que uma loja de estudo não tem, e o modelo de partida não sabe nada sobre este catálogo. Filtragem colaborativa é a base clássica de recomendação em e-commerce, treina em milissegundos, cabe na biblioteca padrão do Python e o resultado é uma tabela que dá para ler e conferir à mão.
- **Endpoint serverless em vez de instância:** um endpoint de tempo real com instância cobra por hora, 24 h por dia, com ou sem tráfego. O serverless cobra por invocação; o preço é o *cold start* depois de ocioso, absorvido por timeout curto (800 ms) e fallback para os mais vendidos.
- **Modelo é dependência opcional:** recomendação nunca derruba a requisição. Sem histórico, sem modelo configurado, com o endpoint fora ou lento, a API responde com os mais vendidos e diz isso em `X-Recommendation-Source`.
- **Treino fora da AWS (por enquanto):** a Lambda `ops` exporta o histórico anonimizado para o S3 e o treino roda na máquina de quem opera (`scripts/publish-model.sh`). Um *SageMaker Training Job* agendado é a evolução; ficou de fora para manter o fluxo legível.
- **Custo:** mais um serviço e um bucket por ambiente; o cliente novo e o produto novo (*cold start* de dados) só recebem/entram em recomendação depois de compras; sem avaliação offline (precisão@k) — com dados demo ela seria enganosa.

## Fora do escopo (de propósito)

Frontend, pagamento real/Stripe/webhooks, email real, Datadog, múltiplas
moedas, cupons, frete, devoluções. O worker registra uma `notification` em vez
de enviar email: o efeito é verificável sem prometer integração inexistente.
