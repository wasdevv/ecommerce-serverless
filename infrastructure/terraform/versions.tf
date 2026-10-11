terraform {
  # 1.11+: write-only arguments (secret_string_wo) e recursos efêmeros, que
  # mantêm os segredos gerados fora do state. Lock do state nativo no S3
  # (use_lockfile) desde a 1.10 — sem tabela DynamoDB.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Configuração parcial: bucket/key/região vêm de backend.hcl por ambiente
  # (ver backend.hcl.example). State separado por ambiente e do relay do Swarm.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
