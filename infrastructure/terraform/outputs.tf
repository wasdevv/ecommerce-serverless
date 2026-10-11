# Só identificadores e endpoints. Nenhum segredo sai daqui: senhas e chaves
# ficam no Secrets Manager e são lidas pelo ARN.

output "api_endpoint" {
  description = "URL base da API (acrescente /api/v1)."
  value       = module.apigateway.api_endpoint
}

output "function_names" {
  description = "Nomes das funções Lambda."
  value       = module.lambda.function_names
}

output "ops_function_name" {
  description = "Função de operação (migrate, bootstrap-admin, smoke-fixture)."
  value       = module.lambda.function_names["ops"]
}

output "order_events_queue_url" {
  description = "Fila de eventos de pedido."
  value       = module.queue.queue_url
}

output "order_events_dlq_url" {
  description = "DLQ dos eventos de pedido."
  value       = module.queue.dlq_url
}

output "uploads_bucket" {
  description = "Bucket privado de uploads."
  value       = module.storage.bucket_name
}

output "ml_bucket" {
  description = "Bucket de ML: histórico exportado em training/, modelos em models/<versão>/ (null sem enable_recommender)."
  value       = local.ml_bucket_name
}

output "recommender_endpoint_name" {
  description = "Endpoint SageMaker usado pela API (null até haver recommender_model_version)."
  value       = local.recommender_endpoint_name
}

output "admin_password_secret_arn" {
  description = "ARN do segredo com a senha do admin bootstrap (o valor não é exposto)."
  value       = aws_secretsmanager_secret.admin_password.arn
}

output "db_multi_az" {
  description = "Se o RDS tem standby Multi-AZ."
  value       = module.database.multi_az
}

output "dashboard_url" {
  description = "Link do dashboard CloudWatch."
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${module.monitoring.dashboard_name}"
}
