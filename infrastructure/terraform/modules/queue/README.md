# Módulo `queue`

Fila SQS de eventos de pedido com DLQ (redrive após N tentativas) e criptografia gerenciada.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_sqs_queue.dlq](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue) | resource |
| [aws_sqs_queue.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue) | resource |
| [aws_sqs_queue_redrive_allow_policy.dlq](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sqs_queue_redrive_allow_policy) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| max\_receive\_count | Tentativas antes de mover a mensagem para a DLQ. | `number` | `5` | no |
| visibility\_timeout\_seconds | Deve ser >= 6x o timeout do worker (recomendação AWS para event source mapping). | `number` | `180` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| dlq\_name | Nome da DLQ (dimensão do alarme). |
| dlq\_url | URL da DLQ. |
| queue\_arn | ARN da fila principal. |
| queue\_name | Nome da fila principal. |
| queue\_url | URL da fila principal. |
<!-- END_TF_DOCS -->
