output "vpc_id" {
  description = "ID da VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "CIDR da VPC."
  value       = aws_vpc.this.cidr_block
}

output "private_subnet_ids" {
  description = "Sub-redes privadas (Lambda, RDS, Proxy, Redis)."
  value       = aws_subnet.private[*].id
}

output "lambda_security_group_id" {
  description = "Security group das Lambdas; os demais SGs liberam ingress a partir dele."
  value       = aws_security_group.lambda.id
}
