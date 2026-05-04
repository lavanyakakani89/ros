# RetailOS CI/CD

RetailOS deploys automatically from GitHub Actions when code is pushed to `main`.

## Production Flow

1. `CI` workflow runs lint, typecheck, tests, build, RLS verification, and compose validation.
2. `Deploy Production` workflow runs the same safety checks.
3. If checks pass, GitHub Actions SSHs into the VPS.
4. The VPS runs `infra/deploy-production.sh`.
5. The script pulls `origin/main`, builds `api` and `web`, runs Prisma migrations, restarts services, and prints service status.
6. GitHub Actions verifies `https://ros.sivsanoils.in/api/health`.

## Required GitHub Secrets

Set these in GitHub:

- `DEPLOY_HOST`: VPS IP or hostname, currently `66.42.79.12`
- `DEPLOY_USER`: SSH user, currently `root`
- `DEPLOY_SSH_KEY`: private key that matches the deploy public key on the VPS
- `DEPLOY_PATH`: server repo path, currently `/opt/retailos`
- `DEPLOY_HEALTH_URL`: `https://ros.sivsanoils.in/api/health`

## Server Requirements

The VPS must already have:

- Docker and Docker Compose plugin
- Git
- Repo checked out at `/opt/retailos`
- `.env.production` present in `/opt/retailos`
- Deploy public key in `/root/.ssh/authorized_keys`
- Server checkout able to run `git fetch origin main`

## Manual Fallback

If GitHub Actions is unavailable, run this on the VPS:

```bash
cd /opt/retailos
DEPLOY_REF=origin/main bash infra/deploy-production.sh
```

This uses the same path as CI/CD, so manual deploys do not drift from automation.
