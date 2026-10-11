# Bootstrap: o que precisa existir ANTES do primeiro "terraform init" do
# projeto, e por isso não pode estar no state que ele cria (ovo e galinha):
#   - bucket S3 do state remoto (versionado, criptografado, privado);
#   - provedor OIDC do GitHub e os roles que o CI assume, sem chave de acesso
#     permanente guardada no GitHub.
#
# Roda uma vez, de uma máquina com credencial de administrador, com state
# local (terraform.tfstate fica ignorado pelo git — guarde-o com cuidado ou
# migre-o para o próprio bucket depois, ver README).

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform-bootstrap" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  state_bucket = "${var.project}-tfstate-${local.account_id}"
  repo_subject = "repo:${var.github_repository}"
  iam_path     = "/${var.project}/"
}

# ------------------------------------------------------------ state bucket

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# ------------------------------------------------------------ GitHub OIDC

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Plan de PR: o token OIDC de um pull_request tem sub
# "repo:<owner>/<repo>:pull_request". PR de fork não recebe token com
# id-token: write, e o workflow ainda checa a origem — ver terraform-plan.yml.
data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.repo_subject}:pull_request"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "${var.project}-github-plan"
  path                 = local.iam_path
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_extra" {
  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
  # O refresh de aws_secretsmanager_secret_version lê a versão do segredo.
  # Restrito aos segredos do projeto; o risco é aceito porque só PR do próprio
  # repositório (colaborador com write) chega a assumir este role.
  statement {
    sid       = "RefreshProjectSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${local.account_id}:secret:${var.project}-*"]
  }
}

resource "aws_iam_role_policy" "plan_extra" {
  name   = "state-and-secrets"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_extra.json
}

# Deploy: um role por GitHub Environment. O sub
# "repo:<owner>/<repo>:environment:prod" só existe num job que declarou
# environment: prod — e esse environment exige aprovação no GitHub.
data "aws_iam_policy_document" "deploy_trust" {
  for_each = toset(var.environments)
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.repo_subject}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each             = toset(var.environments)
  name                 = "${var.project}-github-deploy-${each.key}"
  path                 = local.iam_path
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust[each.key].json
  max_session_duration = 3600
}

# O deploy cria VPC, RDS, Lambdas etc., então precisa de permissões amplas
# nesses serviços. O que fica fechado: IAM só no path do projeto (não dá para
# criar um role admin fora dele), e o state só no prefixo do ambiente.
data "aws_iam_policy_document" "deploy" {
  for_each = toset(var.environments)

  statement {
    sid = "ProjectServices"
    actions = [
      "apigateway:*", "cloudwatch:*", "ec2:*", "elasticache:*", "events:*",
      "lambda:*", "logs:*", "rds:*", "s3:*", "secretsmanager:*", "sns:*",
      "sqs:*", "xray:*", "sagemaker:*", "kms:DescribeKey", "kms:Decrypt", "kms:CreateGrant",
      "sts:GetCallerIdentity", "iam:CreateServiceLinkedRole",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ProjectRolesOnly"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:TagRole", "iam:UntagRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
      "iam:UpdateAssumeRolePolicy", "iam:ListInstanceProfilesForRole", "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role${local.iam_path}*"]
  }

  # Cada ambiente só escreve no próprio state (e no .tflock ao lado dele).
  statement {
    sid           = "DenyOtherStateKeys"
    effect        = "Deny"
    actions       = ["s3:PutObject", "s3:DeleteObject"]
    not_resources = ["${aws_s3_bucket.state.arn}/${var.project}/${each.key}/*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = toset(var.environments)
  name     = "deploy-${each.key}"
  role     = aws_iam_role.deploy[each.key].id
  policy   = data.aws_iam_policy_document.deploy[each.key].json
}
