#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <git-ref>"
    exit 1
fi

REF="$1"

PREVIOUS_HEAD=$(git rev-parse HEAD)
DEPLOYMENT_MARKER=$(git rev-parse --git-path holycluster-backend-deployed)
DEPLOYMENT_BASE="${DEPLOYMENT_MARKER}.base"

write_revision() {
    local target="$1" revision="$2" temporary
    temporary=$(mktemp "${target}.tmp.XXXXXX")
    if ! printf '%s\n' "$revision" > "$temporary" || ! mv "$temporary" "$target"; then
        rm -f "$temporary"
        return 1
    fi
}

mark_deployed() {
    write_revision "$DEPLOYMENT_MARKER" "$CURRENT_HEAD"
    rm -f "$DEPLOYMENT_BASE"
}

if [ -f "$DEPLOYMENT_MARKER" ]; then
    DEPLOYED_HEAD=$(< "$DEPLOYMENT_MARKER")
else
    # Preserve the first baseline if checkout advances before deployment fails.
    if [ ! -f "$DEPLOYMENT_BASE" ]; then
        write_revision "$DEPLOYMENT_BASE" "$PREVIOUS_HEAD"
    fi
    DEPLOYED_HEAD=$(< "$DEPLOYMENT_BASE")
fi

git checkout "$REF" 2>/dev/null || git checkout -b "$REF" "origin/$REF" 2>/dev/null
# For branches like origin/dev, detach or reset
if [[ "$REF" == origin/* ]]; then
    BRANCH="${REF#origin/}"
    git checkout "$BRANCH" 2>/dev/null
    git reset --hard "$REF"
fi

CURRENT_HEAD=$(git rev-parse HEAD)

if [ "$DEPLOYED_HEAD" = "$CURRENT_HEAD" ]; then
    GRAFANA_ID=$(docker compose ps --all --quiet grafana)
    GRAFANA_HEALTH_STATE=""
    if [ -n "$GRAFANA_ID" ]; then
        GRAFANA_HEALTH_STATE=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$GRAFANA_ID")
    fi
    if [ "$GRAFANA_HEALTH_STATE" = "running healthy" ]; then
        mark_deployed
        echo "No new commits. Nothing to deploy."
        exit 0
    fi
    echo "Recovering missing or unhealthy Grafana."
    CHANGED_FILES=infra/monitoring/grafana/recovery
else
    CHANGED_FILES=$(git diff --name-only --relative "$DEPLOYED_HEAD" "$CURRENT_HEAD" -- .)
fi

if [ -z "$CHANGED_FILES" ]; then
    mark_deployed
    echo "No files changed in backend/. Nothing to deploy."
    exit 0
fi

if [ "$DEPLOYED_HEAD" != "$CURRENT_HEAD" ]; then
    if grep -q '^SENTRY_RELEASE=' .env; then
        sed -i "s/^SENTRY_RELEASE=.*/SENTRY_RELEASE=$CURRENT_HEAD/" .env
    else
        printf '\nSENTRY_RELEASE=%s\n' "$CURRENT_HEAD" >> .env
    fi
fi

echo "Changed files:"
echo "$CHANGED_FILES"
echo ""

declare -A SERVICES
SERVICES=()
RUN_MIGRATIONS=false
COMPOSE_FILE_CHANGED=false

add_service() {
    SERVICES["$1"]=1
}

migrate_legacy_compose_containers() {
    local project_name="${COMPOSE_PROJECT_NAME:-}"
    if [ -z "$project_name" ] && [ -f .env ]; then
        project_name=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1)
    fi
    project_name="${project_name:-$(basename "$PWD")}"

    local legacy_project
    local name
    local legacy_names=(postgres valkey migrate collector api monitor nginx certbot nginx_ui)

    for name in "${legacy_names[@]}"; do
        if ! docker inspect "$name" >/dev/null 2>&1; then
            continue
        fi

        legacy_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$name" 2>/dev/null || true)
        if [ -n "$legacy_project" ] && [ "$legacy_project" != "$project_name" ]; then
            echo "Removing legacy Compose container $name from project $legacy_project..."
            docker rm -f "$name"
        fi
    done
}

run_migrations() {
    RUN_MIGRATIONS=true
}

while IFS= read -r file; do
    case "$file" in
        docker-compose.yml|deploy.sh)
            COMPOSE_FILE_CHANGED=true
            add_service api
            add_service collector
            add_service migrate
            add_service nginx
            add_service postgres
            add_service valkey
            add_service victoriametrics
            add_service grafana
            run_migrations
            ;;
        shared/*)
            add_service api
            add_service collector
            add_service migrate
            run_migrations
            ;;
        pyproject.toml|uv.lock)
            add_service api
            add_service collector
            add_service migrate
            run_migrations
            ;;
        alembic.ini|migrations/*|docker/Dockerfile.migrate)
            add_service migrate
            run_migrations
            ;;
        api/*|docker/Dockerfile.api)
            add_service api
            run_migrations
            ;;
        collectors/*|docker/Dockerfile.collector)
            add_service collector
            run_migrations
            ;;
        infra/nginx/*)
            add_service nginx
            ;;
        infra/monitoring/victoriametrics/*)
            add_service victoriametrics
            ;;
        infra/monitoring/grafana/*)
            add_service grafana
            ;;
        infra/postgres/*)
            add_service postgres
            ;;
        infra/valkey/*)
            add_service valkey
            ;;
    esac
done <<< "$CHANGED_FILES"

if [[ -v SERVICES[api] ]]; then
    add_service nginx
fi

SERVICE_LIST="${!SERVICES[*]}"

if [ -z "$SERVICE_LIST" ]; then
    mark_deployed
    echo "Changed files don't map to any services. Nothing to deploy."
    exit 0
fi

echo "Services to rebuild: $SERVICE_LIST"

if [ "$COMPOSE_FILE_CHANGED" = true ]; then
    docker compose config --quiet
    COMPOSE_ENVIRONMENT=$(docker compose config --environment)
    PROXY_NETWORK_NAME=$(printf '%s\n' "$COMPOSE_ENVIRONMENT" | sed -n 's/^PROXY_NETWORK=//p')
    # Match the proxy network's ${PROXY_NETWORK:-holycluster-proxy} Compose expression.
    PROXY_NETWORK_NAME="${PROXY_NETWORK_NAME:-holycluster-proxy}"
    docker network inspect "$PROXY_NETWORK_NAME" >/dev/null
fi

if [[ -v SERVICES[grafana] ]]; then
    echo "Checking Grafana credentials and data permissions..."
    docker compose run --rm --no-deps --user 0 --entrypoint /bin/sh grafana -ec '
        if [ -z "$GF_SECURITY_ADMIN_PASSWORD" ]; then
            echo "Set GRAFANA_ADMIN_PASSWORD before deploying Grafana." >&2
            exit 1
        fi
        # Dashboards are a separate read-only mount, not runtime data.
        find /var/lib/grafana -path /var/lib/grafana/dashboards -prune -o -exec chown -h 472:472 {} +
    '
    docker compose run --rm --no-deps --user 472:472 --entrypoint /bin/sh grafana -ec '
        if ! test -w /var/lib/grafana; then
            echo "Grafana data directory is not writable by UID 472." >&2
            exit 1
        fi
    '
fi

if [ "$COMPOSE_FILE_CHANGED" = true ]; then
    migrate_legacy_compose_containers
fi

echo "Building: $SERVICE_LIST"
docker compose build --parallel $SERVICE_LIST

if [ "$RUN_MIGRATIONS" = true ]; then
    echo "Running migrations..."
    docker compose up --abort-on-container-exit --exit-code-from migrate migrate
fi

echo "Starting: $SERVICE_LIST"

START_PIDS=()
START_SERVICES=()

for svc in $SERVICE_LIST; do
    if [ "$svc" = "nginx" ] || [ "$svc" = "migrate" ]; then
        continue
    fi
    # Bind-mounted scrape and provisioning files are read at startup.
    RECREATE_ARGS=()
    if [ "$svc" = "victoriametrics" ] || [ "$svc" = "grafana" ]; then
        RECREATE_ARGS+=(--force-recreate)
    fi
    docker compose up -d --no-deps "${RECREATE_ARGS[@]}" "$svc" &
    START_PIDS+=("$!")
    START_SERVICES+=("$svc")
done

START_STATUS=0
for i in "${!START_PIDS[@]}"; do
    if wait "${START_PIDS[$i]}"; then
        :
    else
        status=$?
        echo "Failed to start ${START_SERVICES[$i]} (exit $status)." >&2
        if [ "$START_STATUS" -eq 0 ]; then
            START_STATUS=$status
        fi
    fi
done

if [ "$START_STATUS" -ne 0 ]; then
    exit "$START_STATUS"
fi

if [[ -v SERVICES[nginx] ]]; then
    docker compose up -d --no-deps nginx
fi

if [ "$COMPOSE_FILE_CHANGED" = true ]; then
    docker compose up -d --no-deps certbot
fi

HEALTH_SERVICES=()
for svc in api collector nginx victoriametrics grafana; do
    if [[ -v SERVICES[$svc] ]]; then
        HEALTH_SERVICES+=("$svc")
    fi
done

if [ "${#HEALTH_SERVICES[@]}" -gt 0 ]; then
    echo "Waiting up to 120 seconds for service health: ${HEALTH_SERVICES[*]}"
    docker compose up -d --no-deps --wait --wait-timeout 120 "${HEALTH_SERVICES[@]}"
fi

mark_deployed
echo "Deploy complete."
