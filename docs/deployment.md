# Production deployment

This document is for the **Udderly Platform** on the existing DigitalOcean Droplet. It is separate from the public Udderly website.

Do not modify `/opt/traefik` or recreate Traefik. This project attaches the API to the existing external Docker network `web` so the already-running Traefik instance can route HTTPS.

## Temporary architecture

```
Internet
  → Traefik (existing, /opt/traefik, Let's Encrypt)
    → goatbarn.udderlyridiculousfarmlife.com
      → Udderly Platform API (NestJS)
        → PostgreSQL 16 (private Docker network only)
        → Redis 7 (private Docker network only)
    → giftcard.udderlyridiculousfarmlife.com
      → campaign website, except /naming
      → /naming goes to the same API
```

The campaign website container joins only the external `web` network. It does not join the internal database network and publishes no host ports. `scripts/deploy-production.sh` still migrates and restarts only the API. Start the website separately after `GIFT_CARD_BASIC_AUTH` is set:

```bash
docker compose -f docker-compose.production.yml up -d web
```

Leave `NAMING_CAMPAIGN_ENABLED=false` until launch. Production naming email uses Resend over HTTPS. Set `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, and `NAMING_PUBLIC_BASE_URL` together, or leave them empty. `RESEND_FROM` is an address on the verified sending domain. `RESEND_REPLY_TO` is the marketing mailbox. Gmail SMTP remains the local fallback: `SMTP_USER`, `SMTP_APP_PASSWORD`, and `SMTP_FROM` are all set or all empty. When both are set, Resend is used. `NAMING_PUBLIC_BASE_URL` is `https://giftcard.udderlyridiculousfarmlife.com`. `NAMING_PREVIEW_MODE=true` on the website container shows sample objects only. It does not enable purchases or the naming API. The browser calls `/naming` on that same hostname.

`goatbarn.udderlyridiculousfarmlife.com` serves the API only. The gift-card campaign is a separate hostname, `giftcard.udderlyridiculousfarmlife.com`, with HTTP Basic Auth on the site and its `/naming` routes. Goat Barn's hostname has no campaign password. Do not expose business-data endpoints on the gift-card hostname.

Staff inventory is `https://giftcard.udderlyridiculousfarmlife.com/inventory`. The page is served by the website. `/inventory/` and `/photos/` are routed to the API and do not use the campaign Basic Auth middleware. The API requires `NAMING_ADMIN_PASSWORD` and `NAMING_ADMIN_SESSION_SECRET` together; if either is missing, inventory administration stays closed. Purchasing stays off until `NAMING_CAMPAIGN_ENABLED=true`. The website page is still behind the existing site Basic Auth until that middleware is removed at launch. Public `/photos/{object-id}.jpg|png|webp` serves a photograph only while that object is published. Staff preview the same file at `/inventory/photos/…`, which requires the inventory session. The session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/inventory`. Reloading the page issues a new CSRF token for the same 12-hour session. Logout applies to the running API process.

## Server layout

| Item | Value |
| --- | --- |
| Suggested checkout | `/opt/projects/udderly-platform` |
| Hostname | `goatbarn.udderlyridiculousfarmlife.com` |
| Campaign hostname | `giftcard.udderlyridiculousfarmlife.com` |
| Campaign image | `udderly-platform-web:production` |
| Existing Traefik network | `web` (external) |
| Compose project | `udderly-platform-production` |
| API image | `udderly-platform-api:production` |

## Prerequisites

On the Droplet (already expected):

- Docker and Docker Compose
- Traefik v3 with entrypoint `websecure` and certificate resolver `letsencrypt`
- External Docker network `web`
- DNS for `goatbarn.udderlyridiculousfarmlife.com` pointing at the Droplet (configure DNS separately; this repo does not change DNS)

On the checkout:

- Git clone of this repository
- A server-only `.env` file (never commit it)

Confirm the Traefik network:

```bash
docker network inspect web
```

## Server `.env`

Copy `.env.production.example` to `.env` on the server and replace every placeholder.

Required:

- `NODE_ENV=production`
- `API_PORT` (use `3001` unless you also change the Traefik port label)
- `WEB_ORIGIN` (use `https://goatbarn.udderlyridiculousfarmlife.com`)
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (strong unique password; **not** the local `udderly` password)
- `DATABASE_URL` (host must be `postgres`, the Compose service name)
- `REDIS_URL` (host must be `redis`)

Optional (API starts without them):

- `WHEREWOLF_API_KEY`, `WHEREWOLF_APP_ID`
- `FAREHARBOR_WEBHOOK_SECRET`
- `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`
- `GOOGLE_ANALYTICS_PROPERTY_ID`, `GOOGLE_ANALYTICS_CLIENT_ID`, `GOOGLE_ANALYTICS_CLIENT_SECRET`, `GOOGLE_ANALYTICS_REFRESH_TOKEN`

Do not put real secrets in Git. Production Compose does not default `POSTGRES_PASSWORD`.

`API_LISTEN_HOST` is forced to `0.0.0.0` in Compose so Traefik can reach the process. Local development still defaults to `127.0.0.1`.

## First deployment

From `/opt/projects/udderly-platform` after `.env` is in place:

```bash
git pull --ff-only
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh
```

The script:

1. Fails fast if required files or `.env` keys are missing
2. Does **not** `git pull` unless you set `DEPLOY_GIT_PULL=1`
3. Builds the API image
4. Starts/updates Postgres and Redis and waits until they are healthy
5. Runs **committed** Drizzle migrations as a one-off container (`npm run db:migrate -w @udderly/api`)
6. Starts/updates the API only after migrations succeed
7. Waits up to 60s (every 2s) for internal `GET /health`, then `GET /health/ready`
8. Does not prune other Docker projects on the Droplet

If migrations fail, the script stops. A new API container is not started from that failed run. An older API container, if still running, is left in place until a later successful `up`.

Do not run `drizzle-kit generate` on the server. Only apply already committed files under `apps/api/drizzle/`.

## Normal later deployments

```bash
cd /opt/projects/udderly-platform
git pull --ff-only
./scripts/deploy-production.sh
```

Or:

```bash
DEPLOY_GIT_PULL=1 ./scripts/deploy-production.sh
```

## Health checks

| Endpoint | Meaning | Docker healthcheck |
| --- | --- | --- |
| `GET /health` | Process liveness (`{"status":"ok"}`) | Yes |
| `GET /health/ready` | Postgres + Redis | No (deploy script only) |

The container healthcheck uses `/health` on purpose. A short Redis or Postgres interruption should not make Docker restart the API in a loop. FareHarbor events are stored durably in PostgreSQL first; Redis/BullMQ is the processing path, not the source of truth.

`/health/ready` is still the deploy-time gate that both dependencies are up.

## FareHarbor recovery

Same workspace command as local development, inside Compose:

```bash
cd /opt/projects/udderly-platform
docker compose -f docker-compose.production.yml run --rm --no-deps api npm run integrations:recover -w @udderly/api
```

That runs compiled `apps/api/dist/integrations/recover-integration-events.cli.js` (no `tsx`). Eligible inbox statuses: `received`, `queued`, `processing`, `failed`.

Do not print environment variables or webhook secrets when recovering.

## Logs (avoid leaking the webhook secret)

The FareHarbor receiver is `POST /webhooks/fareharbor/:secret`. Nest request URLs are redacted to `/webhooks/fareharbor/[redacted]` in the application.

**Traefik access logs are not redacted by this project.** If Traefik logs full paths, the secret may appear there. Do not change `/opt/traefik` unless you explicitly decide to. Prefer not dumping Traefik access logs into tickets or chat.

Safe-ish API logs (still avoid sharing blindly):

```bash
docker compose -f docker-compose.production.yml logs --tail=200 api
```

Do not run commands that print `.env` or `DATABASE_URL`.

## Stop / restart only this project

```bash
cd /opt/projects/udderly-platform

# Restart API only
docker compose -f docker-compose.production.yml restart api

# Stop API, Postgres, and Redis for this project only.
# This does not stop the gift-card website.
docker compose -f docker-compose.production.yml stop api postgres redis

# Start them again
docker compose -f docker-compose.production.yml up -d postgres redis
docker compose -f docker-compose.production.yml --profile migrate run --rm --no-deps migrate
docker compose -f docker-compose.production.yml up -d api
```

Do **not** run `docker compose down -v` on production unless you intend to delete this project's named volumes.

Do **not** prune unused Docker objects; that can affect the public website and Traefik.

## Inspect containers

```bash
docker compose -f docker-compose.production.yml ps
docker inspect udderly-platform-production-api --format '{{.State.Status}} {{.State.Health.Status}}'
docker inspect udderly-platform-production-postgres --format '{{.State.Health.Status}}'
docker inspect udderly-platform-production-redis --format '{{.State.Health.Status}}'
```

Exec (no published host ports):

```bash
docker compose -f docker-compose.production.yml exec api node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.text()).then(console.log)"
docker compose -f docker-compose.production.yml exec postgres pg_isready
docker compose -f docker-compose.production.yml exec redis redis-cli ping
```

## Verify Traefik routing

From a machine that can resolve the hostname (after DNS and the first certificate):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://goatbarn.udderlyridiculousfarmlife.com/health
```

Expect HTTP 200 and body `{"status":"ok"}`.

On the Droplet, confirm the API container is on `web` and has Traefik labels:

```bash
docker inspect udderly-platform-production-api --format '{{json .NetworkSettings.Networks}}'
docker inspect udderly-platform-production-api --format '{{json .Config.Labels}}'
```

Postgres and Redis must **not** appear on network `web`.

## Persistence

- PostgreSQL data: Docker volume `udderly-platform-production-postgres-data`
- Redis AOF (`appendonly yes`, `appendfsync everysec`): volume `udderly-platform-production-redis-data`
- Naming photographs: Docker volume `udderly-platform-production-naming-photos`, mounted at `/data/naming-photos` in the API container

Redis persistence exists so BullMQ jobs can survive container restarts. **PostgreSQL is the durable source of truth** for FareHarbor inbox events. Redis is not the primary event store. Photograph files are not in PostgreSQL. `naming_object.photo_url` only stores the public path.

The API container runs as uid 1000. Before the first upload, make the new volume writable by that user:

```bash
docker run --rm -v udderly-platform-production-naming-photos:/data alpine chown 1000:1000 /data
```

Back up the photograph files with the volume, separately from `pg_dump`:

```bash
docker run --rm \
  -v udderly-platform-production-naming-photos:/data:ro \
  -v /var/backups/udderly-platform:/backup \
  alpine tar czf /backup/naming-photos-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data .
```

Restore only when the API is stopped, into the same volume, then start the API again. Do not use `docker compose down -v`; that deletes the volume. A restore replaces the files, and the database paths keep working when the file names still match the object ids. After restoring, repeat the `chown 1000:1000` command if the files are not owned by uid 1000.

## Networks

- `udderly-platform-production-internal` (`internal: true`): api, postgres, redis
- `web` (external): api only, for Traefik

No host ports are published for api, postgres, or redis. This Compose file does not publish 80/443 and does not start Traefik.
