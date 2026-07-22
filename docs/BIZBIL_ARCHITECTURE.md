# BizBil Architecture

This document captures the current architecture of the BizBil monorepo as implemented in the repository today.

## Stack At A Glance

| Area | Choice | Notes |
| --- | --- | --- |
| Frontend framework | Next.js 14 + React 18 | App Router, PWA support, React Query, Zustand, Dexie, Recharts |
| Backend framework | Fastify 4 on Node.js 20 | Plugin-driven API, BullMQ workers, multipart uploads, JWT auth |
| Programming languages | TypeScript, SQL, Bash, YAML, JSON, CSS, PowerShell, VBScript | TypeScript is the main application language |
| Database technology | PostgreSQL 16 | Tenant-aware schema with row-level security checks |
| ORM | Prisma 5 | Prisma Client generated from `apps/api/prisma/schema.prisma` |
| Migration system | Prisma Migrate | `migrate dev` locally, `migrate deploy` in CI and deploy scripts |
| Authentication approach | Cookie-based JWT for tenant users; separate cookie-session auth for super admins | Access/refresh token rotation with httpOnly cookies |
| Authorization model | RBAC plus tenant scoping and impersonation rules | Role-to-permission mapping is enforced in a Fastify plugin |
| API conventions | `/api`-prefixed REST-ish routes | Zod validation, JSON error payloads, pagination, health and metrics endpoints |
| Validation libraries | Zod | Used for request bodies, params, query strings, and shared types |
| Error-handling patterns | Domain errors plus a centralized Fastify error handler | Zod errors become 400s, Prisma unique violations become 409s |
| Logging and monitoring conventions | Fastify logger, prom-client, Prometheus, Loki, Grafana | Health endpoints also verify database and Redis connectivity |
| Testing frameworks | TypeScript compile checks | No separate Jest/Vitest runtime suite is checked in today |
| UI component library | Custom component layer | Shared shell and domain components built with Lucide icons and Recharts |
| Styling system | Tailwind CSS | `clsx` + `tailwind-merge`, custom theme tokens, global CSS, Inter font |
| Folder structure | Monorepo with `apps`, `packages`, `infra`, `ops`, `docs`, and `www` | See the tree below |
| Environment-variable conventions | Uppercase snake case with `NEXT_PUBLIC_` for browser-safe values | Example env files exist for local, testing, and production |
| Docker setup | Multi-service Docker Compose plus app-specific Dockerfiles | Web and API images are built from Node 20 slim images |
| CI/CD workflows | GitHub Actions plus a Jenkins pipeline | PR validation, branch deploys, compose validation, and brand guards |
| Cloud deployment structure | Separate production and testing VPS stacks behind Caddy | App services, data services, and observability services run in Compose |

## Frontend Framework

BizBil uses Next.js 14 with the App Router and React 18.

- Route groups live under `apps/web/app/(auth)`, `apps/web/app/(dashboard)`, and `apps/web/app/(superadmin)`.
- Shared app bootstrap lives in `apps/web/app/layout.tsx` and `apps/web/app/providers.tsx`.
- Server state is handled with TanStack React Query.
- Local UI state is handled with Zustand where needed.
- Offline queueing uses Dexie and the PWA layer from `next-pwa`.
- Charts use Recharts.
- The frontend leans on custom components in `apps/web/components` instead of a third-party design system.

## Backend Framework

BizBil uses Fastify 4 on Node.js 20 for the API.

- The server is assembled in `apps/api/src/app.ts` and started from `apps/api/src/server.ts`.
- Infrastructure concerns are implemented as Fastify plugins in `apps/api/src/plugins`.
- Domain features live in `apps/api/src/modules/<domain>`.
- Background processing uses BullMQ workers in `apps/api/src/jobs`.
- Multipart uploads are handled by `@fastify/multipart`.
- The API keeps the raw JSON body for webhook verification when needed.

## Programming Languages

The repository is primarily TypeScript-first, with a few supporting languages for infra and platform glue.

- TypeScript and TSX are used for the web app, API, shared packages, and print agent.
- SQL is used through Prisma migrations and generated database scripts.
- Bash is used for deployment and CI helper scripts.
- YAML is used for Docker Compose, GitHub Actions, and observability config.
- JSON is used for manifests, dashboards, and other config files.
- CSS is used in the global stylesheet.
- PowerShell and VBScript appear in the Windows print-agent tooling.

## Database Technology

BizBil uses PostgreSQL 16.

- The Prisma schema lives at `apps/api/prisma/schema.prisma`.
- Tenant isolation is part of the data model and is reinforced with row-level security checks.
- The API sets tenant context on the database session during request handling.
- CI verifies tenant isolation with a dedicated RLS verification step.

## ORM

Prisma is the ORM.

- Prisma Client is generated from the API schema.
- The API uses Prisma for all persistent reads and writes.
- Repository classes wrap Prisma access for domain-specific workflows where that improves clarity.

## Migration System

Prisma Migrate is the schema migration system.

- Local development uses `prisma migrate dev`.
- CI and deploy scripts use `prisma migrate deploy`.
- Migration files live under `apps/api/prisma/migrations`.
- The workflow always generates Prisma Client before migration or build steps.

## Authentication Approach

BizBil uses two distinct auth flows.

- Tenant users authenticate with JWT access tokens and refresh tokens stored in httpOnly cookies.
- Access tokens are short-lived and signed with the server JWT secret.
- Refresh tokens are rotated and stored hashed in the database.
- Super admins have a separate cookie-backed session flow under `/api/superadmin`.
- Support impersonation is layered on top of super admin auth and can run in read-only or write mode.

## Authorization Model

Authorization is role-based, tenant-aware, and route-driven.

- Roles are defined in Prisma as `OWNER`, `MANAGER`, `STAFF`, and `DELIVERY`.
- Permissions are mapped from HTTP method and route path in `apps/api/src/plugins/rbac.ts`.
- Permission sets for each role are defined centrally in `apps/api/src/plugins/permissions.ts`.
- Tenant context is attached to each authenticated request by the tenant plugin.
- Support impersonation can bypass normal RBAC flow, but write actions are still restricted by impersonation mode and route guards.

## API Conventions

The API follows a consistent Fastify-style route convention.

- Public endpoints include `/health`, `/api/health`, `/metrics`, auth routes, and selected webhook routes.
- Most routes are mounted under `/api/<domain>`.
- Request payloads are parsed with Zod inside the route handler.
- List endpoints commonly return `{ data, page, limit, total }`.
- Errors are returned as JSON objects with an `error` field, and validation errors include an `issues` array.
- Route-specific handlers convert domain exceptions into HTTP responses where that improves readability.
- Webhook routes preserve `request.rawBody` for signature verification.
- File uploads use multipart with explicit size limits.

## Validation Libraries

Zod is the primary validation library.

- Route schemas use `z.object()`, `z.coerce`, `z.nativeEnum`, and `z.preprocess`.
- Validation is used for request bodies, query parameters, and route params.
- Shared type packages also rely on Zod for shape definition and normalization.

## Error-Handling Patterns

Error handling is intentionally centralized but still allows domain-specific responses.

- `apps/api/src/app.ts` installs a global Fastify error handler.
- Zod validation failures are normalized into 400 responses with field-level issue details.
- Prisma unique-constraint violations are converted into 409 responses.
- Domain services throw purpose-built error classes such as auth, billing, settings, supplier, and payment errors.
- Route handlers catch those domain errors and return compact JSON error bodies.
- Client-side API helpers read the structured error body and surface the first useful message.

## Logging And Monitoring Conventions

BizBil uses application logs plus metrics and container-level observability.

- Fastify logging is enabled with a log level controlled by `LOG_LEVEL`.
- Prisma logs queries, warnings, and errors in development, and only errors in production.
- `prom-client` exposes process and request metrics at `/metrics`.
- Health checks hit both PostgreSQL and Redis.
- Production Compose includes Prometheus, Loki, Promtail, and Grafana.
- Grafana dashboards and datasource provisioning live under `infra/grafana`.

## Testing Frameworks

There is no separate Jest, Vitest, or Playwright suite checked in today.

- Package `test` scripts are TypeScript compile checks.
- `pnpm check` runs lint, typecheck, and test across the workspace.
- CI adds Prisma migration checks, RLS verification, and Docker Compose validation on top of the compile checks.

## UI Component Library

BizBil does not use a third-party design system such as Material UI or shadcn.

- Shared layout primitives live in `apps/web/components/shared`.
- Domain screens are built from custom React components under `apps/web/components`.
- Lucide provides iconography.
- Recharts provides chart primitives.
- Next Image and the BizBil logo assets are used for branding.

## Styling System

Styling is built around Tailwind CSS.

- `apps/web/app/globals.css` defines the base Tailwind layers and global page defaults.
- `apps/web/tailwind.config.ts` extends the theme with shared color tokens.
- `clsx` and `tailwind-merge` are used through the `cn()` helper in `apps/web/lib/utils.ts`.
- The app uses the Inter font from `next/font/google`.
- Brand styling centers on BizBil teal and amber accents, with a clean light surface palette.

## Folder Structure

```text
.
|-- apps/
|   |-- web/
|   |   |-- app/                 # Next.js App Router pages, layouts, and route groups
|   |   |-- components/          # Domain UI and shared shell components
|   |   |-- lib/                 # API client, state helpers, offline queue, utilities
|   |   |-- public/              # Logos, manifest, icons, and PWA assets
|   |   `-- Dockerfile
|   |-- api/
|   |   |-- src/
|   |   |   |-- config/          # Env and login identifier helpers
|   |   |   |-- jobs/            # BullMQ workers and queue setup
|   |   |   |-- modules/         # Feature modules: routes, schema, service, repository, types
|   |   |   |-- plugins/         # Prisma, Redis, auth, tenant, RBAC, metrics, MinIO, impersonation
|   |   |   `-- types/           # Fastify augmentation and external type shims
|   |   |-- prisma/              # Schema, migrations, and seed scripts
|   |   `-- Dockerfile
|   `-- print-agent/             # Windows-side raw print helper
|-- packages/
|   |-- shared/                  # Shared Zod-backed types and config contracts
|   `-- vertical-configs/        # Vertical-specific navigation and module config
|-- infra/                       # Compose files, Caddy, Prometheus, Loki, Grafana, deploy scripts
|-- ops/                         # Jenkins helper scripts and operational docs
|-- docs/                        # Architecture and environment documentation
|-- www/                         # Marketing site assets copied to the VPS
|-- backups/                     # Database dumps and recovery artifacts
`-- .github/workflows/           # GitHub Actions CI and deploy workflows
```

The recurring pattern in the API is `modules/<domain>/{routes,schema,service,repository,types}`.

## Environment-Variable Conventions

Environment variables follow uppercase snake case.

- Browser-safe variables use the `NEXT_PUBLIC_` prefix.
- Server-only secrets include `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `MINIO_*`, `WHATSAPP_*`, `RAZORPAY_*`, and `GRAFANA_*`.
- `apps/api/src/config/env.ts` validates required API env vars at startup.
- Example env files exist for local, testing, and production usage.
- Docker Compose files use shell-style required-variable checks such as `${VAR:?message}`.
- The testing environment uses `NEXT_PUBLIC_APP_ENV=testing` to surface the environment badge in the UI.

## Docker Setup

Docker is the main runtime packaging and local-infra mechanism.

- `infra/docker-compose.yml` provides local PostgreSQL, Redis, and MinIO.
- `infra/docker-compose.prod.yml` adds the web app, API, Caddy, PostgreSQL, Redis, MinIO, Prometheus, Loki, Promtail, and Grafana.
- `infra/docker-compose.test.yml` provides an isolated testing stack.
- `apps/web/Dockerfile` and `apps/api/Dockerfile` are multi-stage builds on `node:20-bookworm-slim`.
- The API image installs Chromium and related libraries for Puppeteer-based PDF generation.
- The web image passes `NEXT_PUBLIC_*` build arguments at build time.
- Deploy scripts run Prisma migrations before bringing the application services fully online.

## CI/CD Workflows

GitHub Actions is the primary automation path, with Jenkins support also present.

- `ci.yml` runs on pull requests and pushes to `main` and `develop`.
- CI installs dependencies, generates Prisma Client, deploys migrations against a CI database, verifies RLS, runs `pnpm check`, builds the workspace, validates Compose files, and enforces BizBil branding and logo asset checks.
- `deploy.yml` runs on pushes to `main` and manual dispatch, then verifies the build and deploys the production stack over SSH.
- `deploy-testing.yml` runs on pushes to `develop` and manual dispatch, then deploys the testing stack over SSH and performs route assertions.
- `Jenkinsfile` mirrors the same general flow for Jenkins-based automation: install, Prisma generation, Compose validation, lint/test/build, Docker build, and deploy.

## Cloud Deployment Structure

BizBil deploys to VPS-hosted Docker Compose stacks rather than a managed PaaS.

- Production and testing are isolated into separate stacks and separate repository checkouts on the server.
- Caddy is the public reverse proxy and TLS terminator.
- The web app and API run as separate containers.
- PostgreSQL, Redis, and MinIO provide application state and object storage.
- The production stack also runs Prometheus, Loki, Promtail, and Grafana for observability.
- The deploy script runs Prisma migrations, restarts services, and health-checks the application before declaring success.
- The marketing site assets from `apps/web/public/bizbil-landing` are copied to the production host during deployment.

## Short Summary

BizBil is a pnpm monorepo with a Next.js frontend, Fastify API, Prisma/PostgreSQL data layer, Redis-backed background jobs, and Docker Compose-based production and testing VPS stacks. The codebase favors clear module boundaries, shared Zod validation, cookie-based auth, RBAC, and a lightweight but intentional custom UI layer.
