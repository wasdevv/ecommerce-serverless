# Dashboard, alarmes e consultas salvas. O JSON do dashboard e as consultas
# moram em monitoring/ na raiz do repositório e são lidos daqui — uma única
# definição, versionada junto com o código.

data "aws_region" "current" {}

locals {
  region = data.aws_region.current.region
  function_list = [
    var.function_names["api"],
    var.function_names["dispatcher"],
    var.function_names["worker"],
    var.function_names["ops"],
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = templatefile(var.dashboard_template_path, {
    region     = local.region
    api_id     = var.api_id
    functions  = local.function_list
    queue_name = var.queue_name
    dlq_name   = var.dlq_name
  })
}

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "API returned 5xx responses"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id, Stage = "$default" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p95" {
  alarm_name          = "${var.name}-api-latency-p95"
  alarm_description   = "API p95 latency above ${var.latency_p95_threshold_ms} ms"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = var.api_id, Stage = "$default" }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.latency_p95_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = var.function_names
  alarm_name          = "${each.value}-errors"
  alarm_description   = "Lambda ${each.key} reported errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = var.function_names
  alarm_name          = "${each.value}-throttles"
  alarm_description   = "Lambda ${each.key} is being throttled"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

# Qualquer mensagem na DLQ é um evento de pedido que não virou notificação.
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name}-dlq-not-empty"
  alarm_description   = "Order events landed in the DLQ"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.dlq_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

# Mensagem velha na fila = worker parado ou lento.
resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${var.name}-queue-oldest-message"
  alarm_description   = "Oldest order event waiting more than 5 minutes"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = var.queue_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_query_definition" "this" {
  for_each        = fileset(var.queries_path, "*.query")
  name            = "${var.name}/${trimsuffix(each.value, ".query")}"
  log_group_names = [for f in local.function_list : "/aws/lambda/${f}"]
  query_string    = file("${var.queries_path}/${each.value}")
}
