# Módulo `recommender`

Recomendação de produtos no SageMaker: bucket de ML (histórico exportado em `training/`, com expiração; artefatos em `models/<versão>/`), role de execução com leitura só de `models/`, e — quando `model_version` está preenchido — modelo com o container oficial de scikit-learn, configuração *serverless* e endpoint de nome estável. O fluxo completo está na seção "Recomendação de produtos" do README da raiz.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_iam_role.sagemaker](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_iam_role_policy.sagemaker](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy) | resource |
| [aws_s3_bucket.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) | resource |
| [aws_s3_bucket_lifecycle_configuration.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_lifecycle_configuration) | resource |
| [aws_s3_bucket_ownership_controls.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_ownership_controls) | resource |
| [aws_s3_bucket_policy.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy) | resource |
| [aws_s3_bucket_public_access_block.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block) | resource |
| [aws_s3_bucket_server_side_encryption_configuration.ml](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_server_side_encryption_configuration) | resource |
| [aws_sagemaker_endpoint.recommender](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sagemaker_endpoint) | resource |
| [aws_sagemaker_endpoint_configuration.recommender](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sagemaker_endpoint_configuration) | resource |
| [aws_sagemaker_model.recommender](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sagemaker_model) | resource |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_iam_policy_document.assume](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_iam_policy_document.bucket](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_iam_policy_document.sagemaker](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |
| [aws_sagemaker_prebuilt_ecr_image.sklearn](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/sagemaker_prebuilt_ecr_image) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| iam\_path | Path IAM dos roles do projeto. | `string` | n/a | yes |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| container\_image\_tag | Tag da imagem sagemaker-scikit-learn (o inference.py só usa a biblioteca padrão do Python). | `string` | `"1.2-1-cpu-py3"` | no |
| force\_destroy | Permite destroy com objetos no bucket (só para dev). | `bool` | `false` | no |
| max\_concurrency | Invocações simultâneas máximas do endpoint serverless. | `number` | `2` | no |
| memory\_size\_mb | Memória do endpoint serverless (1024 a 6144, múltiplos de 1024). | `number` | `1024` | no |
| model\_version | Pasta em models/ com o model.tar.gz publicado (vazio = só o bucket, sem endpoint). | `string` | `""` | no |
| training\_data\_retention\_days | Dias até expirar um export de histórico em training/. | `number` | `30` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| bucket\_arn | ARN do bucket de ML. |
| bucket\_name | Bucket de ML (training/ e models/). |
| endpoint\_arn | ARN do endpoint SageMaker (vazio enquanto não há model\_version). |
| endpoint\_name | Nome do endpoint SageMaker (vazio enquanto não há model\_version). |
<!-- END_TF_DOCS -->
