# dev: o mais barato que ainda reproduz a topologia (VPC, Proxy, TLS, fila).
# Single-AZ no RDS e no cache, NAT único, logs curtos.
environment              = "dev"
nat_gateway_per_az       = false
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 1
db_deletion_protection   = false
cache_node_type          = "cache.t4g.micro"
cache_nodes              = 1
log_retention_days       = 7
