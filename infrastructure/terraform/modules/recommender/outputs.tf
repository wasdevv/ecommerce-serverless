output "bucket_name" {
  description = "Bucket de ML (training/ e models/)."
  value       = aws_s3_bucket.ml.bucket
}

output "bucket_arn" {
  description = "ARN do bucket de ML."
  value       = aws_s3_bucket.ml.arn
}

output "endpoint_name" {
  description = "Nome do endpoint SageMaker (vazio enquanto não há model_version)."
  value       = one(aws_sagemaker_endpoint.recommender[*].name)
}

output "endpoint_arn" {
  description = "ARN do endpoint SageMaker (vazio enquanto não há model_version)."
  value       = one(aws_sagemaker_endpoint.recommender[*].arn)
}
