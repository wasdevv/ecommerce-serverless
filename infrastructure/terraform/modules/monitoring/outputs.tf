output "dashboard_name" {
  description = "Nome do dashboard CloudWatch."
  value       = aws_cloudwatch_dashboard.this.dashboard_name
}

output "alarm_topic_arn" {
  description = "Tópico SNS dos alarmes."
  value       = aws_sns_topic.alarms.arn
}
