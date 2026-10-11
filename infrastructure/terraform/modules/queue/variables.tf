variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "Deve ser >= 6x o timeout do worker (recomendação AWS para event source mapping)."
  type        = number
  default     = 180
}

variable "max_receive_count" {
  description = "Tentativas antes de mover a mensagem para a DLQ."
  type        = number
  default     = 5
}
