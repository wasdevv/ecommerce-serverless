variable "name" {
  description = "Prefixo dos recursos (também compõe o nome das funções)."
  type        = string
}

variable "iam_path" {
  description = "Path IAM dos roles do projeto."
  type        = string
}

variable "db_secret_arn" {
  description = "Segredo do banco (gerenciado pelo RDS)."
  type        = string
}

variable "jwt_secret_arn" {
  description = "Segredo de assinatura JWT."
  type        = string
}

variable "admin_password_secret_arn" {
  description = "Senha do admin bootstrap."
  type        = string
}

variable "queue_arn" {
  description = "Fila de eventos de pedido."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "Bucket de uploads."
  type        = string
}

variable "recommender_endpoint_name" {
  description = "Endpoint SageMaker que a API pode invocar (null = sem recomendador)."
  type        = string
  default     = null
}

variable "assistant_secret_arn" {
  description = "Segredo com a chave da Anthropic que a API pode ler (null = assistente sem LLM)."
  type        = string
  default     = null
}

variable "embeddings_model_id" {
  description = "Modelo de embeddings do Bedrock que api e ops podem invocar (null = embeddings locais)."
  type        = string
  default     = null
}

variable "ml_bucket_arn" {
  description = "Bucket de ML onde a ops grava o export de histórico (null = sem recomendador)."
  type        = string
  default     = null
}
