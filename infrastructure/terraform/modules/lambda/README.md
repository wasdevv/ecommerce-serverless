# Módulo `lambda`

Layer de dependências, quatro funções (api, dispatcher, worker, ops) a partir do mesmo zip, X-Ray ativo, event source mapping do SQS com partial batch response e agendamento do dispatcher no EventBridge.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_cloudwatch_event_rule.dispatcher](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_rule) | resource |
| [aws_cloudwatch_event_target.dispatcher](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_event_target) | resource |
| [aws_cloudwatch_log_group.function](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_log_group) | resource |
| [aws_lambda_event_source_mapping.worker](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_event_source_mapping) | resource |
| [aws_lambda_function.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function) | resource |
| [aws_lambda_layer_version.deps](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_layer_version) | resource |
| [aws_lambda_permission.dispatcher_schedule](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_permission) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| admin\_email | Email do admin bootstrap. | `string` | n/a | yes |
| admin\_password\_secret\_arn | Senha do admin bootstrap (lida só pela função ops). | `string` | n/a | yes |
| db\_host | Endpoint do RDS Proxy. | `string` | n/a | yes |
| db\_secret\_arn | Segredo com usuário/senha do banco. | `string` | n/a | yes |
| environment | dev, staging ou prod. | `string` | n/a | yes |
| function\_zip\_path | Caminho do build/function.zip. | `string` | n/a | yes |
| jwt\_secret\_arn | Segredo de assinatura JWT. | `string` | n/a | yes |
| layer\_zip\_path | Caminho do build/layer.zip. | `string` | n/a | yes |
| name | Prefixo das funções (nome final: <name>-api, <name>-worker...). | `string` | n/a | yes |
| queue\_arn | ARN da fila de eventos. | `string` | n/a | yes |
| queue\_url | URL da fila de eventos. | `string` | n/a | yes |
| redis\_host | Endpoint primário do ElastiCache. | `string` | n/a | yes |
| role\_arns | Mapa função -> ARN do role (saída do módulo iam). | `map(string)` | n/a | yes |
| security\_group\_id | SG das Lambdas. | `string` | n/a | yes |
| subnet\_ids | Sub-redes privadas. | `list(string)` | n/a | yes |
| uploads\_bucket | Bucket de uploads. | `string` | n/a | yes |
| adot\_layer\_arn | ARN da layer ADOT/OpenTelemetry para Node.js (vazio = só X-Ray nativo). Confira o ARN atual na documentação da AWS. | `string` | `""` | no |
| api\_memory\_mb | Memória da função API (CPU escala junto). | `number` | `512` | no |
| architecture | arm64 (Graviton, ~20% mais barato por GB-s) ou x86\_64. | `string` | `"arm64"` | no |
| log\_level | Nível de log do pino. | `string` | `"info"` | no |
| log\_retention\_days | Retenção dos log groups. | `number` | `14` | no |
| runtime | Runtime Node.js da Lambda. | `string` | `"nodejs24.x"` | no |
| worker\_timeout\_seconds | Timeout do worker; a visibilidade da fila deve ser >= 6x este valor. | `number` | `30` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| api\_invoke\_arn | Invoke ARN da função API (para a integração do API Gateway). |
| function\_names | Nome de cada função. |
<!-- END_TF_DOCS -->
