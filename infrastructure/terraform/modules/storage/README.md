# Módulo `storage`

Bucket S3 privado para uploads: Block Public Access completo, BucketOwnerEnforced (sem ACL), SSE, versionamento, lifecycle e negação de tráfego sem TLS.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_s3_bucket.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) | resource |
| [aws_s3_bucket_cors_configuration.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_cors_configuration) | resource |
| [aws_s3_bucket_lifecycle_configuration.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_lifecycle_configuration) | resource |
| [aws_s3_bucket_ownership_controls.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_ownership_controls) | resource |
| [aws_s3_bucket_policy.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy) | resource |
| [aws_s3_bucket_public_access_block.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block) | resource |
| [aws_s3_bucket_server_side_encryption_configuration.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_server_side_encryption_configuration) | resource |
| [aws_s3_bucket_versioning.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) | resource |
| [aws_caller_identity.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/caller_identity) | data source |
| [aws_iam_policy_document.uploads](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| cors\_allowed\_origins | Origens de frontend autorizadas a fazer upload direto (vazio = sem CORS). | `list(string)` | `[]` | no |
| force\_destroy | Permite destroy com objetos no bucket (só para dev). | `bool` | `false` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| bucket\_arn | ARN do bucket de uploads. |
| bucket\_name | Nome do bucket de uploads. |
<!-- END_TF_DOCS -->
