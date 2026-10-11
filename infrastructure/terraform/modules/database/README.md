# Módulo `database`

PostgreSQL no RDS (privado, criptografado, senha mestre gerenciada pelo próprio RDS no Secrets Manager) atrás de um RDS Proxy com TLS obrigatório. Multi-AZ controlado por variável.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_db_instance.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance) | resource |
| [aws_db_proxy.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_proxy) | resource |
| [aws_db_proxy_default_target_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_proxy_default_target_group) | resource |
| [aws_db_proxy_target.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_proxy_target) | resource |
| [aws_db_subnet_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_subnet_group) | resource |
| [aws_iam_role.proxy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_iam_role_policy.proxy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy) | resource |
| [aws_security_group.db](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) | resource |
| [aws_security_group.proxy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) | resource |
| [aws_vpc_security_group_egress_rule.proxy_to_db](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule) | resource |
| [aws_vpc_security_group_ingress_rule.db_from_proxy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule) | resource |
| [aws_vpc_security_group_ingress_rule.proxy_from_clients](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule) | resource |
| [aws_iam_policy_document.proxy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_iam_policy_document.proxy_assume](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| client\_security\_group\_id | SG autorizado a conectar no RDS Proxy (o das Lambdas). | `string` | n/a | yes |
| iam\_path | Path IAM dos roles do projeto (o role de deploy só gerencia roles neste path). | `string` | n/a | yes |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| subnet\_ids | Sub-redes privadas (2+ AZs). | `list(string)` | n/a | yes |
| vpc\_id | VPC onde banco e proxy vivem. | `string` | n/a | yes |
| allocated\_storage | Armazenamento inicial em GiB (autoscaling até o dobro). | `number` | `20` | no |
| backup\_retention\_days | Dias de backup automático (0 desliga). | `number` | `1` | no |
| deletion\_protection | Impede destroy acidental (ligar em prod). | `bool` | `false` | no |
| engine\_version | Versão major do PostgreSQL; o RDS escolhe a minor default. | `string` | `"17"` | no |
| final\_snapshot | Gera snapshot final no destroy. | `bool` | `false` | no |
| instance\_class | Classe da instância RDS. | `string` | `"db.t4g.micro"` | no |
| multi\_az | Standby síncrono em outra AZ. Obrigatório em prod. | `bool` | `false` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| instance\_identifier | Identificador da instância RDS (dimensão das métricas). |
| master\_secret\_arn | ARN do segredo gerenciado pelo RDS (usuário/senha). Só o ARN, nunca o valor. |
| multi\_az | Se a instância tem standby Multi-AZ. |
| proxy\_endpoint | Endpoint do RDS Proxy (é o host que as Lambdas usam). |
<!-- END_TF_DOCS -->
