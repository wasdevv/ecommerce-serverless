# prod: Multi-AZ em tudo que guarda estado ou roteia saída (RDS, cache, NAT).
# O check "prod_is_multi_az" em main.tf recusa um plan que desligue isso.
environment              = "prod"
vpc_cidr                 = "10.40.0.0/16"
nat_gateway_per_az       = true
db_instance_class        = "db.t4g.small"
db_multi_az              = true
db_backup_retention_days = 7
db_deletion_protection   = true
cache_node_type          = "cache.t4g.small"
cache_nodes              = 2
log_retention_days       = 30
api_memory_mb            = 1024
