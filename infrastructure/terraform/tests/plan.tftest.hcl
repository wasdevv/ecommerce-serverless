# Plan dos três ambientes contra um provider AWS simulado (mock_provider):
# prova que a configuração resolve, que os perfis divergem onde devem e que as
# guardas de segurança estão no plano — sem conta AWS e sem custo.
# NÃO substitui um plan real: o mock não valida nomes, cotas nem permissões.
#
#   terraform init -backend=false && terraform test
# (requer build/function.zip e build/layer.zip: scripts/build-lambda.sh)

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b", "us-east-1c"] }
  }
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds-db", kms_key_id = "", secret_status = "active" }]
    }
  }
  mock_data "aws_sagemaker_prebuilt_ecr_image" {
    defaults = { registry_path = "683313688378.dkr.ecr.us-east-1.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3" }
  }
  mock_resource "aws_lambda_function" {
    defaults = { invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:x/invocations" }
  }
}

run "dev_is_single_az_and_cheap" {
  command = plan
  variables {
    environment        = "dev"
    nat_gateway_per_az = false
    db_multi_az        = false
    cache_nodes        = 1
  }

  assert {
    condition     = module.database.multi_az == false
    error_message = "dev não deveria pagar Multi-AZ"
  }
  assert {
    condition     = length(module.networking.private_subnet_ids) == 2
    error_message = "VPC deve ter 2 sub-redes privadas"
  }
  assert {
    condition     = length(module.lambda.function_names) == 4
    error_message = "esperadas 4 funções: api, dispatcher, worker, ops"
  }
  assert {
    condition     = length(module.recommender) == 0 && output.recommender_endpoint_name == null
    error_message = "recomendador é opt-in: sem enable_recommender não há bucket nem endpoint"
  }
  assert {
    condition     = output.assistant_secret_arn == null && local.embeddings_model_id == null
    error_message = "assistente com LLM é opt-in: sem enable_assistant não há segredo nem Bedrock"
  }
}

run "assistant_creates_an_empty_key_secret" {
  command = plan
  variables {
    environment      = "dev"
    enable_assistant = true
  }
  assert {
    condition     = length(aws_secretsmanager_secret.anthropic_api_key) == 1
    error_message = "assistente ligado deve criar o segredo da chave da Anthropic"
  }
  assert {
    condition     = local.embeddings_model_id == "amazon.titan-embed-text-v2:0"
    error_message = "assistente ligado deve usar embeddings do Bedrock"
  }
}

run "recommender_waits_for_a_published_model" {
  command = plan
  variables {
    environment        = "dev"
    enable_recommender = true
  }
  assert {
    condition     = output.ml_bucket == "ecommerce-serverless-dev-ml-123456789012"
    error_message = "bucket de ML deve existir assim que o recomendador é ligado"
  }
  assert {
    condition     = output.recommender_endpoint_name == null
    error_message = "sem model_version não pode haver endpoint (o SageMaker falharia ao baixar o artefato)"
  }
}

run "recommender_endpoint_with_model_version" {
  command = plan
  variables {
    environment               = "dev"
    enable_recommender        = true
    recommender_model_version = "2304ffdab9fb"
  }
  assert {
    condition     = output.recommender_endpoint_name == "ecommerce-serverless-dev-recommender"
    error_message = "endpoint deve ter nome estável entre versões do modelo"
  }
}

run "recommender_rejects_path_like_versions" {
  command = plan
  variables {
    environment               = "dev"
    enable_recommender        = true
    recommender_model_version = "../training"
  }
  expect_failures = [var.recommender_model_version]
}

run "prod_is_multi_az" {
  command = plan
  variables {
    environment            = "prod"
    nat_gateway_per_az     = true
    db_multi_az            = true
    db_deletion_protection = true
    cache_nodes            = 2
  }

  assert {
    condition     = module.database.multi_az
    error_message = "prod exige RDS Multi-AZ"
  }
}

run "prod_without_multi_az_is_rejected" {
  command = plan
  variables {
    environment = "prod"
    db_multi_az = false
  }
  expect_failures = [check.prod_is_multi_az]
}

run "staging_plans" {
  command = plan
  variables {
    environment = "staging"
    vpc_cidr    = "10.30.0.0/16"
  }
  assert {
    condition     = output.ops_function_name == "ecommerce-serverless-staging-ops"
    error_message = "nomes de recursos devem levar o ambiente"
  }
}

run "unknown_environment_is_rejected" {
  command = plan
  variables {
    environment = "qa"
  }
  expect_failures = [var.environment]
}
