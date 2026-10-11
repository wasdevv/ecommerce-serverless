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
