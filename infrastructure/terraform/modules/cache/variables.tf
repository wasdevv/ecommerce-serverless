variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "vpc_id" {
  description = "VPC do cache."
  type        = string
}

variable "subnet_ids" {
  description = "Sub-redes privadas."
  type        = list(string)
}

variable "client_security_group_id" {
  description = "SG autorizado a conectar (o das Lambdas)."
  type        = string
}

variable "node_type" {
  description = "Tipo de nó ElastiCache."
  type        = string
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  description = "Versão do Valkey."
  type        = string
  default     = "8.0"
}

variable "num_cache_clusters" {
  description = "Nós no grupo (1 = sem réplica; 2+ = failover Multi-AZ)."
  type        = number
  default     = 1
}
