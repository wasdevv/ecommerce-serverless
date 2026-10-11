output "bucket_name" {
  description = "Nome do bucket de uploads."
  value       = aws_s3_bucket.uploads.bucket
}

output "bucket_arn" {
  description = "ARN do bucket de uploads."
  value       = aws_s3_bucket.uploads.arn
}
