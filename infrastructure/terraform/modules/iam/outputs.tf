output "role_arns" {
  description = "ARN do role de cada função (api, dispatcher, worker, ops)."
  value       = { for k, r in aws_iam_role.function : k => r.arn }
}
