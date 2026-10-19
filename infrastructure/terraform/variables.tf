variable "project" {
  description = "Nome do projeto (prefixo de todos os recursos)."
  type        = string
  default     = "ecommerce-serverless"
}

variable "environment" {
  description = "Ambiente: dev, staging ou prod."
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment deve ser dev, staging ou prod."
  }
}

variable "aws_region" {
  description = "Região AWS."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR da VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "nat_gateway_per_az" {
  description = "NAT por AZ (prod) ou único (dev/staging)."
  type        = bool
  default     = false
}

variable "db_instance_class" {
  description = "Classe da instância RDS."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "RDS Multi-AZ. Em prod a validação em main.tf exige true."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Dias de backup automático."
  type        = number
  default     = 1
}

variable "db_deletion_protection" {
  description = "Proteção contra destroy do RDS."
  type        = bool
  default     = false
}

variable "cache_node_type" {
  description = "Tipo de nó ElastiCache."
  type        = string
  default     = "cache.t4g.micro"
}

variable "cache_nodes" {
  description = "Nós de cache (2+ = réplica com failover)."
  type        = number
  default     = 1
}

variable "lambda_architecture" {
  description = "Arquitetura das Lambdas."
  type        = string
  default     = "arm64"
}

variable "api_memory_mb" {
  description = "Memória da função API."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "Retenção de logs."
  type        = number
  default     = 14
}

variable "cors_allowed_origins" {
  description = "Origens de frontend autorizadas (API e upload)."
  type        = list(string)
  default     = []
}

variable "admin_email" {
  description = "Email do administrador criado pela ação bootstrap-admin."
  type        = string
  default     = "admin@example.com"
}

variable "alarm_email" {
  description = "Email para alarmes (vazio = sem assinatura)."
  type        = string
  default     = ""
}

variable "adot_layer_arn" {
  description = "Layer ADOT para Node.js (vazio = X-Ray nativo apenas)."
  type        = string
  default     = ""
}

variable "enable_recommender" {
  description = "Cria o bucket de ML e, com recommender_model_version, o endpoint SageMaker de recomendação."
  type        = bool
  default     = false
}

variable "recommender_model_version" {
  description = "Versão publicada em s3://<bucket de ML>/models/<versão>/model.tar.gz (vazio = sem endpoint)."
  type        = string
  default     = ""
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]*$", var.recommender_model_version))
    error_message = "recommender_model_version aceita só letras, números, ponto, hífen e sublinhado."
  }
}

variable "recommender_memory_mb" {
  description = "Memória do endpoint serverless de recomendação."
  type        = number
  default     = 1024
}

variable "recommender_max_concurrency" {
  description = "Invocações simultâneas máximas do endpoint de recomendação."
  type        = number
  default     = 2
}

variable "enable_assistant" {
  description = "Liga o assistente com LLM: cria o segredo da chave da Anthropic e usa embeddings do Bedrock (Titan)."
  type        = bool
  default     = false
}

variable "assistant_model" {
  description = "Modelo Claude que gera as respostas do assistente."
  type        = string
  default     = "claude-opus-5-5"
}

variable "embeddings_model_id" {
  description = "Modelo de embeddings no Bedrock (precisa de acesso liberado na conta, na região do deploy)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "secrets_version" {
  description = "Incremente para rotacionar JWT e senha do admin (write-only: o Terraform só reescreve quando a versão muda)."
  type        = number
  default     = 1
}

variable "artifacts_dir" {
  description = "Diretório com function.zip e layer.zip (gerados por scripts/build-lambda.sh)."
  type        = string
  default     = "../../build"
}
