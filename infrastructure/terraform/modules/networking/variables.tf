variable "name" {
  description = "Prefixo dos recursos (projeto-ambiente)."
  type        = string
}

variable "cidr_block" {
  description = "CIDR da VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Quantidade de AZs (mínimo 2: o subnet group do RDS exige)."
  type        = number
  default     = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count deve ser 2 ou 3."
  }
}

variable "nat_gateway_per_az" {
  description = "Um NAT por AZ (alta disponibilidade, prod) ou um único NAT (dev, mais barato)."
  type        = bool
  default     = false
}
