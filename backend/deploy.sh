#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <git-ref>"
    exit 1
fi

REF="$1"

PREVIOUS_HEAD=$(git rev-parse HEAD)

git checkout "$REF" 2>/dev/null || git checkout -b "$REF" "origin/$REF" 2>/dev/null || true
# For branches like origin/dev, detach or reset
if [[ "$REF" == origin/* ]]; then
    BRANCH="${REF#origin/}"
    git checkout "$BRANCH" 2>/dev/null || true
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

echo "Changed files:"
echo "$CHANGED_FILES"
echo ""

declare -A SERVICES
SERVICES=()

add_service() {
    SERVICES["$1"]=1
}

while IFS= read -r file; do
    case "$file" in
        docker-compose.yml|deploy.sh)
            add_service api
            add_service collector
            add_service monitor
            add_service nginx
            add_service postgres
            add_service valkey
            ;;
        shared/*)
            add_service api
            add_service collector
            add_service monitor
            ;;
        pyproject.toml|uv.lock)
            add_service api
            add_service collector
            add_service monitor
            ;;
        api/*|docker/Dockerfile.api)
            add_service api
            ;;
        collectors/*|docker/Dockerfile.collector)
            add_service collector
            ;;
        monitor/*|docker/Dockerfile.monitor)
            add_service monitor
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

# Stop monitor before rebuilding api or monitor to avoid health-check failures
if [[ -v SERVICES[api] || -v SERVICES[monitor] ]]; then
    echo "Stopping monitor before rebuild..."
    docker compose stop monitor
fi

echo "Building: $SERVICE_LIST"
docker compose build --parallel $SERVICE_LIST

echo "Starting: $SERVICE_LIST"

for svc in $SERVICE_LIST; do
    if [ "$svc" = "nginx" ]; then
        continue
    fi
    docker compose up -d --no-deps "$svc" &
done

wait

if [[ -v SERVICES[nginx] ]]; then
    docker compose up -d --no-deps nginx
fi

echo "Deploy complete."
