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
build_log="$(mktemp)"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web >"$build_log" 2>&1; then
  cat "$build_log"
  rm -f "$build_log"
  exit 1
fi
tail -n 40 "$build_log"
rm -f "$build_log"

echo "==> Starting testing dependencies"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis minio

echo "==> Running testing database migrations"
set +e
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter @retailos/api exec -- prisma migrate deploy --schema prisma/schema.prisma
migration_status=$?
set -e
if [[ "$migration_status" -ne 0 ]]; then
  echo "==> Testing migration failed; resetting the testing database and retrying migrations"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
    pnpm --filter @retailos/api exec -- prisma migrate reset --force --skip-seed --schema prisma/schema.prisma
fi

echo "==> Restarting testing application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans api web caddy

echo "==> Waiting for testing API readiness"
api_ready=false
for attempt in {1..30}; do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --status running --services api | grep -qx api; then
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/health').then(async (response) => { if (!response.ok) { console.error(await response.text()); process.exit(1); } }).catch((error) => { console.error(error); process.exit(1); })"; then
      api_ready=true
      break
    fi
  fi
  sleep 2
done

if [[ "$api_ready" != "true" ]]; then
  echo "Testing API did not become ready; dumping focused API diagnostics" >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 api
  exit 1
fi

echo "==> Waiting for testing proxy to reach API"
proxy_ready=false
for attempt in {1..30}; do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T caddy wget -qO- http://api:3001/health; then
    proxy_ready=true
    break
  fi
  sleep 2
done

if [[ "$proxy_ready" != "true" ]]; then
  echo "Testing proxy could not reach API; dumping focused network diagnostics" >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a
  echo "--- container networks ---"
  docker inspect \
    "$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q api)" \
    "$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q caddy)" \
    --format '{{.Name}} {{json .NetworkSettings.Networks}}'
  echo "--- caddy resolver ---"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T caddy cat /etc/resolv.conf || true
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T caddy nslookup api || true
  echo "--- api logs ---"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=120 api
  echo "--- caddy logs ---"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=80 caddy
  exit 1
fi

echo "==> Testing service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps api web caddy postgres redis minio
