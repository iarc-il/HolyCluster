#!/bin/sh
set -eu

: "${GRAFANA_POSTGRES_USER:?Set GRAFANA_POSTGRES_USER to a dedicated read-only login}"
: "${GRAFANA_POSTGRES_PASSWORD:?Set GRAFANA_POSTGRES_PASSWORD}"
: "${PGUSER:?Set PGUSER to the database administrator}"

if [ "$GRAFANA_POSTGRES_USER" = "$PGUSER" ]; then
    echo 'Grafana must not use the application database login.' >&2
    exit 1
fi

exec psql -X --no-password --set=ON_ERROR_STOP=1 --file=/bootstrap/coverage-reader.sql
