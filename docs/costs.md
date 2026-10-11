# Estimativa de custos

> **Isto é uma estimativa, não uma fatura.** Valores em USD, região
> **us-east-1**, sem free tier, sem impostos e sem descontos, montada em
> **10/10/2026**.
>
> **De onde vêm os preços unitários:** de uma tabela de referência de preços
> sob demanda usada na escrita deste documento — **não** foram consultados na
> AWS Pricing Calculator nem nas páginas de preço da AWS nessa data. Trate cada
> linha como ordem de grandeza e confirme na
> [AWS Pricing Calculator](https://calculator.aws/) antes de provisionar. O
> custo real só aparece no Cost Explorer depois do uso.

Pressupostos: 730 h/mês, tráfego de estudo (poucos milhares de requisições/mês),
logs com poucos GB. O que domina é o **custo fixo por hora** — recursos que
cobram mesmo sem nenhuma requisição.

## Perfil `dev` (single-AZ)

| Recurso | Cálculo | ~USD/mês |
|---|---|---|
| NAT Gateway (1) | 0,045/h × 730 | 32,85 |
| IPv4 público do NAT | 0,005/h × 730 | 3,65 |
| RDS `db.t4g.micro` single-AZ | 0,016/h × 730 | 11,68 |
| RDS armazenamento gp3 20 GB | 0,115/GB | 2,30 |
| RDS Proxy (mínimo 2 vCPU) | 0,015/vCPU-h × 2 × 730 | 21,90 |
| ElastiCache `cache.t4g.micro` × 1 | 0,016/h × 730 | 11,68 |
| Secrets Manager (3 segredos) | 0,40 cada | 1,20 |
| CloudWatch (dashboard + 12 alarmes) | 3,00 + 0,10 × 12 | 4,20 |
| Lambda, API Gateway, SQS, S3, EventBridge, X-Ray | volume de estudo | < 1,00 |
| **Total** | | **≈ 90 / mês ≈ 0,12 / hora** |

## Perfil `prod` (Multi-AZ)

| Recurso | Cálculo | ~USD/mês |
|---|---|---|
| NAT Gateway (2, um por AZ) + 2 IPv4 | (0,045 + 0,005)/h × 2 × 730 | 73,00 |
| RDS `db.t4g.small` Multi-AZ | 0,064/h × 730 | 46,72 |
| RDS armazenamento gp3 20 GB Multi-AZ | 0,23/GB | 4,60 |
| RDS Proxy (mínimo 2 vCPU) | 0,015 × 2 × 730 | 21,90 |
| ElastiCache `cache.t4g.small` × 2 | 0,032/h × 2 × 730 | 46,72 |
| Backups além do tamanho do banco (7 dias) | | ~1–2 |
| Secrets, CloudWatch, serverless | | ~7 |
| **Total** | | **≈ 200 / mês** |

`staging` tem o mesmo perfil do `dev`.

## Recomendador (opcional, `enable_recommender`)

Não entra nos totais acima, e **não foi estimado em dólares** aqui. O modelo de
cobrança é o que importa para estudar:

- **SageMaker Serverless Inference:** sem custo parado. Cobra por tempo de
  computação de cada invocação (proporcional à memória configurada, 1 GB por
  padrão) e por volume de dados processados. Tráfego de estudo fica perto de
  zero; confira o preço por GB-segundo na
  [página de preços do SageMaker](https://aws.amazon.com/sagemaker/pricing/).
- **O que evitar:** um endpoint de tempo real com instância (ex.: `ml.t2.medium`)
  cobra **por hora, ligado o tempo todo** — na mesma ordem de grandeza de um
  RDS pequeno. Foi por isso que o projeto usa o serverless.
- **S3 de ML:** CSVs de histórico (expiram em 30 dias) e `model.tar.gz` de
  poucos KB — centavos.
- **Treino:** roda na sua máquina (`scripts/publish-model.sh`), sem custo AWS
  além da invocação da Lambda `ops`.

## Como gastar o mínimo estudando

1. Rode tudo localmente com `docker compose` — custo zero.
2. Na AWS, suba **só o `dev`**, faça o que quer testar e **destrua no mesmo dia**:
   algumas horas custam centavos; esquecer ligado custa ~US$ 3/dia.
3. Configure um [AWS Budget](https://console.aws.amazon.com/billing/home#/budgets) com alerta (ex.: US$ 10) antes do primeiro apply.
4. O que **continua cobrando depois do destroy**: o bucket de state (centavos),
   snapshots finais do RDS (só em prod), segredos em janela de recuperação
   (prod: 30 dias) e logs ainda retidos.
