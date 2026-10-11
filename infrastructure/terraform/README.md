# Infraestrutura (Terraform)

Módulo raiz: compõe os módulos de `modules/` por ambiente (`environments/*.tfvars`). Explicação da arquitetura em `docs/architecture.md`; passo a passo de deploy no README da raiz.

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
| ---- | ------- |
| terraform | >= 1.11 |
| aws | ~> 6.0 |
| random | ~> 3.7 |

## Providers

| Name | Version |
| ---- | ------- |
| aws | ~> 6.0 |

## Modules

| Name | Source | Version |
| ---- | ------ | ------- |
| apigateway | ./modules/apigateway | n/a |
| cache | ./modules/cache | n/a |
| database | ./modules/database | n/a |
| iam | ./modules/iam | n/a |
| lambda | ./modules/lambda | n/a |
| monitoring | ./modules/monitoring | n/a |
| networking | ./modules/networking | n/a |
| queue | ./modules/queue | n/a |
| recommender | ./modules/recommender | n/a |
| storage | ./modules/storage | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_secretsmanager_secret.admin_password](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/secretsmanager_secret) | resource |
| [aws_secretsmanager_secret.jwt](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/secretsmanager_secret) | resource |
| [aws_secretsmanager_secret_version.admin_password](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/secretsmanager_secret_version) | resource |
| [aws_secretsmanager_secret_version.jwt](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/secretsmanager_secret_version) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| environment | Ambiente: dev, staging ou prod. | `string` | n/a | yes |
| admin\_email | Email do administrador criado pela ação bootstrap-admin. | `string` | `"admin@example.com"` | no |
| adot\_layer\_arn | Layer ADOT para Node.js (vazio = X-Ray nativo apenas). | `string` | `""` | no |
| alarm\_email | Email para alarmes (vazio = sem assinatura). | `string` | `""` | no |
| api\_memory\_mb | Memória da função API. | `number` | `512` | no |
| artifacts\_dir | Diretório com function.zip e layer.zip (gerados por scripts/build-lambda.sh). | `string` | `"../../build"` | no |
| aws\_region | Região AWS. | `string` | `"us-east-1"` | no |
| cache\_node\_type | Tipo de nó ElastiCache. | `string` | `"cache.t4g.micro"` | no |
| cache\_nodes | Nós de cache (2+ = réplica com failover). | `number` | `1` | no |
| cors\_allowed\_origins | Origens de frontend autorizadas (API e upload). | `list(string)` | `[]` | no |
| db\_backup\_retention\_days | Dias de backup automático. | `number` | `1` | no |
| db\_deletion\_protection | Proteção contra destroy do RDS. | `bool` | `false` | no |
| db\_instance\_class | Classe da instância RDS. | `string` | `"db.t4g.micro"` | no |
| db\_multi\_az | RDS Multi-AZ. Em prod a validação em main.tf exige true. | `bool` | `false` | no |
| enable\_recommender | Cria o bucket de ML e, com recommender\_model\_version, o endpoint SageMaker de recomendação. | `bool` | `false` | no |
| lambda\_architecture | Arquitetura das Lambdas. | `string` | `"arm64"` | no |
| log\_retention\_days | Retenção de logs. | `number` | `14` | no |
| nat\_gateway\_per\_az | NAT por AZ (prod) ou único (dev/staging). | `bool` | `false` | no |
| project | Nome do projeto (prefixo de todos os recursos). | `string` | `"ecommerce-serverless"` | no |
| recommender\_max\_concurrency | Invocações simultâneas máximas do endpoint de recomendação. | `number` | `2` | no |
| recommender\_memory\_mb | Memória do endpoint serverless de recomendação. | `number` | `1024` | no |
| recommender\_model\_version | Versão publicada em s3://<bucket de ML>/models/<versão>/model.tar.gz (vazio = sem endpoint). | `string` | `""` | no |
| secrets\_version | Incremente para rotacionar JWT e senha do admin (write-only: o Terraform só reescreve quando a versão muda). | `number` | `1` | no |
| vpc\_cidr | CIDR da VPC. | `string` | `"10.20.0.0/16"` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| admin\_password\_secret\_arn | ARN do segredo com a senha do admin bootstrap (o valor não é exposto). |
| api\_endpoint | URL base da API (acrescente /api/v1). |
| dashboard\_url | Link do dashboard CloudWatch. |
| db\_multi\_az | Se o RDS tem standby Multi-AZ. |
| function\_names | Nomes das funções Lambda. |
| ml\_bucket | Bucket de ML: histórico exportado em training/, modelos em models/<versão>/ (null sem enable\_recommender). |
| ops\_function\_name | Função de operação (migrate, bootstrap-admin, smoke-fixture). |
| order\_events\_dlq\_url | DLQ dos eventos de pedido. |
| order\_events\_queue\_url | Fila de eventos de pedido. |
| recommender\_endpoint\_name | Endpoint SageMaker usado pela API (null até haver recommender\_model\_version). |
| uploads\_bucket | Bucket privado de uploads. |
<!-- END_TF_DOCS -->
