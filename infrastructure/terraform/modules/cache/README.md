# Módulo `cache`

ElastiCache Valkey (compatível com Redis) com TLS em trânsito e criptografia em repouso; réplica com failover automático quando há 2+ nós.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_elasticache_replication_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/elasticache_replication_group) | resource |
| [aws_elasticache_subnet_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/elasticache_subnet_group) | resource |
| [aws_security_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) | resource |
| [aws_vpc_security_group_ingress_rule.from_clients](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| client\_security\_group\_id | SG autorizado a conectar (o das Lambdas). | `string` | n/a | yes |
| name | Prefixo dos recursos. | `string` | n/a | yes |
| subnet\_ids | Sub-redes privadas. | `list(string)` | n/a | yes |
| vpc\_id | VPC do cache. | `string` | n/a | yes |
| engine\_version | Versão do Valkey. | `string` | `"8.0"` | no |
| node\_type | Tipo de nó ElastiCache. | `string` | `"cache.t4g.micro"` | no |
| num\_cache\_clusters | Nós no grupo (1 = sem réplica; 2+ = failover Multi-AZ). | `number` | `1` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| primary\_endpoint | Endpoint primário (TLS) do grupo de replicação. |
| replication\_group\_id | ID do grupo (dimensão das métricas). |
<!-- END_TF_DOCS -->
