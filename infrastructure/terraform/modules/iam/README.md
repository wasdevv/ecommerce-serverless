# Módulo `iam`

Um role por função Lambda com o mínimo que cada uma usa (segredos específicos, fila, prefixo do bucket, próprio log group).

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_iam_role.function](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_iam_role_policy.function](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy) | resource |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_iam_policy_document.assume](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_iam_policy_document.function](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| admin\_password\_secret\_arn | Senha do admin bootstrap. | `string` | n/a | yes |
| db\_secret\_arn | Segredo do banco (gerenciado pelo RDS). | `string` | n/a | yes |
| iam\_path | Path IAM dos roles do projeto. | `string` | n/a | yes |
| jwt\_secret\_arn | Segredo de assinatura JWT. | `string` | n/a | yes |
| name | Prefixo dos recursos (também compõe o nome das funções). | `string` | n/a | yes |
| queue\_arn | Fila de eventos de pedido. | `string` | n/a | yes |
| uploads\_bucket\_arn | Bucket de uploads. | `string` | n/a | yes |
| ml\_bucket\_arn | Bucket de ML onde a ops grava o export de histórico (null = sem recomendador). | `string` | `null` | no |
| recommender\_endpoint\_name | Endpoint SageMaker que a API pode invocar (null = sem recomendador). | `string` | `null` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| role\_arns | ARN do role de cada função (api, dispatcher, worker, ops). |
<!-- END_TF_DOCS -->
