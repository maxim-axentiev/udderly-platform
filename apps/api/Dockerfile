# syntax=docker/dockerfile:1

# Build context must be the repository root (npm workspaces + lockfile).
# docker compose -f docker-compose.production.yml build

FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --ignore-scripts --include=dev

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @udderly/shared \
  && npm run build -w @udderly/api

FROM node:22-bookworm-slim AS production
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Workspaces glob includes apps/web; copy its package.json so npm ci matches
# the lockfile. The web app is not built or started in this image.
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/drizzle.config.ts apps/api/drizzle.config.ts
COPY --from=build /app/apps/api/src apps/api/src

RUN chown -R node:node /app

USER node

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start", "-w", "@udderly/api"]
