locals {
  name     = "${var.project}-${var.environment}"
  iam_path = "/${var.project}/"
  repo     = "${path.root}/../.."
}

# Prod sem Multi-AZ é erro de configuração, não escolha: a checagem para o
# plan antes de criar qualquer coisa.
check "prod_is_multi_az" {
  assert {
    condition     = var.environment != "prod" || (var.db_multi_az && var.cache_nodes > 1 && var.nat_gateway_per_az)
    error_message = "prod exige db_multi_az = true, cache_nodes >= 2 e nat_gateway_per_az = true."
  }
}

# ---------------------------------------------------------------- segredos
# Gerados como valores efêmeros e gravados por argumento write-only: o
# Secrets Manager recebe o valor, o state do Terraform não.

ephemeral "random_password" "jwt" {
  length  = 64
  special = false
}

ephemeral "random_password" "admin" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/jwt-signing-key"
  description             = "HS256 signing key for API access tokens"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id                = aws_secretsmanager_secret.jwt.id
  secret_string_wo         = ephemeral.random_password.jwt.result
  secret_string_wo_version = var.secrets_version
}

resource "aws_secretsmanager_secret" "admin_password" {
  name                    = "${local.name}/admin-bootstrap-password"
  description             = "Password for the bootstrap admin (read it from Secrets Manager, never from outputs)"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "admin_password" {
  secret_id                = aws_secretsmanager_secret.admin_password.id
  secret_string_wo         = ephemeral.random_password.admin.result
  secret_string_wo_version = var.secrets_version
}

# Chave da API da Anthropic para o assistente. O Terraform cria só o
# contêiner: o valor entra por fora (aws secretsmanager put-secret-value) e
# nunca passa pelo state nem pelo repositório. Sem valor, o assistente
# responde só com a busca, sem LLM.
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  count                   = var.enable_assistant ? 1 : 0
  name                    = "${local.name}/anthropic-api-key"
  description             = "Anthropic API key for the shopping assistant (set out of band)"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

locals {
  assistant_secret_arn = try(aws_secretsmanager_secret.anthropic_api_key[0].arn, null)
  # Embeddings do Titan só com o assistente ligado; sem ele, o hashing local.
  embeddings_model_id = var.enable_assistant ? var.embeddings_model_id : null
}

# ---------------------------------------------------------------- módulos

module "networking" {
  source             = "./modules/networking"
  name               = local.name
  cidr_block         = var.vpc_cidr
  nat_gateway_per_az = var.nat_gateway_per_az
}

module "database" {
  source                   = "./modules/database"
  name                     = local.name
  vpc_id                   = module.networking.vpc_id
  subnet_ids               = module.networking.private_subnet_ids
  client_security_group_id = module.networking.lambda_security_group_id
  instance_class           = var.db_instance_class
  multi_az                 = var.db_multi_az
  backup_retention_days    = var.db_backup_retention_days
  deletion_protection      = var.db_deletion_protection
  final_snapshot           = var.environment == "prod"
  iam_path                 = local.iam_path
}

module "cache" {
  source                   = "./modules/cache"
  name                     = local.name
  vpc_id                   = module.networking.vpc_id
  subnet_ids               = module.networking.private_subnet_ids
  client_security_group_id = module.networking.lambda_security_group_id
  node_type                = var.cache_node_type
  num_cache_clusters       = var.cache_nodes
}

module "storage" {
  source               = "./modules/storage"
  name                 = local.name
  cors_allowed_origins = var.cors_allowed_origins
  force_destroy        = var.environment == "dev"
}

module "queue" {
  source = "./modules/queue"
  name   = local.name
  # 6x o timeout do worker (30 s), conforme recomendação da AWS.
  visibility_timeout_seconds = 180
}

# Recomendador (opcional): bucket de ML sempre que ligado; modelo e endpoint
# SageMaker só depois que um model.tar.gz foi publicado em models/<versão>/.
module "recommender" {
  count           = var.enable_recommender ? 1 : 0
  source          = "./modules/recommender"
  name            = local.name
  iam_path        = local.iam_path
  model_version   = var.recommender_model_version
  memory_size_mb  = var.recommender_memory_mb
  max_concurrency = var.recommender_max_concurrency
  force_destroy   = var.environment == "dev"
}

locals {
  recommender_endpoint_name = try(module.recommender[0].endpoint_name, null)
  ml_bucket_name            = try(module.recommender[0].bucket_name, null)
  ml_bucket_arn             = try(module.recommender[0].bucket_arn, null)
}

module "iam" {
  source                    = "./modules/iam"
  name                      = local.name
  iam_path                  = local.iam_path
  db_secret_arn             = module.database.master_secret_arn
  jwt_secret_arn            = aws_secretsmanager_secret.jwt.arn
  admin_password_secret_arn = aws_secretsmanager_secret.admin_password.arn
  queue_arn                 = module.queue.queue_arn
  uploads_bucket_arn        = module.storage.bucket_arn
  recommender_endpoint_name = local.recommender_endpoint_name
  ml_bucket_arn             = local.ml_bucket_arn
  assistant_secret_arn      = local.assistant_secret_arn
  embeddings_model_id       = local.embeddings_model_id
}

module "lambda" {
  source                    = "./modules/lambda"
  name                      = local.name
  environment               = var.environment
  architecture              = var.lambda_architecture
  function_zip_path         = "${var.artifacts_dir}/function.zip"
  layer_zip_path            = "${var.artifacts_dir}/layer.zip"
  role_arns                 = module.iam.role_arns
  subnet_ids                = module.networking.private_subnet_ids
  security_group_id         = module.networking.lambda_security_group_id
  db_host                   = module.database.proxy_endpoint
  db_secret_arn             = module.database.master_secret_arn
  jwt_secret_arn            = aws_secretsmanager_secret.jwt.arn
  admin_password_secret_arn = aws_secretsmanager_secret.admin_password.arn
  admin_email               = var.admin_email
  redis_host                = module.cache.primary_endpoint
  queue_url                 = module.queue.queue_url
  queue_arn                 = module.queue.queue_arn
  uploads_bucket            = module.storage.bucket_name
  api_memory_mb             = var.api_memory_mb
  worker_timeout_seconds    = 30
  log_retention_days        = var.log_retention_days
  adot_layer_arn            = var.adot_layer_arn
  recommender_endpoint_name = local.recommender_endpoint_name
  ml_bucket                 = local.ml_bucket_name
  assistant_secret_arn      = local.assistant_secret_arn
  assistant_model           = var.assistant_model
  embeddings_model_id       = local.embeddings_model_id
}

module "apigateway" {
  source               = "./modules/apigateway"
  name                 = local.name
  lambda_invoke_arn    = module.lambda.api_invoke_arn
  lambda_function_name = module.lambda.function_names["api"]
  cors_allowed_origins = var.cors_allowed_origins
  log_retention_days   = var.log_retention_days
}

module "monitoring" {
  source                  = "./modules/monitoring"
  name                    = local.name
  api_id                  = module.apigateway.api_id
  function_names          = module.lambda.function_names
  queue_name              = module.queue.queue_name
  dlq_name                = module.queue.dlq_name
  dashboard_template_path = "${local.repo}/monitoring/dashboard.json.tftpl"
  queries_path            = "${local.repo}/monitoring/queries"
  alarm_email             = var.alarm_email
}
