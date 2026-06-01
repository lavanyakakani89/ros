#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_BRANCH="${DEPLOY_BRANCH:-develop}"
DEPLOY_SHA="${DEPLOY_SHA:-origin/${DEPLOY_BRANCH}}"
RESET_DATABASE="${RESET_DATABASE:-false}"
GH_PAT="${GH_PAT:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.test.yml}"
ENV_FILE="${ENV_FILE:-.env.testing}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Create it from .env.testing.example and use testing-only secrets." >&2
  exit 1
fi

echo "==> Ensuring remote origin points to GitHub"
CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null || echo "none")
echo "Current origin: $CURRENT_ORIGIN"

if [[ "$CURRENT_ORIGIN" != *"github.com"* ]] || [[ "$CURRENT_ORIGIN" == "none" ]]; then
  if [[ -z "$GH_PAT" || -z "$GITHUB_REPOSITORY" ]]; then
    echo "Cannot fix origin. Set GH_PAT and GITHUB_REPOSITORY in environment." >&2
    exit 1
  fi

  echo "Fixing origin from '$CURRENT_ORIGIN' to GitHub..."
  git remote set-url origin "https://$GH_PAT@github.com/$GITHUB_REPOSITORY.git"
  echo "Origin is now: $(git remote get-url origin)"
else
  if [[ -n "$GH_PAT" && -n "$GITHUB_REPOSITORY" ]]; then
    git remote set-url origin "https://$GH_PAT@github.com/$GITHUB_REPOSITORY.git"
  fi
  echo "Origin already points to GitHub."
fi

TARGET_SHA="$DEPLOY_SHA"
if [[ "$TARGET_SHA" == origin/* ]]; then
  echo "Deploying branch ref: $TARGET_SHA"
elif [[ -z "$TARGET_SHA" ]]; then
  TARGET_SHA="origin/$DEPLOY_BRANCH"
  echo "Deploying branch ref (fallback): $TARGET_SHA"
fi

echo "==> Fetching latest origin/${DEPLOY_BRANCH}"
git fetch origin
git checkout -B "$DEPLOY_BRANCH" "$TARGET_SHA"
echo "Deploying commit: $TARGET_SHA"
git reset --hard "$TARGET_SHA"

echo "==> Building testing application images"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web

echo "==> Starting testing dependencies"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis minio

echo "==> Running testing database migrations"
if [[ "$RESET_DATABASE" == "true" ]]; then
  echo "⚠️  Database reset requested — this will destroy all data"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
    pnpm --filter @retailos/api exec -- prisma migrate reset --force --skip-seed --schema prisma/schema.prisma || {
      echo "❌ prisma migrate reset failed." >&2
      exit 1
    }
else
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
    pnpm --filter @retailos/api exec -- prisma migrate deploy --schema prisma/schema.prisma || {
      echo "❌ prisma migrate deploy failed." >&2
      exit 1
    }
fi

echo "==> Restarting testing application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web caddy

echo "==> Testing service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps api web caddy postgres redis minio
