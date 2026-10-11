output "state_bucket" {
  description = "Bucket do state remoto (vai no backend.hcl e na variável TF_STATE_BUCKET do GitHub)."
  value       = aws_s3_bucket.state.bucket
}

output "plan_role_arn" {
  description = "Role do plan em PR (variável AWS_PLAN_ROLE_ARN no GitHub)."
  value       = aws_iam_role.plan.arn
}

output "deploy_role_arns" {
  description = "Role de deploy por ambiente (variável AWS_DEPLOY_ROLE_ARN em cada GitHub Environment)."
  value       = { for k, r in aws_iam_role.deploy : k => r.arn }
}
