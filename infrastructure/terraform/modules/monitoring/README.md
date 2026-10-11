# Módulo `monitoring`

Dashboard CloudWatch (template em monitoring/ na raiz), alarmes com SNS e consultas salvas do Logs Insights.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_cloudwatch_dashboard.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_dashboard) | resource |
| [aws_cloudwatch_metric_alarm.api_5xx](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.api_latency_p95](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.dlq_not_empty](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.lambda_errors](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.lambda_throttles](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_metric_alarm.queue_age](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_metric_alarm) | resource |
| [aws_cloudwatch_query_definition.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_query_definition) | resource |
| [aws_sns_topic.alarms](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sns_topic) | resource |
| [aws_sns_topic_subscription.email](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sns_topic_subscription) | resource |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| api\_id | ID da HTTP API. | `string` | n/a | yes |
| dashboard\_template\_path | Caminho do monitoring/dashboard.json.tftpl. | `string` | n/a | yes |
| dlq\_name | DLQ. | `string` | n/a | yes |
| function\_names | Mapa função -> nome (api, dispatcher, worker, ops). | `map(string)` | n/a | yes |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| queries\_path | Diretório com as consultas Logs Insights (*.query). | `string` | n/a | yes |
| queue\_name | Fila principal. | `string` | n/a | yes |
| alarm\_email | Email que recebe alarmes via SNS (vazio = sem assinatura; confirme o email recebido). | `string` | `""` | no |
| latency\_p95\_threshold\_ms | Limite de latência p95 da API. | `number` | `2000` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| alarm\_topic\_arn | Tópico SNS dos alarmes. |
| dashboard\_name | Nome do dashboard CloudWatch. |
<!-- END_TF_DOCS -->
