# BizBil Test Server CI/CD Runbook

This runbook describes the test-server deployment and CI/CD path for BizBil. It is written to be reusable: if you copy it into a future project, keep the structure and replace the branch names, domains, paths, and secrets.

## Purpose

The test server is the safe integration environment.

- It receives code from the `develop` branch.
- It mirrors production as closely as possible without sharing live customer data.
- It is used to validate database migrations, deployment scripts, API behavior, and critical UI routes before merging into `main`.
- It is the place to verify billing, printing, inventory, delivery, imports, and reporting flows end to end.

## Current BizBil Values

| Item | Value | Notes |
| --- | --- | --- |
| Branch that deploys | `develop` | Pushes to `develop` trigger the testing deploy workflow |
| GitHub Actions workflow | `.github/workflows/deploy-testing.yml` | Deploys after the verification job succeeds |
| Manual deploy script | `infra/deploy-testing.sh` | Runs on the test server via SSH |
| Compose file | `infra/docker-compose.test.yml` | Isolated test stack |
| Server checkout path | `/opt/retailos-testing` | Separate from production |
| Public URL | `https://test-ros.sivsanoils.in` | The test Caddy layer forwards traffic here |
| Health URL | `https://test-ros.sivsanoils.in/api/health` | Used by the workflow and operators |
| Host port | `3100` | Exposed by the test Caddy container |
| Env file on server | `.env.testing` | Must contain testing-only secrets |

## What Runs In The Test Stack

The test stack contains the application plus isolated infrastructure services.

- `web` - Next.js frontend
- `api` - Fastify API
- `postgres` - dedicated test database
- `redis` - dedicated cache and queue backend
- `minio` - dedicated object storage
- `caddy` - test HTTP entrypoint on port `3100`
- `whatsapp_session` volume - isolated WhatsApp session state

## CI Path Before Deployment

Every pull request and push to `main` or `develop` first goes through the GitHub Actions CI workflow.

The CI job performs the following checks:

1. Check out the repository.
2. Install Node.js 20 and pnpm 9.15.4 through Corepack.
3. Install workspace dependencies with a frozen lockfile.
4. Generate the Prisma client.
5. Apply Prisma migrations against the CI Postgres service.
6. Verify row-level security and tenant isolation.
7. Run lint, typecheck, and compile-based tests across the workspace.
8. Build the workspace packages and apps.
9. Validate the production and testing Compose files.
10. Enforce BizBil branding and logo asset presence.

This means the test server is not the first place code correctness is checked. It is the second gate, after CI.

## Deployment Flow

The deploy workflow is triggered when code is pushed to `develop`, or manually through `workflow_dispatch`.

### Workflow jobs

1. `verify`
2. `deploy`

### Verification job

The verification job repeats the same safety gates used by CI, but with test-server-specific environment values.

- It runs the monorepo build and Prisma steps.
- It validates `infra/docker-compose.test.yml`.
- It ensures the testing Compose definition still works with the test environment file.

### Deploy job

After verification passes:

1. GitHub Actions prepares an SSH key.
2. The workflow connects to the test VPS.
3. The server checks out the testing repository path.
4. The server runs `infra/deploy-testing.sh`.
5. The workflow runs health and route assertions after deployment.

## Server Prerequisites

Before the test server can deploy, it must already have:

- Docker Engine
- Docker Compose plugin
- Git
- SSH access for the deploy key
- A clone of the repository at `/opt/retailos-testing`
- `.env.testing` present in the repository root
- The server side port `3100` available for the test Caddy container

## Required Secrets

### GitHub Secrets

| Secret | Purpose | Notes |
| --- | --- | --- |
| `DEPLOY_HOST` | SSH target host | Test VPS hostname or IP |
| `DEPLOY_USER` | SSH username | Usually `root` |
| `DEPLOY_SSH_KEY` | Private key used for deploy SSH | Paste the full OpenSSH private key |
| `DEPLOY_PATH` | Path to the production repo clone on the server | Reused as the source clone for the test server bootstrap |
| `DEPLOY_TEST_PATH` | Path to the test repo clone | Default is `/opt/retailos-testing` |
| `DEPLOY_TEST_HEALTH_URL` | Test health endpoint | Default is `https://test-ros.sivsanoils.in/api/health` |
| `DEPLOY_TEST_HOST` | Optional failure-log SSH host | Used only when a deploy fails and logs need to be dumped |
| `DEPLOY_TEST_USER` | Optional failure-log SSH user | Falls back to `DEPLOY_USER` |

### Server Environment Variables

The test server uses `.env.testing`.

| Variable group | Examples | Notes |
| --- | --- | --- |
| Database | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | Must point at the test Postgres container |
| Cache | `REDIS_PASSWORD`, `REDIS_URL` | Must point at the test Redis container |
| Object storage | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` | Dedicated test MinIO volume |
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | Never reuse production secrets |
| Frontend | `NEXT_PUBLIC_API_URL=/api`, `NEXT_PUBLIC_APP_URL=https://test-ros.sivsanoils.in`, `NEXT_PUBLIC_APP_NAME=BizBil`, `NEXT_PUBLIC_APP_ENV=testing` | These values power the browser build |
| Integrations | `RAZORPAY_*`, `WHATSAPP_*`, `FAST2SMS_API_KEY` | Use test-only credentials or blank values when allowed |
| Test port | `TEST_HTTP_PORT=3100` | Exposes Caddy on host port 3100 |

## Server Bootstrap

If the test server is being set up for the first time:

```bash
git clone /opt/retailos /opt/retailos-testing
cd /opt/retailos-testing
git fetch origin main develop || true
git checkout -B develop origin/develop || git checkout -B develop origin/main
cp .env.testing.example .env.testing
nano /opt/retailos-testing/.env.testing
```

Important setup rules:

- Use testing-only credentials.
- Do not copy live production database passwords, JWT secrets, payment gateway keys, or messaging tokens.
- Keep the test database, Redis, and MinIO isolated from production.
- Ensure the test UI uses `NEXT_PUBLIC_APP_ENV=testing` so the environment badge appears in the app shell.

## Deploy Script Behavior

`infra/deploy-testing.sh` performs the actual server-side deployment.

```bash
cd /opt/retailos-testing
DEPLOY_BRANCH=develop DEPLOY_REF=origin/develop bash infra/deploy-testing.sh
```

The script does the following:

1. Verifies that `.env.testing` exists.
2. Fetches the latest `develop` branch from origin.
3. Checks out the `develop` branch in the server clone.
4. Hard-resets the checkout to `DEPLOY_REF`.
5. Builds the `api` and `web` images.
6. Starts `postgres`, `redis`, and `minio`.
7. Runs `prisma migrate deploy`.
8. Restarts `api`, `web`, and `caddy`.
9. Prints service status for the active test stack.

## Post-Deploy Validation

The GitHub Actions workflow performs several smoke checks after deployment.

- `GET /api/health` must return `200`.
- `GET /api/version` must report the same commit SHA that was deployed.
- `GET /login` must return `200`.
- `GET /dashboard` must return `200`.
- `GET /payroll` must return `200`.
- `GET /settings/payment-methods` must return `200`.
- The HTML title must contain `BizBil`.

Operators should also perform a quick human smoke test:

- Log in.
- Open the dashboard.
- Create or edit one record in a core module.
- Confirm that the test badge and tenant name look correct.
- Check that the expected routes still render after the deploy.

## Rollback Strategy

Rollback should be commit-based, not hand-edited.

1. Identify the last known good commit SHA.
2. Re-run the deploy script with `DEPLOY_REF=<known-good-sha>`.
3. Let the script rebuild images and re-run migrations only if that commit requires them.
4. If a bad migration has already changed the schema or data, restore the database from a backup before redeploying.

Example:

```bash
cd /opt/retailos-testing
DEPLOY_BRANCH=develop DEPLOY_REF=<known-good-sha> bash infra/deploy-testing.sh
```

## Troubleshooting

### Health check fails

- Confirm that `api` and `web` containers are running.
- Check `docker compose logs api` and `docker compose logs web`.
- Verify that `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` are present in `.env.testing`.
- Ensure the test Caddy container is listening on host port `3100`.

### Prisma migration fails

- Run `prisma generate` again and confirm the schema is valid.
- Check whether the database is reachable from the container network.
- Inspect recent migration files for incompatible schema changes.

### Login or auth failures

- Confirm that cookies are being set by the API.
- Check `JWT_SECRET`.
- Verify that the browser is using the expected `NEXT_PUBLIC_APP_URL`.

### Route assertions fail in GitHub Actions

- Ensure the test server is actually serving the latest commit.
- Check whether the deploy checkout path is correct.
- Confirm that the Caddy reverse proxy and the server port `3100` are aligned.

### Branding check fails

- Replace any old product name in user-facing UI with `BizBil`.
- Ensure logo assets exist under the expected public path.

## Future Project Adaptation Checklist

To reuse this runbook in another project, update only the project-specific values:

- Branch name
- Deployment workflow file
- Server checkout path
- Public domain
- Health endpoint
- Docker Compose file
- Server port
- Environment-variable names and values
- Smoke-test routes
- Brand guard rules

Keep the structure the same so teams always know where to look for CI, deployment, rollback, and troubleshooting steps.
