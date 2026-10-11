# Fila de eventos de pedido + DLQ. Uma mensagem que falha max_receive_count
# vezes sai da fila principal e para na DLQ, onde dispara alarme e espera
# investigação (redrive manual pelo console ou CLI).

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-order-events-dlq"
  message_retention_seconds = 1209600 # 14 dias: tempo para investigar
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "main" {
  name                       = "${var.name}-order-events"
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = 345600 # 4 dias
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main.arn]
  })
}
