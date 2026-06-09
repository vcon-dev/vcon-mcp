#!/usr/bin/env bash
# Launch a vCon MCP instance scoped to one group.
#
# Loads .env.<group> and labels the instance, then runs the built server.
# Use this for project- OR schema-isolated groups; the isolation is decided
# entirely by what's in the group's env file (SUPABASE_URL / SUPABASE_DB_SCHEMA).
#
# Usage:
#   scripts/start-group.sh <group>
#
# Example:
#   scripts/start-group.sh sales       # loads .env.sales, label=sales
#
# Env file is resolved relative to the repo root. Build first: npm run build.

set -euo pipefail

GROUP="${1:-}"
if [[ -z "$GROUP" ]]; then
  echo "Usage: $0 <group>   (expects a .env.<group> file)" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.$GROUP"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "Create it from .env.example with this group's SUPABASE_URL / keys / SUPABASE_DB_SCHEMA." >&2
  exit 1
fi

export ENV_FILE
export VCON_INSTANCE_LABEL="${VCON_INSTANCE_LABEL:-$GROUP}"

echo "Starting vCon MCP instance: group=$GROUP env=$ENV_FILE" >&2
exec node "$ROOT/dist/index.js"
