# BizBil Jenkins CI/CD

This repo uses Jenkins as the VPS-friendly CI/CD path. The pipeline validates the monorepo, builds production Docker images, and deploys `main` to the production server with Docker Compose.

## Jenkins Requirements

- Jenkins LTS on Linux
- Git, Docker Engine, Docker Compose v2
- Node.js 20 available, or Docker-capable agent with Corepack
- Jenkins plugins:
  - Git
  - Pipeline
  - Credentials Binding
  - SSH Agent or SSH Credentials

## Jenkins Credentials

Create these credentials in Jenkins:

- `bizbil-prod-ssh`
  - Type: SSH Username with private key
  - Username: production SSH user, for example `root`
  - Private key: deploy key that can SSH into the VPS
- `bizbil-prod-host`
  - Type: Secret text
  - Value: production server IP or hostname

The Jenkinsfile defaults are:

- `DEPLOY_BRANCH=main`
- `DEPLOY_PATH=/opt/bizbil`
- `HEALTH_URL=https://ros.sivsanoils.in/api/health`

Change those values in `Jenkinsfile` if the production target changes.

## Server Requirements

The production server must already have:

- Docker Engine and Docker Compose v2
- Git access to `https://github.com/lavanyakakani89/ros.git`
- Repo checked out at `/opt/bizbil`
- `/opt/bizbil/.env.production` present with production secrets
- DNS and Caddy configured for `ros.sivsanoils.in`

The deploy script deliberately uses `git pull --ff-only`. If the server has manual edits, deployment fails instead of overwriting them.

## Automatic Deployment

Use a Jenkins Multibranch Pipeline or a normal Pipeline job pointed at this repository.

Recommended trigger:

- Configure a GitHub webhook to Jenkins:
  - Payload URL: `https://<jenkins-domain>/github-webhook/`
  - Content type: `application/json`
  - Events: push

The Jenkinsfile also polls SCM every 2 minutes as a fallback.

## Pipeline Flow

1. Checkout repository
2. Install dependencies with pnpm
3. Generate Prisma client
4. Validate production Docker Compose
5. Run lint and tests
6. Build the full workspace
7. Build production API and web Docker images
8. On `main`, SSH to the VPS and deploy:
   - fetch and fast-forward server repo
   - validate compose config
   - build API and web images
   - start data services
   - run Prisma migrations
   - start full stack
   - verify `/api/health`

## Manual Test Command

From Jenkins agent, after credentials are configured:

```bash
DEPLOY_HOST=<server-ip> \
SSH_USER=root \
SSH_KEY=/path/to/private/key \
DEPLOY_PATH=/opt/bizbil \
HEALTH_URL=https://ros.sivsanoils.in/api/health \
ops/jenkins/deploy-over-ssh.sh
```

## Rollback Note

The pipeline does not automatically roll back database migrations. If a deployment fails after migrations, inspect logs first and use a deliberate manual rollback only when the schema remains compatible with the previous app version.
