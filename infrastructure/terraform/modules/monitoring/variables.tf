variable "name" {
  description = "Prefixo dos recursos."
  type        = string
}

variable "api_id" {
  description = "ID da HTTP API."
  type        = string
}

variable "function_names" {
  description = "Mapa função -> nome (api, dispatcher, worker, ops)."
  type        = map(string)
}

variable "queue_name" {
  description = "Fila principal."
  type        = string
}

variable "dlq_name" {
  description = "DLQ."
  type        = string
}

variable "dashboard_template_path" {
  description = "Caminho do monitoring/dashboard.json.tftpl."
  type        = string
}

variable "queries_path" {
  description = "Diretório com as consultas Logs Insights (*.query)."
  type        = string
}

variable "alarm_email" {
  description = "Email que recebe alarmes via SNS (vazio = sem assinatura; confirme o email recebido)."
  type        = string
  default     = ""
}

variable "latency_p95_threshold_ms" {
  description = "Limite de latência p95 da API."
  type        = number
  default     = 2000
}
