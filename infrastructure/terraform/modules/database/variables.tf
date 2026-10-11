variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "vpc_id" {
  description = "VPC onde banco e proxy vivem."
  type        = string
}

variable "subnet_ids" {
  description = "Sub-redes privadas (2+ AZs)."
  type        = list(string)
}

variable "client_security_group_id" {
  description = "SG autorizado a conectar no RDS Proxy (o das Lambdas)."
  type        = string
}

variable "engine_version" {
  description = "Versão major do PostgreSQL; o RDS escolhe a minor default."
  type        = string
  default     = "17"
}

variable "instance_class" {
  description = "Classe da instância RDS."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Armazenamento inicial em GiB (autoscaling até o dobro)."
  type        = number
  default     = 20
}

variable "multi_az" {
  description = "Standby síncrono em outra AZ. Obrigatório em prod."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Dias de backup automático (0 desliga)."
  type        = number
  default     = 1
}

variable "deletion_protection" {
  description = "Impede destroy acidental (ligar em prod)."
  type        = bool
  default     = false
}

variable "final_snapshot" {
  description = "Gera snapshot final no destroy."
  type        = bool
  default     = false
}

variable "iam_path" {
  description = "Path IAM dos roles do projeto (o role de deploy só gerencia roles neste path)."
  type        = string
}
