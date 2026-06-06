#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_REF="${DEPLOY_REF:-origin/main}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

cd "$(dirname "$0")/.."
# shellcheck source=lib/deploy-compat.sh
source "$(dirname "$0")/lib/deploy-compat.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  local line

  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

append_env_value() {
  local key="$1"
  local value="$2"

  {
    echo ""
    echo "# Managed override: added by production deploy compatibility checks."
    echo "${key}=${value}"
  } >> "$ENV_FILE"
}

ensure_compose_project_volumes "bizbil-prod" "$(legacy_compose_project_name "-prod")"

POSTGRES_TARGET_USER="$(get_env_value POSTGRES_USER || true)"
POSTGRES_TARGET_PASSWORD="$(get_env_value POSTGRES_PASSWORD || true)"
POSTGRES_TARGET_DB="$(get_env_value POSTGRES_DB || true)"
POSTGRES_LEGACY_USER="$(get_env_value POSTGRES_LEGACY_USER || true)"
POSTGRES_LEGACY_DB="$(get_env_value POSTGRES_LEGACY_DB || true)"

if [[ -z "$POSTGRES_TARGET_USER" ]]; then
  POSTGRES_TARGET_USER="bizbil"
fi

if [[ -z "$POSTGRES_TARGET_DB" ]]; then
  POSTGRES_TARGET_DB="bizbil"
fi

if [[ -z "$POSTGRES_LEGACY_DB" ]]; then
  POSTGRES_LEGACY_DB="$(legacy_database_name)"
fi

if [[ -z "$POSTGRES_TARGET_PASSWORD" ]]; then
  echo "POSTGRES_PASSWORD is required in $ENV_FILE" >&2
  exit 1
fi

find_postgres_admin_user() {
  local candidate
  local candidates=()
  local legacy_user

  candidates+=("$POSTGRES_TARGET_USER")
  if [[ -n "$POSTGRES_LEGACY_USER" ]]; then
    candidates+=("$POSTGRES_LEGACY_USER")
  fi
  legacy_user="$(legacy_database_user)"
  candidates+=("$legacy_user" "postgres")

  for candidate in "${candidates[@]}"; do
    if docker exec -u postgres "$POSTGRES_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U "$candidate" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

echo "==> Fetching latest code"
git fetch origin main
git checkout main
git reset --hard "$DEPLOY_REF"

echo "==> Building application images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web

echo "==> Starting dependencies"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis minio

POSTGRES_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q postgres)"
if [[ -z "$POSTGRES_CONTAINER" ]]; then
  echo "Could not determine the production postgres container." >&2
  exit 1
fi

echo "==> Waiting for production postgres readiness"
postgres_ready=false
for attempt in {1..30}; do
  if docker exec -u postgres "$POSTGRES_CONTAINER" pg_isready -d postgres >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 2
done

if [[ "$postgres_ready" != "true" ]]; then
  echo "Production postgres did not become ready." >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=120 postgres
  exit 1
fi

POSTGRES_ADMIN_USER="$(find_postgres_admin_user || true)"
if [[ -z "$POSTGRES_ADMIN_USER" ]]; then
  echo "Could not find a Postgres admin role. Tried ${POSTGRES_TARGET_USER}, ${POSTGRES_LEGACY_USER:-<empty>}, legacy app role, and postgres." >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=120 postgres
  exit 1
fi

reconcile_postgres_database_name \
  "$POSTGRES_CONTAINER" \
  "$POSTGRES_ADMIN_USER" \
  "$POSTGRES_TARGET_DB" \
  "$POSTGRES_LEGACY_DB"

echo "==> Reconciling production database credentials from $ENV_FILE"
docker exec -i -u postgres "$POSTGRES_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_ADMIN_USER" -d postgres \
    -v target_user="${POSTGRES_TARGET_USER}" \
    -v target_password="${POSTGRES_TARGET_PASSWORD}" \
    -v target_database="${POSTGRES_TARGET_DB}" <<'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'target_user', :'target_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'target_user')\gexec

ALTER ROLE :"target_user" WITH LOGIN PASSWORD :'target_password';

SELECT format('CREATE DATABASE %I OWNER %I', :'target_database', :'target_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'target_database')\gexec

ALTER DATABASE :"target_database" OWNER TO :"target_user";
SQL

echo "==> Running database migrations"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter @bizbil/api exec -- prisma migrate deploy --schema prisma/schema.prisma

echo "==> Restarting application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web caddy prometheus loki promtail grafana

echo "==> Service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps api web caddy postgres redis minio
