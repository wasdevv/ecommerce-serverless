variable "name" {
  description = "Prefixo das funções (nome final: <name>-api, <name>-worker...)."
  type        = string
}

variable "environment" {
  description = "dev, staging ou prod."
  type        = string
}

variable "runtime" {
  description = "Runtime Node.js da Lambda."
  type        = string
  default     = "nodejs24.x"
}

variable "architecture" {
  description = "arm64 (Graviton, ~20% mais barato por GB-s) ou x86_64."
  type        = string
  default     = "arm64"
}

variable "function_zip_path" {
  description = "Caminho do build/function.zip."
  type        = string
}

variable "layer_zip_path" {
  description = "Caminho do build/layer.zip."
  type        = string
}

variable "role_arns" {
  description = "Mapa função -> ARN do role (saída do módulo iam)."
  type        = map(string)
}

variable "subnet_ids" {
  description = "Sub-redes privadas."
  type        = list(string)
}

variable "security_group_id" {
  description = "SG das Lambdas."
  type        = string
}

variable "db_host" {
  description = "Endpoint do RDS Proxy."
  type        = string
}

variable "db_secret_arn" {
  description = "Segredo com usuário/senha do banco."
  type        = string
}

variable "jwt_secret_arn" {
  description = "Segredo de assinatura JWT."
  type        = string
}

variable "admin_password_secret_arn" {
  description = "Senha do admin bootstrap (lida só pela função ops)."
  type        = string
}

variable "admin_email" {
  description = "Email do admin bootstrap."
  type        = string
}

variable "redis_host" {
  description = "Endpoint primário do ElastiCache."
  type        = string
}

variable "queue_url" {
  description = "URL da fila de eventos."
  type        = string
}

variable "queue_arn" {
  description = "ARN da fila de eventos."
  type        = string
}

variable "uploads_bucket" {
  description = "Bucket de uploads."
  type        = string
}

variable "api_memory_mb" {
  description = "Memória da função API (CPU escala junto)."
  type        = number
  default     = 512
}

variable "worker_timeout_seconds" {
  description = "Timeout do worker; a visibilidade da fila deve ser >= 6x este valor."
  type        = number
  default     = 30
}

variable "log_level" {
  description = "Nível de log do pino."
  type        = string
  default     = "info"
}

variable "log_retention_days" {
  description = "Retenção dos log groups."
  type        = number
  default     = 14
}

variable "adot_layer_arn" {
  description = "ARN da layer ADOT/OpenTelemetry para Node.js (vazio = só X-Ray nativo). Confira o ARN atual na documentação da AWS."
  type        = string
  default     = ""
}
