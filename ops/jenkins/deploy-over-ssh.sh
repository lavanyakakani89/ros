#!/usr/bin/env bash
set -Eeuo pipefail

required_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
}

required_env DEPLOY_HOST
required_env SSH_USER
required_env SSH_KEY

DEPLOY_PATH="${DEPLOY_PATH:-/opt/bizbil}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-https://ros.sivsanoils.in/api/health}"

SSH_OPTS=(
  -i "${SSH_KEY}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=4
)

echo "Deploying ${DEPLOY_BRANCH} to ${SSH_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"

ssh "${SSH_OPTS[@]}" "${SSH_USER}@${DEPLOY_HOST}" \
  "DEPLOY_PATH='${DEPLOY_PATH}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' HEALTH_URL='${HEALTH_URL}' bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

compose() {
  docker compose --env-file .env.production -f infra/docker-compose.prod.yml "$@"
}

retry_health() {
  local tries=24
  local delay=5
  local i

  for i in $(seq 1 "${tries}"); do
    if curl -fsS "${HEALTH_URL}" >/dev/null; then
      echo "Health check passed: ${HEALTH_URL}"
      return 0
    fi

    echo "Health check attempt ${i}/${tries} failed; retrying in ${delay}s"
    sleep "${delay}"
  done

  echo "Health check failed after $((tries * delay)) seconds" >&2
  compose logs --tail=160 api >&2 || true
  compose logs --tail=120 web >&2 || true
  return 1
}

cd "${DEPLOY_PATH}"
test -f .env.production
test -f infra/docker-compose.prod.yml

before_commit="$(git rev-parse --short HEAD)"
echo "Current server commit: ${before_commit}"

git fetch origin "${DEPLOY_BRANCH}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

after_commit="$(git rev-parse --short HEAD)"
echo "Deploying server commit: ${after_commit}"

compose config >/tmp/bizbil-compose-validated.yml
compose build api web
compose up -d postgres redis minio
compose run --rm api pnpm --filter @bizbil/api exec -- prisma migrate deploy --schema prisma/schema.prisma
compose up -d
compose ps
retry_health

echo "Deployment complete: ${before_commit} -> ${after_commit}"
REMOTE_SCRIPT
