#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <git-ref>"
    exit 1
fi

REF="$1"

PREVIOUS_HEAD=$(git rev-parse HEAD)

git checkout "$REF" 2>/dev/null || git checkout -b "$REF" "origin/$REF" 2>/dev/null
# For branches like origin/dev, detach or reset
if [[ "$REF" == origin/* ]]; then
    BRANCH="${REF#origin/}"
    git checkout "$BRANCH" 2>/dev/null
    git reset --hard "$REF"
fi

CURRENT_HEAD=$(git rev-parse HEAD)

if [ "$PREVIOUS_HEAD" = "$CURRENT_HEAD" ]; then
    echo "No new commits. Nothing to deploy."
    exit 0
fi

CHANGED_FILES=$(git diff --name-only --relative "$PREVIOUS_HEAD" "$CURRENT_HEAD" -- .)

if [ -z "$CHANGED_FILES" ]; then
    echo "No files changed in backend/. Nothing to deploy."
    exit 0
fi

if grep -q '^SENTRY_RELEASE=' .env; then
    sed -i "s/^SENTRY_RELEASE=.*/SENTRY_RELEASE=$CURRENT_HEAD/" .env
else
    printf '\nSENTRY_RELEASE=%s\n' "$CURRENT_HEAD" >> .env
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
    echo "Changed files don't map to any services. Nothing to deploy."
    exit 0
fi

echo "Services to rebuild: $SERVICE_LIST"

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
    docker compose up -d --no-deps "$svc" &
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

echo "Deploy complete."
