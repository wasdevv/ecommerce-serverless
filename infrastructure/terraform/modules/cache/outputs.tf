output "primary_endpoint" {
  description = "Endpoint primário (TLS) do grupo de replicação."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "replication_group_id" {
  description = "ID do grupo (dimensão das métricas)."
  value       = aws_elasticache_replication_group.this.id
}
