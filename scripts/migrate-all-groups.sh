#!/usr/bin/env bash
# Fan out a migration run across every group's env file.
#
# For each .env.<group> in the repo root:
#   - schema-isolated groups (SUPABASE_DB_SCHEMA set, non-public): apply the
#     group's generated bootstrap/migration SQL into that schema (idempotent).
#   - project-isolated groups (no SUPABASE_DB_SCHEMA, or =public): run
#     `supabase db push` against that group's project.
#
# This is the single command that keeps all groups in sync after a schema change.
#
# Usage:
#   scripts/migrate-all-groups.sh [--dry-run]
#
# Notes:
#   - Project mode requires the Supabase CLI linked/able to reach each project
#     (e.g. SUPABASE_DB_URL or a linked project). Adjust the push invocation to
#     your linking setup if needed.
#   - Schema mode expects a per-schema SQL file at sql/bootstrap-<schema>.sql
#     produced by scripts/bootstrap-schema.sh. Regenerate it when migrations change.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

shopt -s nullglob
ENV_FILES=("$ROOT"/.env.*)
if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  echo "No .env.<group> files found in $ROOT. Nothing to do." >&2
  exit 0
fi

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*" >&2
    "$@"
  fi
}

for ENV_FILE in "${ENV_FILES[@]}"; do
  # Skip non-group helpers like .env.example / .env.local.
  base="$(basename "$ENV_FILE")"
  [[ "$base" == ".env.example" || "$base" == ".env.local" ]] && continue

  group="${base#.env.}"
  # Read just the two vars we care about without polluting the shell env.
  url="$(grep -E '^\s*SUPABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | xargs || true)"
  schema="$(grep -E '^\s*SUPABASE_DB_SCHEMA=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | xargs || true)"

  echo "== group=$group url=${url:-<none>} schema=${schema:-public} ==" >&2

  if [[ -n "$schema" && "$schema" != "public" ]]; then
    # Schema-isolated.
    SQL="$ROOT/sql/bootstrap-$schema.sql"
    if [[ ! -f "$SQL" ]]; then
      echo "  ! Missing $SQL — run scripts/bootstrap-schema.sh $schema first. Skipping." >&2
      continue
    fi
    DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
    run psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
  else
    # Project-isolated.
    run env ENV_FILE="$ENV_FILE" supabase db push
  fi
done

echo "Done." >&2
