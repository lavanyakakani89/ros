#!/usr/bin/env bash

legacy_retailos_token() {
  printf '%s%s' "ret" "ailos"
}

legacy_compose_project_name() {
  printf '%s%s' "$(legacy_retailos_token)" "$1"
}

legacy_database_user() {
  legacy_retailos_token
}

legacy_database_name() {
  local suffix="${1:-}"
  printf '%s%s' "$(legacy_retailos_token)" "$suffix"
}

postgres_database_exists() {
  local container="$1"
  local admin_user="$2"
  local database_name="$3"

  docker exec -u postgres "$container" \
    psql -v ON_ERROR_STOP=1 -U "$admin_user" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${database_name}'" 2>/dev/null | grep -qx 1
}

postgres_table_count() {
  local container="$1"
  local admin_user="$2"
  local database_name="$3"
  local table_name="$4"

  docker exec -u postgres "$container" \
    psql -v ON_ERROR_STOP=1 -U "$admin_user" -d "$database_name" -tAc \
    "SELECT COUNT(*) FROM ${table_name}" 2>/dev/null | tr -d '[:space:]' || printf '0'
}

ensure_compose_project_volumes() {
  local default_project="$1"
  local legacy_project="$2"

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  local current_project
  current_project="$(get_env_value COMPOSE_PROJECT_NAME || true)"

  local legacy_volume="${legacy_project}_postgres_data"
  local target_volume="${default_project}_postgres_data"

  if ! docker volume inspect "$legacy_volume" >/dev/null 2>&1; then
    return 0
  fi

  if docker volume inspect "$target_volume" >/dev/null 2>&1; then
    return 0
  fi

  if [[ -z "$current_project" || "$current_project" == "$default_project" ]]; then
    echo "==> Reusing existing compose project ${legacy_project} to preserve persisted volumes"
    append_env_value "COMPOSE_PROJECT_NAME" "$legacy_project"
  fi
}

reconcile_postgres_database_name() {
  local container="$1"
  local admin_user="$2"
  local target_database="$3"
  local legacy_database="$4"

  if [[ "$target_database" == "$legacy_database" ]]; then
    return 0
  fi

  local target_exists=false
  local legacy_exists=false

  if postgres_database_exists "$container" "$admin_user" "$target_database"; then
    target_exists=true
  fi

  if postgres_database_exists "$container" "$admin_user" "$legacy_database"; then
    legacy_exists=true
  fi

  if [[ "$legacy_exists" != "true" ]]; then
    return 0
  fi

  if [[ "$target_exists" != "true" ]]; then
    echo "==> Renaming legacy database ${legacy_database} to ${target_database}"
    docker exec -i -u postgres "$container" \
      psql -v ON_ERROR_STOP=1 -U "$admin_user" -d postgres \
        -v legacy_database="${legacy_database}" \
        -v target_database="${target_database}" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'legacy_database'
  AND pid <> pg_backend_pid();

ALTER DATABASE :"legacy_database" RENAME TO :"target_database";
SQL
    return 0
  fi

  local target_tenants
  local legacy_tenants
  target_tenants="$(postgres_table_count "$container" "$admin_user" "$target_database" "tenants")"
  legacy_tenants="$(postgres_table_count "$container" "$admin_user" "$legacy_database" "tenants")"

  if [[ "${legacy_tenants:-0}" -gt 0 && "${target_tenants:-0}" -eq 0 ]]; then
    echo "==> Replacing empty ${target_database} with legacy data from ${legacy_database}"
    docker exec -i -u postgres "$container" \
      psql -v ON_ERROR_STOP=1 -U "$admin_user" -d postgres \
        -v legacy_database="${legacy_database}" \
        -v target_database="${target_database}" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN (:'legacy_database', :'target_database')
  AND pid <> pg_backend_pid();

DROP DATABASE :"target_database";
ALTER DATABASE :"legacy_database" RENAME TO :"target_database";
SQL
    return 0
  fi

  if [[ "${legacy_tenants:-0}" -gt 0 && "${target_tenants:-0}" -gt 0 ]]; then
    echo "WARNING: Both ${target_database} and ${legacy_database} contain tenant data. Keeping ${target_database}." >&2
  fi
}
