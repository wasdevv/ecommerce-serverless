variable "project" {
  description = "Nome do projeto."
  type        = string
  default     = "ecommerce-serverless"
}

variable "aws_region" {
  description = "Região do bucket de state."
  type        = string
  default     = "us-east-1"
}

variable "github_repository" {
  description = "owner/repo autorizado a assumir os roles via OIDC."
  type        = string
  default     = "wasdevv/ecommerce-serverless"
}

variable "environments" {
  description = "Ambientes com role de deploy próprio."
  type        = list(string)
  default     = ["dev", "staging", "prod"]
}
