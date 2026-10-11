variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "iam_path" {
  description = "Path IAM dos roles do projeto."
  type        = string
}

variable "model_version" {
  description = "Pasta em models/ com o model.tar.gz publicado (vazio = só o bucket, sem endpoint)."
  type        = string
  default     = ""
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]*$", var.model_version))
    error_message = "model_version aceita só letras, números, ponto, hífen e sublinhado."
  }
}

variable "container_image_tag" {
  description = "Tag da imagem sagemaker-scikit-learn (o inference.py só usa a biblioteca padrão do Python)."
  type        = string
  default     = "1.2-1-cpu-py3"
}

variable "memory_size_mb" {
  description = "Memória do endpoint serverless (1024 a 6144, múltiplos de 1024)."
  type        = number
  default     = 1024
  validation {
    condition     = contains([1024, 2048, 3072, 4096, 5120, 6144], var.memory_size_mb)
    error_message = "memory_size_mb deve ser 1024, 2048, 3072, 4096, 5120 ou 6144."
  }
}

variable "max_concurrency" {
  description = "Invocações simultâneas máximas do endpoint serverless."
  type        = number
  default     = 2
}

variable "training_data_retention_days" {
  description = "Dias até expirar um export de histórico em training/."
  type        = number
  default     = 30
}

variable "force_destroy" {
  description = "Permite destroy com objetos no bucket (só para dev)."
  type        = bool
  default     = false
}
