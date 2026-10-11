# Quatro funções a partir do mesmo zip de código + uma layer de dependências.
# O Terraform é o único dono do deploy: o source_code_hash muda quando o
# conteúdo do zip muda, e o apply publica o código novo. Não há
# "aws lambda update-function-code" paralelo no pipeline.

locals {
  # O ADOT (OpenTelemetry da AWS) é opcional: sem layer configurada, fica só o
  # X-Ray ativo nativo da Lambda.
  adot_enabled = var.adot_layer_arn != ""

  functions = {
    api = {
      handler = "src/handlers/api.handler"
      timeout = 15
      memory  = var.api_memory_mb
      env     = {}
    }
    dispatcher = {
      handler = "src/handlers/dispatcher.handler"
      timeout = 60
      memory  = 256
      env     = {}
    }
    worker = {
      handler = "src/handlers/worker.handler"
      timeout = var.worker_timeout_seconds
      memory  = 256
      env     = {}
    }
    ops = {
      handler = "src/handlers/ops.handler"
      timeout = 300
      memory  = 256
      env = {
        ADMIN_EMAIL               = var.admin_email
        ADMIN_PASSWORD_SECRET_ARN = var.admin_password_secret_arn
      }
    }
  }

  common_env = merge(
    {
      APP_ENV                = var.environment
      NODE_OPTIONS           = "--enable-source-maps"
      LOG_LEVEL              = var.log_level
      DB_HOST                = var.db_host
      DB_PORT                = "5432"
      DB_NAME                = "ecommerce"
      DB_SSL                 = "true"
      DB_POOL_MAX            = "2"
      DB_SECRET_ARN          = var.db_secret_arn
      JWT_SECRET_ARN         = var.jwt_secret_arn
      REDIS_URL              = "rediss://${var.redis_host}:6379/0"
      REDIS_TLS              = "true"
      ORDER_EVENTS_QUEUE_URL = var.queue_url
      UPLOADS_BUCKET         = var.uploads_bucket
      OTEL_SERVICE_NAME      = var.name
    },
    local.adot_enabled ? { AWS_LAMBDA_EXEC_WRAPPER = "/opt/otel-handler" } : {},
  )
}

resource "aws_lambda_layer_version" "deps" {
  layer_name               = "${var.name}-deps"
  filename                 = var.layer_zip_path
  source_code_hash         = filebase64sha256(var.layer_zip_path)
  compatible_runtimes      = [var.runtime]
  compatible_architectures = [var.architecture]
}

resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.functions

  function_name    = "${var.name}-${each.key}"
  role             = var.role_arns[each.key]
  runtime          = var.runtime
  architectures    = [var.architecture]
  handler          = each.value.handler
  filename         = var.function_zip_path
  source_code_hash = filebase64sha256(var.function_zip_path)
  layers           = compact([aws_lambda_layer_version.deps.arn, var.adot_layer_arn])
  timeout          = each.value.timeout
  memory_size      = each.value.memory

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = merge(local.common_env, each.value.env)
  }

  depends_on = [aws_cloudwatch_log_group.function]
}

# Worker: lote de até 10 mensagens; ReportBatchItemFailures faz o SQS
# reentregar só as que falharam (o handler devolve batchItemFailures).
resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn                   = var.queue_arn
  function_name                      = aws_lambda_function.this["worker"].arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 1
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    # Limita quantos workers simultâneos disputam conexões no Proxy.
    maximum_concurrency = 5
  }
}

# Dispatcher da outbox: EventBridge a cada minuto. Atraso máximo de
# publicação de um evento = 1 min (troca consciente por simplicidade).
resource "aws_cloudwatch_event_rule" "dispatcher" {
  name                = "${var.name}-outbox-dispatcher"
  description         = "Publishes pending outbox events to SQS"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "dispatcher" {
  rule = aws_cloudwatch_event_rule.dispatcher.name
  arn  = aws_lambda_function.this["dispatcher"].arn
}

resource "aws_lambda_permission" "dispatcher_schedule" {
  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["dispatcher"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dispatcher.arn
}
