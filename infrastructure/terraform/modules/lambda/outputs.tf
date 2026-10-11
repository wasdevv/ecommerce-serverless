output "function_names" {
  description = "Nome de cada função."
  value       = { for k, f in aws_lambda_function.this : k => f.function_name }
}

output "api_invoke_arn" {
  description = "Invoke ARN da função API (para a integração do API Gateway)."
  value       = aws_lambda_function.this["api"].invoke_arn
}
