variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origens de frontend autorizadas a fazer upload direto (vazio = sem CORS)."
  type        = list(string)
  default     = []
}

variable "force_destroy" {
  description = "Permite destroy com objetos no bucket (só para dev)."
  type        = bool
  default     = false
}
