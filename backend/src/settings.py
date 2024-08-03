from environs import Env

env = Env()
env.read_env()

PSQL_USERNAME=env.str("PSQL_USERNAME")
PSQL_PASSWORD=env.str("PSQL_PASSWORD")
