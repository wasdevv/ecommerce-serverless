output "proxy_endpoint" {
  description = "Endpoint do RDS Proxy (é o host que as Lambdas usam)."
  value       = aws_db_proxy.this.endpoint
}

output "master_secret_arn" {
  description = "ARN do segredo gerenciado pelo RDS (usuário/senha). Só o ARN, nunca o valor."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "instance_identifier" {
  description = "Identificador da instância RDS (dimensão das métricas)."
  value       = aws_db_instance.this.identifier
}

output "multi_az" {
  description = "Se a instância tem standby Multi-AZ."
  value       = aws_db_instance.this.multi_az
}
