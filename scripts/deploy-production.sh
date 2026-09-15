#!/usr/bin/env bash
# Production deploy for Udderly Platform API (this Compose project only).
# Intended path on the Droplet: /opt/projects/udderly-platform
#
# Does not modify Traefik, the public website, DNS, or other Compose projects.
# Does not prune Docker images, volumes, containers, or networks.
#
# Git: this script does not pull unless DEPLOY_GIT_PULL=1. Prefer updating
# the checkout (git pull --ff-only) before running this script.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

COMPOSE=(docker compose -f docker-compose.production.yml)
API_PORT_VALUE="${API_PORT:-3001}"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

env_value() {
  local key="$1"
  # Prints the value of KEY from .env without echoing other secrets.
  # Values may contain '='. Empty / missing yields empty string.
  awk -F= -v key="${key}" '
    $1 == key {
      sub(/^[^=]+=/, "", $0)
      print $0
      exit
    }
  ' .env | tr -d '\r'
}

env_nonempty() {
  local key="$1"
  local value
  value="$(env_value "${key}")"
  if [[ -z "${value}" ]]; then
    die "missing or empty ${key} in .env"
  fi
}

log "Udderly Platform production deploy"
log "Working directory: ${ROOT}"

require_command docker
docker compose version >/dev/null 2>&1 || die "docker compose is required"

[[ -f docker-compose.production.yml ]] || die "missing docker-compose.production.yml"
[[ -f apps/api/Dockerfile ]] || die "missing apps/api/Dockerfile"
[[ -f .env ]] || die "missing .env (copy .env.production.example and fill in values on the server only)"

env_nonempty NODE_ENV
env_nonempty API_PORT
env_nonempty DATABASE_URL
env_nonempty REDIS_URL
env_nonempty WEB_ORIGIN
env_nonempty POSTGRES_DB
env_nonempty POSTGRES_USER
env_nonempty POSTGRES_PASSWORD

node_env_value="$(env_value NODE_ENV)"
if [[ "${node_env_value}" != "production" ]]; then
  die "NODE_ENV in .env must be production"
fi

if docker network inspect web >/dev/null 2>&1; then
  log "External Docker network web: present"
else
  die "external Docker network 'web' not found (required for Traefik)"
fi

if [[ "${DEPLOY_GIT_PULL:-0}" == "1" ]]; then
  require_command git
  log "Updating git checkout (ff-only)"
  git pull --ff-only
else
  log "Skipping git pull (set DEPLOY_GIT_PULL=1 to pull --ff-only from this script)"
fi

API_PORT_VALUE="$(env_value API_PORT)"
[[ -n "${API_PORT_VALUE}" ]] || API_PORT_VALUE="3001"

log "Building API image"
"${COMPOSE[@]}" build api

log "Starting Postgres and Redis"
"${COMPOSE[@]}" up -d --wait postgres redis

log "Applying committed Drizzle migrations (one-off; will not start API on failure)"
"${COMPOSE[@]}" --profile migrate run --rm --no-deps migrate

HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_POLL_SECONDS="${DEPLOY_HEALTH_POLL_SECONDS:-2}"
API_CONTAINER_NAME="udderly-platform-production-api"

api_docker_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${API_CONTAINER_NAME}" 2>/dev/null || printf '%s\n' "unknown"
}

api_exec_node() {
  "${COMPOSE[@]}" exec -T api node -e "$1" >/dev/null 2>&1
}

api_liveness_ok() {
  if api_exec_node "
    const port = process.env.API_PORT || '3001';
    fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(2000) })
      .then(async (r) => {
        const body = await r.text();
        if (!r.ok) process.exit(1);
        if (!body.includes('\"status\":\"ok\"') && !body.includes('\"status\": \"ok\"')) {
          process.exit(1);
        }
      })
      .catch(() => process.exit(1));
  "; then
    return 0
  fi

  # Docker may still report "starting" (start_period) after the process is up.
  # Treat an already-healthy container as liveness success if inspect can see it.
  [[ "$(api_docker_health)" == "healthy" ]]
}

api_readiness_ok() {
  api_exec_node "
    const port = process.env.API_PORT || '3001';
    fetch('http://127.0.0.1:' + port + '/health/ready', { signal: AbortSignal.timeout(2000) })
      .then(async (r) => {
        const body = await r.json();
        if (body.status !== 'ok') process.exit(1);
        if (!body.checks || body.checks.postgres.status !== 'up' || body.checks.redis.status !== 'up') {
          process.exit(1);
        }
      })
      .catch(() => process.exit(1));
  "
}

wait_for_condition() {
  local description="$1"
  local check_fn="$2"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    if "${check_fn}"; then
      return 0
    fi
    sleep "${HEALTH_POLL_SECONDS}"
  done

  die "${description} did not succeed within ${HEALTH_TIMEOUT_SECONDS}s (Docker health: $(api_docker_health))"
}

log "Starting/updating API"
"${COMPOSE[@]}" up -d api

log "Container status"
"${COMPOSE[@]}" ps

log "Waiting for API health..."
wait_for_condition "API liveness (GET /health)" api_liveness_ok
log "API is healthy."

log "Waiting for API readiness..."
wait_for_condition "API readiness (GET /health/ready)" api_readiness_ok
log "API is ready."

log "Deploy finished."
log "Public hostname (API only): https://goatbarn.udderlyridiculousfarmlife.com"
log "Liveness:  GET /health"
log "Readiness: GET /health/ready"
