#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_REF="${DEPLOY_REF:-origin/main}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

echo "==> Fetching latest code"
git fetch origin main
git checkout main
git reset --hard "$DEPLOY_REF"

echo "==> Building application images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web

echo "==> Starting dependencies"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis minio

echo "==> Running database migrations"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter @bizbil/api exec -- prisma migrate deploy --schema prisma/schema.prisma

echo "==> Restarting application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web caddy prometheus loki promtail grafana

echo "==> Service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps api web caddy postgres redis minio
