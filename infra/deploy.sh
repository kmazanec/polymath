#!/usr/bin/env bash
# Deploy Polymath to the DigitalOcean droplet (ADR-009). NOT run by F-01 — the
# walking skeleton is verified locally; this script is the documented path for
# the first real deploy. It is intentionally conservative: it builds + brings up
# the stack over SSH and rolls forward only if the health check passes.
#
# Prerequisites (one-time manual setup, see the feature spec "Manual setup"):
#   - DNS A-record polymath.biograph.dev -> droplet IP
#   - /opt/polymath/.env on the droplet (root-owned, 0600) with OPENAI_API_KEY etc.
#   - infra/caddy/polymath.caddyfile wrapped in a polymath.biograph.dev {…} block
#     dropped into /etc/caddy/conf.d/ on the host, host Caddy reloaded
#   - SSH access as the deploy user (the workspace uses `ssh gauntlet`)
set -euo pipefail

HOST="${POLYMATH_SSH_HOST:-gauntlet}"
REMOTE_DIR="${POLYMATH_REMOTE_DIR:-/opt/polymath}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

echo "deploy: syncing repo to $HOST:$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .worktrees --exclude dist \
  "$repo_root/" "$HOST:$REMOTE_DIR/"

echo "deploy: building + bringing up the stack on $HOST"
ssh "$HOST" "cd $REMOTE_DIR && docker compose --env-file /opt/polymath/.env build && docker compose --env-file /opt/polymath/.env up -d --wait"

echo "deploy: smoke-testing the live URL"
ssh "$HOST" "cd $REMOTE_DIR && bash infra/smoke.sh https://polymath.biograph.dev"

echo "deploy: done"
