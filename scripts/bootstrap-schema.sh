#!/usr/bin/env bash
# Bootstrap a per-group Postgres schema (Mode B — schema isolation).
#
# Clones the current `public` object set (tables, indexes, the vcon_tags_mv
# materialized view, triggers, and the search RPCs) into a new named schema in
# the SAME Supabase project, so a vCon MCP instance with SUPABASE_DB_SCHEMA=<schema>
# is fully isolated from other groups in that project.
#
# It works by dumping `public` schema-only with pg_dump, rewriting the schema
# name, and writing the result to a reviewable .sql file. By default it does NOT
# apply — review the generated SQL, then re-run with --apply (or psql it yourself).
#
# Why review first: cross-schema references (the `extensions` schema for pgvector
# etc., `auth`, `pg_catalog`) must stay pointing at their original schema, not be
# rewritten to <schema>. The rewrite below only retargets `public.`, and
# extension-owned names that live in `public` (e.g. pgvector's `vector` type when
# the extension is installed there) are excluded from the rewrite — pg_dump does
# not re-create extension members, so those references must keep pointing at the
# real objects in `public`. Verify the output before applying to a shared project.
#
# Usage:
#   scripts/bootstrap-schema.sh <schema> [--db-url URL] [--db-container NAME] [--apply]
#
# Examples:
#   scripts/bootstrap-schema.sh sales
#       → writes sql/bootstrap-sales.sql (review it)
#   scripts/bootstrap-schema.sh sales --apply
#       → writes + applies it
#
# DB URL resolution (first match wins):
#   1. --db-url argument
#   2. $SUPABASE_DB_URL
#   3. local default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#
# Requires: perl (ships with macOS), plus EITHER pg_dump/psql on PATH whose major
# version is >= the server's, OR Docker running the local Supabase stack. When the
# host binaries are missing or older than the server (e.g. Homebrew Postgres 14 vs
# Supabase local 17, where pg_dump aborts), the script automatically runs
# pg_dump/psql inside the `supabase_db_<project>` container that publishes the DB
# port. Override container detection with --db-container.
#
# The generated SQL ends with GRANTs for anon/authenticated/service_role (the dump
# is taken with --no-privileges, so without them PostgREST gets "permission denied
# for schema <schema>").
#
# After applying, remember to ADD <schema> to PostgREST exposed schemas
# (Dashboard → API → Exposed schemas, or [api] schemas in supabase/config.toml)
# or supabase-js will not be able to reach it.

set -euo pipefail

SCHEMA="${1:-}"
if [[ -z "$SCHEMA" ]]; then
  echo "Usage: $0 <schema> [--db-url URL] [--db-container NAME] [--apply]" >&2
  exit 2
fi
shift || true

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
APPLY=false
DB_CONTAINER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url) DB_URL="$2"; shift 2 ;;
    --db-container) DB_CONTAINER="$2"; shift 2 ;;
    --apply)  APPLY=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Reject reserved / unsafe schema names.
if [[ "$SCHEMA" =~ [^a-zA-Z0-9_] || "$SCHEMA" == "public" || "$SCHEMA" == "extensions" || "$SCHEMA" == "auth" ]]; then
  echo "Refusing schema name '$SCHEMA' (use a simple identifier; not public/extensions/auth)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/sql"
OUT_FILE="$OUT_DIR/bootstrap-$SCHEMA.sql"
mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------------------
# Pick how to run pg_dump/psql: host binaries if their major version can serve
# this server, otherwise `docker exec` into the Supabase db container that
# publishes the DB port. pg_dump refuses servers newer than itself, so Homebrew
# Postgres 14 against Supabase local 17 must go through the container.
# ---------------------------------------------------------------------------

# Split the URL so the docker path can talk to Postgres on its in-container
# address (127.0.0.1:5432) with the same credentials/database.
DB_REST="${DB_URL#*://}"                       # user:pass@host:port/db
DB_USERINFO=""
DB_HOSTPART="$DB_REST"
if [[ "$DB_REST" == *@* ]]; then
  DB_USERINFO="${DB_REST%%@*}@"
  DB_HOSTPART="${DB_REST#*@}"
fi
DB_PATH="/${DB_HOSTPART#*/}"                   # /dbname (+ params)
DB_HOSTPORT="${DB_HOSTPART%%/*}"
DB_HOST="${DB_HOSTPORT%%:*}"
DB_PORT="${DB_HOSTPORT##*:}"
[[ "$DB_PORT" == "$DB_HOSTPORT" ]] && DB_PORT=5432
CONTAINER_DB_URL="postgresql://${DB_USERINFO}127.0.0.1:5432${DB_PATH}"

PG_MODE=""

run_psql() {
  if [[ "$PG_MODE" == docker ]]; then
    docker exec -i "$DB_CONTAINER" psql "$CONTAINER_DB_URL" "$@"
  else
    psql "$DB_URL" "$@"
  fi
}

run_pg_dump() {
  if [[ "$PG_MODE" == docker ]]; then
    docker exec -i "$DB_CONTAINER" pg_dump -d "$CONTAINER_DB_URL" "$@"
  else
    pg_dump -d "$DB_URL" "$@"
  fi
}

local_server_major() {
  psql "$DB_URL" -tAc 'SHOW server_version_num' 2>/dev/null | awk 'NF {print int($1/10000)}'
}

if [[ -z "$DB_CONTAINER" ]] && command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
  # "pg_dump (PostgreSQL) 14.17 (Homebrew)" -> 14
  DUMP_MAJOR="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
  SERVER_MAJOR="$(local_server_major || true)"
  if [[ -n "$SERVER_MAJOR" && -n "$DUMP_MAJOR" && "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ]]; then
    PG_MODE=local
  elif [[ -n "$SERVER_MAJOR" ]]; then
    echo "Host pg_dump is v$DUMP_MAJOR but the server is v$SERVER_MAJOR; looking for a Supabase db container ..." >&2
  fi
fi

if [[ -z "$PG_MODE" ]]; then
  if [[ -z "$DB_CONTAINER" ]]; then
    if [[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" || "$DB_HOST" == "::1" ]] \
       && command -v docker >/dev/null 2>&1; then
      DB_CONTAINER="$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}' 2>/dev/null \
                      | grep '^supabase_db_' | head -n1 || true)"
    fi
    if [[ -z "$DB_CONTAINER" ]]; then
      echo "No usable pg_dump/psql: host binaries are missing or older than the server," >&2
      echo "and no supabase_db_* container publishes port ${DB_PORT}." >&2
      echo "Install matching Postgres client tools, or pass --db-container <name>." >&2
      exit 1
    fi
  fi
  PG_MODE=docker
  if ! docker exec -i "$DB_CONTAINER" psql "$CONTAINER_DB_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
    echo "Could not reach Postgres via container '$DB_CONTAINER' ($CONTAINER_DB_URL)." >&2
    exit 1
  fi
  echo "Using pg_dump/psql inside container '$DB_CONTAINER'." >&2
fi

# ---------------------------------------------------------------------------
# Extension-owned names installed in `public` must NOT be rewritten: pg_dump
# skips extension members, so e.g. rewriting `public.vector` to `<schema>.vector`
# fails with "type <schema>.vector does not exist". Collect those names (types,
# functions, relations, operator classes/families) and exclude them. pgvector's
# names are seeded as a floor in case the catalog query fails.
# ---------------------------------------------------------------------------
EXT_NAME_SQL="
WITH members AS (
  SELECT d.classid, d.objid
  FROM pg_depend d
  JOIN pg_extension e ON d.refobjid = e.oid
  WHERE d.refclassid = 'pg_extension'::regclass
    AND d.deptype = 'e'
    AND e.extnamespace = 'public'::regnamespace
)
SELECT t.typname FROM members m JOIN pg_type t     ON m.classid = 'pg_type'::regclass     AND t.oid = m.objid
UNION SELECT p.proname FROM members m JOIN pg_proc p     ON m.classid = 'pg_proc'::regclass     AND p.oid = m.objid
UNION SELECT c.relname FROM members m JOIN pg_class c    ON m.classid = 'pg_class'::regclass    AND c.oid = m.objid
UNION SELECT o.opcname FROM members m JOIN pg_opclass o  ON m.classid = 'pg_opclass'::regclass  AND o.oid = m.objid
UNION SELECT f.opfname FROM members m JOIN pg_opfamily f ON m.classid = 'pg_opfamily'::regclass AND f.oid = m.objid;
"
EXCLUDE="vector|halfvec|sparsevec"
EXT_NAMES="$(run_psql -tA -c "$EXT_NAME_SQL" 2>/dev/null | grep -E '^[A-Za-z0-9_]+$' | sort -u || true)"
for name in $EXT_NAMES; do
  case "|$EXCLUDE|" in
    *"|$name|"*) ;;
    *) EXCLUDE="$EXCLUDE|$name" ;;
  esac
done

echo "Dumping public schema from $DB_URL ..." >&2
DUMP="$(run_pg_dump --schema-only --no-owner --no-privileges -n public)"

# Rewrite public -> <schema>. Retarget only `public.` qualified refs and the
# schema declarations; leave extensions/auth/pg_catalog and extension-owned
# names untouched. perl (not sed) because BSD sed has no \b word boundary —
# on macOS the old sed expression silently matched nothing.
echo "Rewriting public -> $SCHEMA ..." >&2
{
  echo "-- Generated by scripts/bootstrap-schema.sh for schema '$SCHEMA'."
  echo "-- REVIEW cross-schema references (extensions/auth) before applying."
  echo "CREATE SCHEMA IF NOT EXISTS \"$SCHEMA\";"
  echo "SET search_path TO \"$SCHEMA\", extensions, public;"
  echo
  printf '%s\n' "$DUMP" | perl -pe "
    s/\\bpublic\\.(?!(?:${EXCLUDE})\\b)/${SCHEMA}./g;
    s/^CREATE SCHEMA public;\\s*$//;
    s/SET search_path = public\\b/SET search_path = ${SCHEMA}/g;
  "
  cat <<GRANTS

-- The dump above is taken with --no-privileges, so grant the Supabase API
-- roles explicitly (mirrors what public gets out of the box). Without these,
-- PostgREST returns "permission denied for schema $SCHEMA".
GRANT USAGE ON SCHEMA "$SCHEMA" TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA "$SCHEMA" TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA "$SCHEMA" TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA "$SCHEMA" TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "$SCHEMA" GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "$SCHEMA" GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "$SCHEMA" GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANTS
} > "$OUT_FILE"

echo "Wrote $OUT_FILE" >&2

# Guardrail: the output must actually reference the new schema. Catches a
# silently-ineffective rewrite (the original BSD-sed failure mode).
if ! grep -q "${SCHEMA}\.vcons" "$OUT_FILE"; then
  echo "ERROR: $OUT_FILE does not contain '${SCHEMA}.vcons' — the rewrite did not take effect." >&2
  exit 1
fi

if [[ "$APPLY" == true ]]; then
  echo "Applying $OUT_FILE to $DB_URL ..." >&2
  run_psql -v ON_ERROR_STOP=1 -f - < "$OUT_FILE"
  echo "Applied. Don't forget to expose '$SCHEMA' to PostgREST." >&2
else
  echo "Dry run (no --apply). Review the SQL, then re-run with --apply or:" >&2
  echo "  psql \"$DB_URL\" -v ON_ERROR_STOP=1 -f $OUT_FILE" >&2
fi
