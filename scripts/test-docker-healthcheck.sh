#!/usr/bin/env bash
# Regression test for CON-792: the HEALTHCHECK used http://localhost, which resolves to
# [::1] inside the container while the server binds 0.0.0.0 (IPv4-only), so every container
# reported "unhealthy" while serving fine.
#
# Two checks:
#   1. the baked HEALTHCHECK command does not use "localhost"  (deterministic)
#   2. a container with an IPv4-only listener actually reaches Health.Status=healthy  (real)
#
# The real server needs Supabase to answer /api/v1/health with 200, so check 2 substitutes a
# stub IPv4 listener. That is the part of the stack the bug lived in.
set -euo pipefail

IMAGE="${IMAGE:-vcon-mcp:healthcheck-test}"
NAME="vcon-mcp-healthcheck-test-$$"
cd "$(dirname "$0")/.."

if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "==> building $IMAGE"
  docker build -t "$IMAGE" .
fi

echo "==> check 1: HEALTHCHECK does not target localhost"
cmd=$(docker inspect -f '{{join .Config.Healthcheck.Test " "}}' "$IMAGE")
echo "    $cmd"
case "$cmd" in
  *localhost*) echo "FAIL: HEALTHCHECK uses localhost (resolves to [::1]); use 127.0.0.1"; exit 1 ;;
esac

echo "==> check 2: container with an IPv4-only listener reports healthy"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" --entrypoint node "$IMAGE" -e "
  require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end('{\"status\":\"healthy\"}')})
    .listen(process.env.MCP_HTTP_PORT||3000,'0.0.0.0')" >/dev/null

for _ in $(seq 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME")
  [[ "$status" == "healthy" ]] && { echo "    healthy"; echo "PASS"; exit 0; }
  [[ "$status" == "unhealthy" ]] && break
  sleep 2
done

echo "FAIL: container never became healthy (status=$status)"
docker inspect -f '{{json .State.Health}}' "$NAME"
exit 1
