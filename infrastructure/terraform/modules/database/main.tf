# PostgreSQL privado + RDS Proxy.
#
# Senha mestre gerenciada pelo próprio RDS (manage_master_user_password): o
# segredo nasce no Secrets Manager e nunca passa pelo Terraform nem pelo state.
# O Proxy autentica com esse segredo e as Lambdas também o leem para conectar
# no Proxy. Lambda -> Proxy -> RDS: o Proxy segura o pool, então um pico de
# Lambdas concorrentes não esgota max_connections do banco.

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "proxy" {
  name        = "${var.name}-db-proxy"
  description = "RDS Proxy: 5432 from Lambda only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_clients" {
  security_group_id            = aws_security_group.proxy.id
  description                  = "PostgreSQL from Lambda"
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  security_group_id            = aws_security_group.proxy.id
  description                  = "PostgreSQL to the DB instance"
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "RDS: 5432 from RDS Proxy only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from RDS Proxy"
  referenced_security_group_id = aws_security_group.proxy.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = "ecommerce"
  username                    = "ecommerce_admin"
  manage_master_user_password = true

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period    = var.backup_retention_days
  deletion_protection        = var.deletion_protection
  skip_final_snapshot        = !var.final_snapshot
  final_snapshot_identifier  = var.final_snapshot ? "${var.name}-final" : null
  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true
  apply_immediately          = !var.deletion_protection
}

data "aws_iam_policy_document" "proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.name}-db-proxy"
  path               = var.iam_path
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
}

data "aws_iam_policy_document" "proxy" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.this.master_user_secret[0].secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

data "aws_region" "current" {}

resource "aws_iam_role_policy" "proxy" {
  name   = "read-db-secret"
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.proxy.json
}

resource "aws_db_proxy" "this" {
  name                   = var.name
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = var.subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800

  auth {
    auth_scheme               = "SECRETS"
    iam_auth                  = "DISABLED"
    client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
    secret_arn                = aws_db_instance.this.master_user_secret[0].secret_arn
  }
}

resource "aws_db_proxy_default_target_group" "this" {
  db_proxy_name = aws_db_proxy.this.name
  connection_pool_config {
    max_connections_percent = 80
  }
}

resource "aws_db_proxy_target" "this" {
  db_proxy_name          = aws_db_proxy.this.name
  target_group_name      = aws_db_proxy_default_target_group.this.name
  db_instance_identifier = aws_db_instance.this.identifier
}
