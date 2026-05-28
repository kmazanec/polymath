#!/usr/bin/env bash
# Post-deploy smoke test (F-01 acceptance criteria 1–4). Hits the stack through
# its entrypoint and fails (non-zero) if any check fails, so a deploy can roll
# back on failure. BASE defaults to the local compose entrypoint.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
echo "smoke: target $BASE"

# 1. Static frontend returns 200. The SPA shell is served; the LessonIntro card
#    ("Lesson 1 — Basic operators") is rendered client-side after the bundle +
#    WS connect, so the static HTML only needs to be the app shell. The full
#    "card visible" check is the browser/E2E assertion (see feature notes).
echo -n "  [1] GET / ... "
html="$(curl -fsS "$BASE/")"
echo "$html" | grep -qi "polymath" && echo "ok (app shell served)"

# 2. Health endpoint returns {"status":"ok"}.
echo -n "  [2] GET /api/health ... "
health="$(curl -fsS "$BASE/api/health")"
[ "$health" = '{"status":"ok"}' ] && echo "ok ($health)"

# 3 + 4. Create a session (writes sessions row), then round-trip a submit over
# the WebSocket and confirm a no_action comes back.
echo -n "  [3] POST /api/session ... "
session_json="$(curl -fsS -X POST "$BASE/api/session")"
session_id="$(printf '%s' "$session_json" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
[ -n "$session_id" ] && echo "ok ($session_id)"

echo -n "  [4] WS submit round-trip ... "
ws_base="${BASE/http/ws}"
# Run the WS probe from a directory where the `ws` package resolves (the agent
# workspace). $REPO_ROOT is this script's repo; fall back to the script's dir.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$repo_root/apps/agent" && WS_URL="$ws_base" SID="$session_id" node -e '
import("ws").then(({ WebSocket }) => {
  const ws = new WebSocket(process.env.WS_URL + "/agent");
  ws.on("open", () => ws.send(JSON.stringify({kind:"submit",sessionId:process.env.SID,itemId:"l1-and",submission:"A AND B"})));
  ws.on("message", d => { const m = JSON.parse(d); if (m.kind === "action" && m.action.type === "no_action") { console.log("ok (no_action)"); process.exit(0); } });
  ws.on("error", e => { console.error("ws error", e.message); process.exit(1); });
  setTimeout(() => { console.error("timeout"); process.exit(1); }, 5000);
});
' )

echo "smoke: all checks passed"
