#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_BRANCH="${DEPLOY_BRANCH:-develop}"
DEPLOY_REF="${DEPLOY_REF:-origin/${DEPLOY_BRANCH}}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.test.yml}"
ENV_FILE="${ENV_FILE:-.env.testing}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Create it from .env.testing.example and use testing-only secrets." >&2
  exit 1
fi

echo "==> Fetching latest ${DEPLOY_BRANCH} code"
git fetch origin "$DEPLOY_BRANCH"
git checkout -B "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
git reset --hard "$DEPLOY_REF"

echo "==> Building testing application images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web

echo "==> Starting testing dependencies"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis minio

echo "==> Running testing database migrations"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter @retailos/api exec -- prisma migrate deploy --schema prisma/schema.prisma; then
  echo "==> Testing migration failed; resetting the testing database and retrying migrations"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
    pnpm --filter @retailos/api exec -- prisma migrate reset --force --skip-seed --schema prisma/schema.prisma
fi

echo "==> Restarting testing application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web caddy

echo "==> Testing service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps api web caddy postgres redis minio
