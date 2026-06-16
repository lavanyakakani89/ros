# BizBil Environments

BizBil uses two long-running environments.

## Production

- Branch: `main`
- URL: `https://ros.sivsanoils.in`
- VPS path: `/opt/bizbil`
- Compose file: `infra/docker-compose.prod.yml`
- Env file on server: `.env.production`
- GitHub environment: `production`
- Deploy workflow: `.github/workflows/deploy.yml`

Production is the live customer/shop environment. Do not test unfinished changes here.

## Testing

- Branch: `develop`
- URL: `https://test-ros.sivsanoils.in`
- VPS path: `/opt/bizbil-testing`
- Compose file: `infra/docker-compose.test.yml`
- Env file on server: `.env.testing`
- GitHub environment: `testing`
- Deploy workflow: `.github/workflows/deploy-testing.yml`

Testing has its own Postgres, Redis, MinIO, WhatsApp session volume, and Caddy container. It does not share production data.

Production Caddy terminates HTTPS for `test-ros.sivsanoils.in` and forwards that hostname to the isolated testing Caddy stack on a local loopback port, defaulting to `3100` and auto-falling back if that port is busy.

The testing UI shows a `TESTING` badge in the top bar because `NEXT_PUBLIC_APP_ENV=testing`.

## Promotion Flow

1. Create feature branches from `develop`.
2. Merge tested feature work into `develop`.
3. GitHub deploys `develop` to the testing stack.
4. Test billing, print, inventory, delivery, imports, and reports in testing.
5. Merge `develop` into `main` only after testing passes.
6. GitHub deploys `main` to production.

## First-Time Testing Setup On VPS

From the server:

```bash
git clone /opt/bizbil /opt/bizbil-testing
cd /opt/bizbil-testing
git fetch origin main develop || true
git checkout -B develop origin/develop || git checkout -B develop origin/main
cp .env.testing.example .env.testing
nano /opt/bizbil-testing/.env.testing
```

Use testing-only secrets. Do not copy production database passwords, JWT secrets, Razorpay live keys, or WhatsApp live tokens unless you deliberately want to test that integration.

Minimum values to set:

```bash
POSTGRES_PASSWORD=<testing-db-password>
DATABASE_URL=postgresql://bizbil:<testing-db-password>@postgres:5432/bizbil_test
REDIS_PASSWORD=<testing-redis-password>
REDIS_URL=redis://:<testing-redis-password>@redis:6379
MINIO_ROOT_PASSWORD=<testing-minio-password>
JWT_SECRET=<long-random-testing-secret>
NEXT_PUBLIC_APP_ENV=testing
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_APP_URL=https://test-ros.sivsanoils.in
TEST_HTTP_PORT=3100
```

Manual deploy:

```bash
cd /opt/bizbil-testing
DEPLOY_BRANCH=develop DEPLOY_REF=origin/develop bash infra/deploy-testing.sh
```

Health check:

```bash
curl -fsS http://<deploy-host>:3100/api/health
curl -fsS https://test-ros.sivsanoils.in/api/health
```

## GitHub Secrets

The testing workflow can reuse these existing repository secrets:

- `DEPLOY_SSH_KEY`
- `DEPLOY_HOST` - set to the current VPS hostname or IP in GitHub Secrets
- `DEPLOY_USER`
- `DEPLOY_PATH`

Optional testing-specific secrets:

- `DEPLOY_TEST_PATH`, default `/opt/bizbil-testing`
- `DEPLOY_TEST_HEALTH_URL`, default `https://test-ros.sivsanoils.in/api/health`
