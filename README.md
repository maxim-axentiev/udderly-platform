# Udderly Platform

Private business operations platform for Udderly Ridiculous Farm Life.

This repository currently contains the technical foundation only: a web app, an API, shared TypeScript types, and local PostgreSQL/Redis via Docker. Business features are not included yet.

## Prerequisites

Install these on your computer first:

- [Node.js 22 or newer](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (needed for PostgreSQL and Redis)
- npm (included with Node.js)

Docker Desktop must be running before you start PostgreSQL and Redis.

The web app uses port `3000` and the API uses port `3001`. Those ports need to be free.

## Installation

1. Open a terminal in this repository folder.
2. Install dependencies:

```
npm install
```

3. Create your local environment file by copying `.env.example` to `.env` in this same folder.

Do not commit `.env`. It can contain secrets later.

The example values are safe for local development on your own machine.

## Start PostgreSQL and Redis

From the repository root:

```
docker compose up -d
```

This starts:

- PostgreSQL 16 at `127.0.0.1:5432`
- Redis 7 at `127.0.0.1:6379`

They are bound to your computer only, not the public internet.

## Run database migrations

After Docker is running:

```
npm run db:migrate
```

This creates the initial database structure used to prove that migrations and the API connection work.

## Start the web app and API

From the repository root:

```
npm run dev
```

This starts both applications together.

## URLs

- Web: [http://localhost:3000](http://localhost:3000)
- API health: [http://localhost:3001/health](http://localhost:3001/health)
- API readiness (Postgres + Redis): [http://localhost:3001/health/ready](http://localhost:3001/health/ready)
- Web status page: [http://localhost:3000/health](http://localhost:3000/health)

The health endpoint should return:

```json
{ "status": "ok" }
```

## Stop Docker services

```
docker compose down
```

This stops PostgreSQL and Redis. The local data is kept in Docker volumes.

To also delete that local data:

```
docker compose down -v
```

## Useful commands

```
npm run dev
npm run build
npm run typecheck
npm run lint
npm run db:generate
npm run db:migrate
```
