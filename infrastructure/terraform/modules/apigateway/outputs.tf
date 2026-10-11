output "api_id" {
  description = "ID da HTTP API (dimensão das métricas)."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "URL base pública da API."
  value       = aws_apigatewayv2_api.this.api_endpoint
}
