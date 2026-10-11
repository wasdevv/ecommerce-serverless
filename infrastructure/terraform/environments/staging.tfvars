# staging: mesma topologia do dev, VPC separada para não colidir com dev.
environment              = "staging"
vpc_cidr                 = "10.30.0.0/16"
nat_gateway_per_az       = false
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 3
db_deletion_protection   = false
cache_node_type          = "cache.t4g.micro"
cache_nodes              = 1
log_retention_days       = 14
