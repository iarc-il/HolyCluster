#!/usr/bin/env bash
set -euo pipefail

BACKEND_IMAGE_RETENTION=${BACKEND_IMAGE_RETENTION:-168h}
GLOBAL_IMAGE_RETENTION=${GLOBAL_IMAGE_RETENTION:-720h}
BUILD_CACHE_MAX=${BUILD_CACHE_MAX:-4gb}
BUILD_CACHE_RESERVED=${BUILD_CACHE_RESERVED:-2gb}

project_name=${COMPOSE_PROJECT_NAME:-}
if [ -z "$project_name" ] && [ -f .env ]; then
    project_name=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1)
fi
if [ -z "$project_name" ]; then
    echo "COMPOSE_PROJECT_NAME is required for Docker cleanup." >&2
    exit 1
fi

echo "Docker disk usage before cleanup:"
docker system df

echo "Removing unused $project_name images older than $BACKEND_IMAGE_RETENTION..."
docker image prune --all --force \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter "until=$BACKEND_IMAGE_RETENTION"

if [ "$project_name" != backend ]; then
    echo "Removing unused legacy backend images older than $BACKEND_IMAGE_RETENTION..."
    docker image prune --all --force \
        --filter "label=com.docker.compose.project=backend" \
        --filter "until=$BACKEND_IMAGE_RETENTION"
fi

echo "Removing all unused images older than $GLOBAL_IMAGE_RETENTION..."
docker image prune --all --force --filter "until=$GLOBAL_IMAGE_RETENTION"

echo "Limiting BuildKit cache to $BUILD_CACHE_MAX..."
docker buildx prune --all --force \
    --max-used-space "$BUILD_CACHE_MAX" \
    --reserved-space "$BUILD_CACHE_RESERVED"

echo "Docker disk usage after cleanup:"
docker system df
