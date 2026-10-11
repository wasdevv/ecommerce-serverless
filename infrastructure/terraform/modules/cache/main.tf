# Valkey (fork open source e compatível com o protocolo Redis; ioredis conecta
# igual) com TLS em trânsito e criptografia em repouso. Sem AUTH token: o
# acesso é controlado por security group — ver docs/decisions.md.

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "this" {
  name        = "${var.name}-cache"
  description = "ElastiCache: 6379 from Lambda only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_clients" {
  security_group_id            = aws_security_group.this.id
  description                  = "Redis protocol from Lambda"
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.name
  description          = "Catalog cache for ${var.name}"
  engine               = "valkey"
  engine_version       = var.engine_version
  parameter_group_name = "default.valkey8"
  node_type            = var.node_type
  port                 = 6379

  # 1 nó no dev; 2+ habilita réplica, failover automático e Multi-AZ.
  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  apply_immediately          = true
}
