# Módulo `networking`

VPC em 2 AZs com sub-redes públicas (só NAT) e privadas (Lambda, RDS, Proxy, cache), NAT Gateway único ou por AZ, endpoint de gateway do S3 e o security group das Lambdas.

<!-- BEGIN_TF_DOCS -->


## Providers

| Name | Version |
| ---- | ------- |
| aws | n/a |

## Resources

| Name | Type |
| ---- | ---- |
| [aws_default_security_group.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/default_security_group) | resource |
| [aws_eip.nat](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eip) | resource |
| [aws_internet_gateway.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/internet_gateway) | resource |
| [aws_nat_gateway.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway) | resource |
| [aws_route_table.private](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table) | resource |
| [aws_route_table.public](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table) | resource |
| [aws_route_table_association.private](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table_association) | resource |
| [aws_route_table_association.public](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table_association) | resource |
| [aws_security_group.lambda](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) | resource |
| [aws_subnet.private](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet) | resource |
| [aws_subnet.public](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet) | resource |
| [aws_vpc.this](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc) | resource |
| [aws_vpc_endpoint.s3](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_endpoint) | resource |
| [aws_vpc_security_group_egress_rule.lambda_all](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule) | resource |
| [aws_availability_zones.available](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/availability_zones) | data source |
| [aws_region.current](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/region) | data source |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| name | Prefixo dos recursos (projeto-ambiente). | `string` | n/a | yes |
| az\_count | Quantidade de AZs (mínimo 2: o subnet group do RDS exige). | `number` | `2` | no |
| cidr\_block | CIDR da VPC. | `string` | `"10.20.0.0/16"` | no |
| nat\_gateway\_per\_az | Um NAT por AZ (alta disponibilidade, prod) ou um único NAT (dev, mais barato). | `bool` | `false` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| lambda\_security\_group\_id | Security group das Lambdas; os demais SGs liberam ingress a partir dele. |
| private\_subnet\_ids | Sub-redes privadas (Lambda, RDS, Proxy, Redis). |
| vpc\_cidr\_block | CIDR da VPC. |
| vpc\_id | ID da VPC. |
<!-- END_TF_DOCS -->
