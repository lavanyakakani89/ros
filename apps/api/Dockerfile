FROM node:20-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    openssl \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/vertical-configs/package.json packages/vertical-configs/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @retailos/shared build \
  && pnpm --filter @retailos/vertical-configs build \
  && pnpm --filter @retailos/api prisma:generate \
  && pnpm --filter @retailos/api build

ENV NODE_ENV=production

EXPOSE 3001

CMD ["pnpm", "--filter", "@retailos/api", "start"]
