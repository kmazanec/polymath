#!/usr/bin/env bash
#
# Polymath production deploy — release-symlink pattern, matching the droplet
# convention in `.infra/NEW_APP.md` (canonical reference: yourai/context-shield/
# infra/deploy.sh; multi-image structure mirrors companycam/rooftrace/infra/
# deploy.sh). Invoked by the GitLab CI `deploy` job from the runner's OWN checkout
# of the tested commit (`bash ./infra/deploy.sh`), NOT from the deployed release
# tree — so the runner always runs THIS commit's deploy logic.
#
# Polymath is a two-image app (the agent + the web SPA) plus a Postgres:
#   * ops/compose.prod.yaml builds polymath-agent and polymath-web, both from
#     /srv/polymath/current; postgres uses the upstream image.
#   * Health-check hits the PUBLIC URL (https://polymath.biograph.dev/api/health,
#     served by the agent through the shared Caddy); falls back to an in-network
#     exec against the agent if the runner can't reach the public URL.
#   * The Postgres data volume lives at /opt/polymath/postgres (host bind-mount),
#     OUTSIDE the release tree, so it survives every release swap. The agent runs
#     Drizzle migrations on boot.
#
# Layout this script assumes (one-time root setup — see .infra/NEW_APP.md §1):
#   /srv/polymath/releases/<sha>/   immutable per-release trees (rsynced from checkout)
#   /srv/polymath/current           symlink -> releases/<sha>/ (atomic swap)
#   /etc/polymath/.env              operator-placed secrets (640 root:gitlab-runner)
#   /etc/polymath/docker-compose.yml + polymath.caddyfile   synced from ops/ each run
#   /opt/polymath/postgres          Postgres data volume (persistent, outside releases)

set -euo pipefail

RELEASES_DIR=${RELEASES_DIR:-/srv/polymath/releases}
CURRENT_LINK=${CURRENT_LINK:-/srv/polymath/current}
CONFIG_DIR=${CONFIG_DIR:-/etc/polymath}
CADDY_CONFD=${CADDY_CONFD:-/etc/caddy/conf.d}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-polymath}
PUBLIC_URL=${PUBLIC_URL:-https://polymath.biograph.dev}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-300}
KEEP_RELEASES=${KEEP_RELEASES:-2}
SHARED_NETWORK=${SHARED_NETWORK:-openemr_default}

log() { echo "[deploy] $*"; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECKOUT_DIR=${CI_PROJECT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}

# Deploy EXACTLY the commit CI tested (DEPLOY_SHA=$CI_COMMIT_SHA), defending the
# `needs: [test]` gate. Fall back to the checkout HEAD for a manual invocation.
if [[ -n "${DEPLOY_SHA:-}" ]]; then
    NEW_SHA="${DEPLOY_SHA}"
else
    NEW_SHA=$(git -C "${CHECKOUT_DIR}" rev-parse HEAD)
    log "no DEPLOY_SHA set (manual invocation); deploying checkout HEAD ${NEW_SHA}"
fi
SHORT_SHA=$(printf '%s' "${NEW_SHA}" | cut -c1-7)

log "starting at $(date -Iseconds)"

# ---------------------------------------------------------------------
# 1. Provision the on-host layout (idempotent). /srv is root-owned, so the
#    unprivileged runner cannot create /srv/polymath itself — that one-time
#    privileged setup must already be done (see .infra/NEW_APP.md §1).
# ---------------------------------------------------------------------
if ! mkdir -p "${RELEASES_DIR}" "${CONFIG_DIR}" 2>/dev/null; then
    log "FATAL: cannot create ${RELEASES_DIR} / ${CONFIG_DIR} as $(whoami)."
    log "       One-time setup is missing — on the droplet, as root:"
    log "         sudo mkdir -p ${RELEASES_DIR} ${CONFIG_DIR} /opt/polymath/postgres"
    log "         sudo chown -R gitlab-runner:gitlab-runner $(dirname "${RELEASES_DIR}") ${CONFIG_DIR}"
    log "       and place ${CONFIG_DIR}/.env (640 root:gitlab-runner). See .infra/NEW_APP.md."
    exit 1
fi

if [[ -L "${CURRENT_LINK}" ]]; then
    OLD_SHA=$(basename "$(readlink -f "${CURRENT_LINK}")")
else
    OLD_SHA=""
fi
log "deploying ${OLD_SHA:-<none>} -> ${NEW_SHA}"

# ---------------------------------------------------------------------
# 2. Materialize this SHA as a release by rsyncing the whole checkout.
# ---------------------------------------------------------------------
NEW_RELEASE="${RELEASES_DIR}/${NEW_SHA}"
log "materializing release ${NEW_SHA} from checkout ${CHECKOUT_DIR}"
mkdir -p "${NEW_RELEASE}"
rsync --archive --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='**/node_modules/' \
    --exclude='**/dist/' \
    --exclude='.worktrees/' \
    --exclude='coverage/' \
    --exclude='**/*.tsbuildinfo' \
    "${CHECKOUT_DIR}/" "${NEW_RELEASE}/"

# ---------------------------------------------------------------------
# 3. Copy managed config into CONFIG_DIR. CONFIG_DIR is SHARED (also holds the
#    root-written .env), so do NOT use --archive/--delete (would chgrp the dir
#    or delete the .env). Copy only the files we own, no owner/group, no delete.
# ---------------------------------------------------------------------
log "syncing compose + caddyfile to ${CONFIG_DIR}"
rsync --recursive --links --perms --times --no-owner --no-group \
    "${NEW_RELEASE}/ops/compose.prod.yaml" \
    "${CONFIG_DIR}/docker-compose.yml"
rsync --recursive --links --perms --times --no-owner --no-group \
    "${NEW_RELEASE}/ops/polymath.caddyfile" \
    "${CONFIG_DIR}/polymath.caddyfile"

ENV_FILE="${CONFIG_DIR}/.env"
if [[ ! -r "${ENV_FILE}" ]]; then
    log "FATAL: cannot read ${ENV_FILE} as $(whoami) — provision it once (see .infra/NEW_APP.md §4.1)"
    ls -la "${ENV_FILE}" 2>/dev/null || true
    exit 1
fi

# Tag images with the release SHA so we can detect a stale (un-rebuilt) image and
# so `docker images` is legible. The runner owns /etc/polymath but NOT the
# root-owned .env, so pass GIT_SHA via a tiny runner-owned override file that
# compose reads alongside the secret env_file.
cat > "${CONFIG_DIR}/git-sha.env" <<EOF
GIT_SHA=${SHORT_SHA}
EOF

# ---------------------------------------------------------------------
# 4. Install the Caddy route snippet (idempotent).
# ---------------------------------------------------------------------
log "installing Caddy route snippet into ${CADDY_CONFD}"
mkdir -p "${CADDY_CONFD}"
cp "${NEW_RELEASE}/ops/polymath.caddyfile" "${CADDY_CONFD}/polymath.caddyfile"

# ---------------------------------------------------------------------
# 5. Atomic symlink swap.
# ---------------------------------------------------------------------
log "swapping ${CURRENT_LINK} ${OLD_SHA:-<none>} -> ${NEW_SHA}"
TMP_LINK="${CURRENT_LINK}.new.$$"
ln -sfn "${NEW_RELEASE}" "${TMP_LINK}"
mv -T "${TMP_LINK}" "${CURRENT_LINK}"

# ---------------------------------------------------------------------
# 6. Verify the shared network, then build + recreate. Build contexts in the
#    compose file are absolute (/srv/polymath/current), so the images match the
#    just-swapped SHA. Fail closed if openemr_default is missing.
# ---------------------------------------------------------------------
if ! docker network inspect "${SHARED_NETWORK}" >/dev/null 2>&1; then
    log "FATAL: shared network ${SHARED_NETWORK} not found — is the openemr stack up?"
    log "       Caddy lives on it and must reach polymath-web / polymath-agent over it."
    exit 1
fi

cd "${CONFIG_DIR}"
log "building and recreating the stack"
docker compose --project-name "${COMPOSE_PROJECT}" \
    --env-file "${CONFIG_DIR}/.env" \
    --env-file "${CONFIG_DIR}/git-sha.env" \
    up --detach --build --force-recreate

# Best-effort Caddy reload (the openemr compose owns the caddy container).
CADDY_CONTAINER=$(docker ps --format '{{.Names}}' | grep -m1 caddy || true)
if [[ -n "${CADDY_CONTAINER}" ]]; then
    log "reloading Caddy (${CADDY_CONTAINER})"
    docker exec "${CADDY_CONTAINER}" caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
        || log "caddy reload failed (snippet is in place for next restart); continuing"
fi

# ---------------------------------------------------------------------
# 7. Health-check loop. Prefer the public URL (proves the whole path incl. Caddy);
#    fall back to an in-network exec against the agent's /api/health if the runner
#    can't reach the public URL. Roll the symlink back on failure.
# ---------------------------------------------------------------------
log "waiting for health (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
while (( $(date +%s) < deadline )); do
    if curl -fsS -o /dev/null --max-time 10 "${PUBLIC_URL}/api/health" 2>/dev/null; then
        log "healthy (public ${PUBLIC_URL}/api/health)"
        healthy=1
        break
    fi
    if timeout 10 docker compose --project-name "${COMPOSE_PROJECT}" exec -T agent \
            node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
        log "healthy (in-network /api/health; public URL not reachable from runner)"
        healthy=1
        break
    fi
    sleep 5
done

if (( healthy == 0 )); then
    log "health check did not pass within ${HEALTH_TIMEOUT}s"
    docker compose --project-name "${COMPOSE_PROJECT}" logs --tail=60 agent || true
    if [[ -n "${OLD_SHA}" && -d "${RELEASES_DIR}/${OLD_SHA}" ]]; then
        OLD_RELEASE="${RELEASES_DIR}/${OLD_SHA}"
        log "rolling back ${CURRENT_LINK} -> ${OLD_SHA}"
        TMP_LINK="${CURRENT_LINK}.rollback.$$"
        ln -sfn "${OLD_RELEASE}" "${TMP_LINK}"
        mv -T "${TMP_LINK}" "${CURRENT_LINK}"
        rsync --recursive --links --perms --times --no-owner --no-group \
            "${OLD_RELEASE}/ops/compose.prod.yaml" "${CONFIG_DIR}/docker-compose.yml"
        ( cd "${CONFIG_DIR}" && docker compose --project-name "${COMPOSE_PROJECT}" \
            --env-file "${CONFIG_DIR}/.env" --env-file "${CONFIG_DIR}/git-sha.env" \
            up --detach --build --force-recreate ) || true
    else
        log "no previous release to roll back to"
    fi
    exit 1
fi

# ---------------------------------------------------------------------
# 8. Prune old releases (keep KEEP_RELEASES + whatever current points at).
# ---------------------------------------------------------------------
KEEP_TARGET=$(readlink -f "${CURRENT_LINK}")
log "pruning ${RELEASES_DIR} (keeping ${KEEP_RELEASES} + current)"
# shellcheck disable=SC2012
mapfile -t all_releases < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | sed 's:/$::')
kept=0
for r in "${all_releases[@]}"; do
    if [[ "${r}" == "${KEEP_TARGET}" ]]; then
        log "keep ${r} (current)"
        continue
    fi
    if (( kept < KEEP_RELEASES - 1 )); then
        log "keep ${r}"
        kept=$(( kept + 1 ))
    else
        log "prune ${r}"
        rm -rf "${r}" || log "rm -rf ${r} failed; leaving it"
    fi
done

log "complete at $(date -Iseconds)"
