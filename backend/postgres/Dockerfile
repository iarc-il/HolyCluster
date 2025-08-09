# Use official Postgres image (bookworm or alpine as needed)
FROM postgres:16.9-bookworm

# Optional: copy initialization scripts if you have any
# COPY init.sql /docker-entrypoint-initdb.d/

# Expose default Postgres port
EXPOSE 5432

HEALTHCHECK --interval=5s --timeout=5s --retries=5 CMD pg_isready -U $POSTGRES_USER -d $POSTGRES_DB

