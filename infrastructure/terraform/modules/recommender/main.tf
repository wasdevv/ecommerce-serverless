# Recomendador de produtos no SageMaker, em duas fases:
#   1. bucket de ML (sempre que o módulo existe): recebe o histórico exportado
#      pela Lambda ops em training/ e o model.tar.gz em models/<versão>/.
#   2. modelo + endpoint (só com model_version preenchido): o SageMaker baixa
#      o artefato na criação do endpoint, então ele precisa existir no S3
#      antes — daí a versão vazia no primeiro apply.
#
# Endpoint *serverless*: sem instância ligada, cobra por invocação. Troca:
# cold start de alguns segundos depois de ocioso, que a API absorve com timeout
# curto e fallback para os mais vendidos.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  deploy_endpoint = var.model_version != ""
  model_key       = "models/${var.model_version}/model.tar.gz"
}

resource "aws_s3_bucket" "ml" {
  bucket        = "${var.name}-ml-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "ml" {
  bucket                  = aws_s3_bucket.ml.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "ml" {
  bucket = aws_s3_bucket.ml.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ml" {
  bucket = aws_s3_bucket.ml.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Histórico exportado é dado de cliente (mesmo anonimizado): não fica para sempre.
resource "aws_s3_bucket_lifecycle_configuration" "ml" {
  bucket = aws_s3_bucket.ml.id
  rule {
    id     = "expire-training-exports"
    status = "Enabled"
    filter {
      prefix = "training/"
    }
    expiration {
      days = var.training_data_retention_days
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.ml.arn, "${aws_s3_bucket.ml.arn}/*"]
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

resource "aws_s3_bucket_policy" "ml" {
  bucket     = aws_s3_bucket.ml.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.ml]
}

# ---------------------------------------------------------------- SageMaker

# Container oficial de scikit-learn da AWS: traz o servidor HTTP (/ping,
# /invocations) e carrega code/inference.py de dentro do model.tar.gz. O
# data source resolve a conta do registry de cada região.
data "aws_sagemaker_prebuilt_ecr_image" "sklearn" {
  repository_name = "sagemaker-scikit-learn"
  image_tag       = var.container_image_tag
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["sagemaker.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sagemaker" {
  name               = "${var.name}-recommender"
  path               = var.iam_path
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Só o necessário para hospedar: ler os artefatos de modelo, puxar a imagem
# e escrever logs/métricas. Sem acesso a training/ (dado de cliente).
data "aws_iam_policy_document" "sagemaker" {
  statement {
    sid       = "ReadModelArtifacts"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.ml.arn}/models/*"]
  }
  statement {
    sid       = "PullInferenceImage"
    actions   = ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = ["*"]
  }
  statement {
    sid       = "EndpointLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/sagemaker/*"]
  }
  statement {
    sid       = "EndpointMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["/aws/sagemaker/Endpoints"]
    }
  }
}

resource "aws_iam_role_policy" "sagemaker" {
  name   = "host-recommender"
  role   = aws_iam_role.sagemaker.id
  policy = data.aws_iam_policy_document.sagemaker.json
}

resource "aws_sagemaker_model" "recommender" {
  count              = local.deploy_endpoint ? 1 : 0
  execution_role_arn = aws_iam_role.sagemaker.arn

  primary_container {
    image          = data.aws_sagemaker_prebuilt_ecr_image.sklearn.registry_path
    model_data_url = "s3://${aws_s3_bucket.ml.bucket}/${local.model_key}"
    environment = {
      SAGEMAKER_PROGRAM          = "inference.py"
      SAGEMAKER_SUBMIT_DIRECTORY = "/opt/ml/model/code"
    }
  }

  tags = { ModelVersion = var.model_version }

  # Versão nova = modelo novo; o antigo só sai depois que o endpoint trocou.
  lifecycle {
    create_before_destroy = true
  }
  depends_on = [aws_iam_role_policy.sagemaker]
}

resource "aws_sagemaker_endpoint_configuration" "recommender" {
  count       = local.deploy_endpoint ? 1 : 0
  name_prefix = "${var.name}-rec-"

  production_variants {
    variant_name = "AllTraffic"
    model_name   = aws_sagemaker_model.recommender[0].name

    serverless_config {
      memory_size_in_mb = var.memory_size_mb
      max_concurrency   = var.max_concurrency
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# O endpoint mantém o nome entre versões: a Lambda não precisa de redeploy
# quando o modelo muda, só a configuração do endpoint é trocada.
resource "aws_sagemaker_endpoint" "recommender" {
  count                = local.deploy_endpoint ? 1 : 0
  name                 = "${var.name}-recommender"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.recommender[0].name
}
