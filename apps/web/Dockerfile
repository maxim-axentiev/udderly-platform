# syntax=docker/dockerfile:1

# Build context is the repository root (npm workspaces + lockfile).
# docker compose -f docker-compose.production.yml build web

FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    VITE_API_URL=

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --ignore-scripts --include=dev

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN npm run build -w @udderly/shared \
  && npm run build -w @udderly/web

FROM node:22-bookworm-slim AS production
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/web/server.mjs apps/web/server.mjs

RUN chown -R node:node /app

USER node
WORKDIR /app/apps/web

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.mjs"]
