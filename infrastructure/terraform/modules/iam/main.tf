# Um role por função, cada um com só o que aquela função faz:
#   api        -> lê segredos de DB/JWT, assina upload em users/*
#   dispatcher -> lê segredo de DB, envia para a fila
#   worker     -> lê segredo de DB, consome a fila
#   ops        -> lê segredos de DB e do admin bootstrap
# Com o recomendador ligado: api invoca o endpoint SageMaker, ops grava o
# export de histórico em training/ no bucket de ML.
# Com o assistente ligado: api lê a chave da Anthropic; api (pergunta) e ops
# (indexação do catálogo) invocam só o modelo de embeddings configurado.
# Comum a todos: escrever no próprio log group, ENIs da VPC e X-Ray.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id
  functions  = toset(["api", "dispatcher", "worker", "ops"])

  log_group_arn = { for f in local.functions : f => "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/${var.name}-${f}:*" }

  # ARN do endpoint montado a partir do nome (conhecido no plan); a AWS usa o
  # nome em minúsculas no ARN.
  recommender = var.recommender_endpoint_name == null ? [] : [
    { actions = ["sagemaker:InvokeEndpoint"], resources = ["arn:aws:sagemaker:${local.region}:${local.account_id}:endpoint/${lower(var.recommender_endpoint_name)}"] },
  ]
  training_export = var.ml_bucket_arn == null ? [] : [
    { actions = ["s3:PutObject"], resources = ["${var.ml_bucket_arn}/training/*"] },
  ]

  embeddings = var.embeddings_model_id == null ? [] : [
    { actions = ["bedrock:InvokeModel"], resources = ["arn:aws:bedrock:${local.region}::foundation-model/${var.embeddings_model_id}"] },
  ]
  assistant_secret = var.assistant_secret_arn == null ? [] : [
    { actions = ["secretsmanager:GetSecretValue"], resources = [var.assistant_secret_arn] },
  ]

  specific = {
    api = concat([
      { actions = ["secretsmanager:GetSecretValue"], resources = [var.db_secret_arn, var.jwt_secret_arn] },
      # A URL pré-assinada carrega a permissão de quem assina: sem este
      # PutObject o S3 recusaria o upload do cliente.
      { actions = ["s3:PutObject"], resources = ["${var.uploads_bucket_arn}/users/*"] },
    ], local.recommender, local.embeddings, local.assistant_secret)
    dispatcher = [
      { actions = ["secretsmanager:GetSecretValue"], resources = [var.db_secret_arn] },
      { actions = ["sqs:SendMessage"], resources = [var.queue_arn] },
    ]
    worker = [
      { actions = ["secretsmanager:GetSecretValue"], resources = [var.db_secret_arn] },
      { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"], resources = [var.queue_arn] },
    ]
    ops = concat([
      { actions = ["secretsmanager:GetSecretValue"], resources = [var.db_secret_arn, var.admin_password_secret_arn] },
    ], local.training_export, local.embeddings)
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "function" {
  for_each           = local.functions
  name               = "${var.name}-${each.key}"
  path               = var.iam_path
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "function" {
  for_each = local.functions

  statement {
    sid       = "OwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [local.log_group_arn[each.key]]
  }

  # ENIs da VPC e X-Ray não suportam restrição por recurso.
  statement {
    sid = "VpcNetworking"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  # Segredos do RDS usam a chave KMS gerenciada aws/secretsmanager.
  statement {
    sid       = "DecryptSecretsViaSecretsManager"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }

  dynamic "statement" {
    for_each = local.specific[each.key]
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  name     = "least-privilege"
  role     = aws_iam_role.function[each.key].id
  policy   = data.aws_iam_policy_document.function[each.key].json
}
