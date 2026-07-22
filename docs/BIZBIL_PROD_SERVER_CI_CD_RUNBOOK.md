# BizBil Production Server CI/CD Runbook

This runbook describes the production deployment and CI/CD path for BizBil. It is written to be reusable across future projects: keep the structure, then swap branch names, domains, paths, and secrets for the new application.

## Purpose

The production server is the live customer environment.

- It receives code from `main`.
- It serves real customer traffic.
- It must only receive releases that have already been validated in the test environment.
- It includes observability services so operators can inspect the system quickly during incidents.

## Current BizBil Values

| Item | Value | Notes |
| --- | --- | --- |
| Branch that deploys | `main` | Pushes to `main` trigger the production deploy workflow |
| GitHub Actions workflow | `.github/workflows/deploy.yml` | Production release path |
| Manual deploy script | `infra/deploy-production.sh` | Runs on the production server via SSH |
| Compose file | `infra/docker-compose.prod.yml` | Full production stack |
| Server checkout path | `/opt/retailos` | Production repository clone on the VPS |
| Public URL | `https://ros.sivsanoils.in` | Main customer-facing app URL |
| Health URL | `https://ros.sivsanoils.in/api/health` | Used by the workflow and operators |
| App domain | `app.example.com` style placeholder in docs | Replace with your real domain when adapting |
| Marketing site path | `/opt/bizbil/www` | Static landing site copied during deploy |

## What Runs In The Production Stack

The production stack is the live application plus the monitoring layer.

- `web` - Next.js frontend
- `api` - Fastify API
- `postgres` - primary database
- `redis` - cache and queue backend
- `minio` - object storage
- `caddy` - public reverse proxy and TLS termination
- `prometheus` - metrics scraping and storage
- `loki` - logs storage
- `promtail` - log shipping
- `grafana` - metrics and logs dashboards
- `whatsapp_session` volume - persistent WhatsApp session storage

Grafana is bound to `127.0.0.1:3002` in the Compose file so it is not directly public.

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
9. Validate both production and testing Compose files.
10. Enforce BizBil branding and logo asset presence.

This CI stage is shared with the test environment. Production does not get deployed until this gate passes.

## Deployment Flow

The production deploy workflow is triggered when code is pushed to `main`, or manually through `workflow_dispatch`.

### Workflow jobs

1. `verify`
2. `deploy`

### Verification job

The verification job repeats the same safety gates used by CI, but with production-oriented build settings.

- It runs the monorepo build and Prisma steps.
- It validates `infra/docker-compose.prod.yml`.
- It ensures the production Compose definition still works with the production environment file.

### Deploy job

After verification passes:

1. GitHub Actions prepares an SSH key.
2. The workflow connects to the production VPS.
3. The server checks out the production repository path.
4. The server runs `infra/deploy-production.sh`.
5. The workflow runs a health check against the live app.

## Server Prerequisites

Before the production server can deploy, it must already have:

- Docker Engine
- Docker Compose plugin
- Git
- SSH access for the deploy key
- A clone of the repository at `/opt/retailos`
- `.env.production` present in the repository root
- Caddy able to bind ports `80` and `443`
- A path available for the marketing site assets at `/opt/bizbil/www`

## Required Secrets

### GitHub Secrets

| Secret | Purpose | Notes |
| --- | --- | --- |
| `DEPLOY_HOST` | SSH target host | Production VPS hostname or IP |
| `DEPLOY_USER` | SSH username | Usually `root` |
| `DEPLOY_SSH_KEY` | Private key used for deploy SSH | Paste the full OpenSSH private key |
| `DEPLOY_PATH` | Repository path on the server | Default is `/opt/retailos` |
| `DEPLOY_HEALTH_URL` | Health endpoint checked by the workflow | Default is `https://ros.sivsanoils.in/api/health` |

### Server Environment Variables

The production server uses `.env.production`.

| Variable group | Examples | Notes |
| --- | --- | --- |
| Domain and TLS | `APP_DOMAIN`, `TEST_APP_DOMAIN`, `ACME_EMAIL` | Used by Caddy for the public site and certificate issuance |
| Database | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | Primary production data store |
| Cache | `REDIS_PASSWORD`, `REDIS_URL` | Used by queues, cache, and background processing |
| Object storage | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` | Production object store |
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | Must never be shared with test or CI environments |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Live payment gateway credentials |
| Messaging | `WHATSAPP_*`, `FAST2SMS_API_KEY` | Live customer communication credentials |
| Frontend | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME=BizBil`, `NEXT_PUBLIC_APP_ENV=production` | Used at build time and runtime |
| Monitoring | `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | Grafana login credentials |

## Production Server Bootstrap

If the production server is being set up for the first time:

```bash
cd /opt/retailos
cp .env.production.example .env.production
nano /opt/retailos/.env.production
```

Important setup rules:

- Keep production secrets separate from test secrets.
- Set `NEXT_PUBLIC_APP_ENV=production` so the production build is labeled correctly.
- Confirm that Caddy owns ports `80` and `443`.
- Confirm that the marketing site path exists and is writable during deploy.
- If you later add backup automation, make sure backups happen before schema migrations.

## Deploy Script Behavior

`infra/deploy-production.sh` performs the actual server-side deployment.

```bash
cd /opt/retailos
DEPLOY_REF=origin/main bash infra/deploy-production.sh
```

The script does the following:

1. Verifies that `.env.production` exists.
2. Fetches the latest `main` branch from origin.
3. Checks out `main` in the server clone.
4. Hard-resets the checkout to `DEPLOY_REF`.
5. Builds the `api` and `web` images.
6. Starts `postgres`, `redis`, and `minio`.
7. Runs `prisma migrate deploy`.
8. Publishes the marketing site from `apps/web/public/bizbil-landing` into `/opt/bizbil/www`.
9. Restarts `api`, `web`, `caddy`, `prometheus`, `loki`, `promtail`, and `grafana`.
10. Prints service status for the active production stack.

## Post-Deploy Validation

The GitHub Actions workflow performs a production health check after deployment.

- `GET /api/health` must return `200`.

Operators should also run the following smoke checks before closing the release:

- Open the public homepage.
- Open the login page.
- Confirm the app title shows BizBil branding.
- Sign in with a non-admin account.
- Check one core business flow, such as billing or inventory.
- Confirm that Grafana, Prometheus, and Loki are accessible locally on the server or through the approved admin path.

If a future project needs stricter automation, add route assertions similar to the test server workflow, but keep production release gates conservative.

## Rollback Strategy

Rollback should be commit-based and planned.

1. Identify the last known good commit SHA.
2. Re-run the deploy script with `DEPLOY_REF=<known-good-sha>`.
3. If the deploy contained a schema migration, assess whether a database restore is required before redeploying.
4. Keep the previous release available until the new release has passed the health check and smoke tests.

Example:

```bash
cd /opt/retailos
DEPLOY_REF=<known-good-sha> bash infra/deploy-production.sh
```

## Troubleshooting

### Health check fails

- Confirm that `api` and `web` containers are running.
- Check `docker compose logs api` and `docker compose logs web`.
- Verify that `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` are present in `.env.production`.
- Ensure Caddy is binding ports `80` and `443`.

### Prisma migration fails

- Inspect the migration output from the deploy script.
- Check for incompatible schema changes.
- Confirm the database is reachable and credentials are correct.

### Login or auth failures

- Confirm that cookies are being set by the API.
- Check the production `JWT_SECRET`.
- Verify `NEXT_PUBLIC_APP_URL` and the public domain configuration.

### Monitoring looks empty

- Confirm that Prometheus can reach the API metrics endpoint.
- Check Loki and Promtail container logs.
- Verify the Grafana datasource provisioning files in `infra/grafana/provisioning`.

### Marketing site is missing

- Ensure `apps/web/public/bizbil-landing` exists in the repo checkout.
- Confirm that the deploy script has permission to write to `/opt/bizbil/www`.

## Release Checklist

Use this before each production release.

1. Confirm the change set has already been validated in the test environment.
2. Confirm there is a known-good rollback commit.
3. Confirm any schema migrations have been reviewed.
4. Confirm secrets are populated in `.env.production`.
5. Confirm the deploy key still works.
6. Confirm the release window is acceptable for the business.
7. Deploy.
8. Check `/api/health`.
9. Run the smoke tests.
10. Watch Grafana and logs for a short period after deploy.

## Future Project Adaptation Checklist

To reuse this runbook in another project, update only the project-specific values:

- Branch name
- Deployment workflow file
- Server checkout path
- Public domain
- Health endpoint
- Docker Compose file
- Monitoring stack
- Marketing or static-site publishing path
- Environment-variable names and values
- Smoke-test routes
- Rollback policy

Keep the production server runbook stricter than the test-server runbook. That separation is one of the easiest ways to prevent accidental live releases.
