# Módulo `apigateway`

HTTP API (v2) com rota $default para a função API, throttling e access log em JSON.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_apigatewayv2_api.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/apigatewayv2_api) | resource |
| [aws_apigatewayv2_integration.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/apigatewayv2_integration) | resource |
| [aws_apigatewayv2_route.default](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/apigatewayv2_route) | resource |
| [aws_apigatewayv2_stage.default](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/apigatewayv2_stage) | resource |
| [aws_cloudwatch_log_group.access](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudwatch_log_group) | resource |
| [aws_lambda_permission.api_gateway](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_permission) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| lambda\_function\_name | Nome da função API (para a permissão de invoke). | `string` | n/a | yes |
| lambda\_invoke\_arn | Invoke ARN da função API. | `string` | n/a | yes |
| name | Nome da API. | `string` | n/a | yes |
| cors\_allowed\_origins | Origens de frontend (vazio = sem CORS). | `list(string)` | `[]` | no |
| log\_retention\_days | Retenção do access log. | `number` | `14` | no |
| throttling\_burst\_limit | Burst máximo de requisições. | `number` | `50` | no |
| throttling\_rate\_limit | Requisições/s sustentadas. | `number` | `25` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| api\_endpoint | URL base pública da API. |
| api\_id | ID da HTTP API (dimensão das métricas). |
<!-- END_TF_DOCS -->
