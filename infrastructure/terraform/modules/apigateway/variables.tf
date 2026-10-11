variable "name" {
  description = "Nome da API."
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Invoke ARN da função API."
  type        = string
}

variable "lambda_function_name" {
  description = "Nome da função API (para a permissão de invoke)."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origens de frontend (vazio = sem CORS)."
  type        = list(string)
  default     = []
}

variable "throttling_burst_limit" {
  description = "Burst máximo de requisições."
  type        = number
  default     = 50
}

variable "throttling_rate_limit" {
  description = "Requisições/s sustentadas."
  type        = number
  default     = 25
}

variable "log_retention_days" {
  description = "Retenção do access log."
  type        = number
  default     = 14
}
