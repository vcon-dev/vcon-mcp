#!/usr/bin/env bash
# apply.sh: apply the strict pack (tier 2 tenant isolation) to a vcon-mcp
# database, or check that it is in place.
#
#   DATABASE_URL=postgresql://... supabase/strict/apply.sh [--check | --dry-run]
#   supabase/strict/apply.sh [--check | --dry-run] --url-file FILE
#
#   (no flag)  apply strict_pack.sql, then run catalog_guard.sql, in one
#              transaction. Any error or guard failure rolls everything back.
#   --check    run catalog_guard.sql only. Changes nothing. Use after every
#              upgrade: a migration can CREATE OR REPLACE a search function
#              and bring a NULL branch back, and the guard fails if so.
#   --dry-run  apply and guard as above, then roll back.
#
# The connection string comes from DATABASE_URL or from the first line of
# --url-file, never from the command line, where `ps` would show its password.
# It is a postgres:// URL for a role that owns the vcon-mcp schema (postgres on
# Supabase). Its password is handed to psql in PGPASSWORD, not as an argument.
# With neither, psql uses the usual PG* variables.
#
# The pack refuses, changing nothing, while any tenant table holds a row with
# no tenant_id, or a child row whose tenant differs from its parent's. Re-running
# it on a database already in the strict state changes nothing.
#
# Exit: 0 applied, already applied, or check passed
#       2 usage, psql missing, or cannot connect
#       3 refused (rows without a tenant, mismatched children, schema too old)
#       4 catalog guard failed (rolled back, or --check found a gap)
#       1 any other error (rolled back)
set -uo pipefail

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mode=apply
url=${DATABASE_URL:-}

usage() { sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case $1 in
    --check) mode=check ;;
    --dry-run) mode=dry-run ;;
    --url-file)
      [ $# -ge 2 ] && [ -r "$2" ] || { echo "apply.sh: --url-file needs a readable file" >&2; exit 2; }
      IFS= read -r url <"$2" || [ -n "$url" ] || { echo "apply.sh: $2 is empty" >&2; exit 2; }
      shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "apply.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
    *) echo "apply.sh: pass the connection string in DATABASE_URL or --url-file, not as an argument (ps shows arguments)" >&2; exit 2 ;;
  esac
  shift
done

# Keep the password out of psql's arguments: move it to PGPASSWORD.
if [[ $url =~ ^(postgres(ql)?://)([^:@/?#]*):([^@/?#]*)@(.*)$ ]]; then
  pw=${BASH_REMATCH[4]}
  PGPASSWORD=$(printf '%b' "${pw//%/\\x}")
  export PGPASSWORD
  url="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
fi
if [[ $url == *password=* ]]; then
  echo "apply.sh: give the password in PGPASSWORD or in the URL's user:secret part, not as a URL query parameter" >&2
  exit 2
fi

command -v psql >/dev/null 2>&1 || { echo "apply.sh: psql not found" >&2; exit 2; }
for f in strict_pack.sql catalog_guard.sql; do
  [ -f "$DIR/$f" ] || { echo "apply.sh: missing $DIR/$f" >&2; exit 2; }
done

psql_args=(-X -q -v ON_ERROR_STOP=1)
[ -n "$url" ] && psql_args+=("$url")

if ! psql "${psql_args[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "apply.sh: cannot connect to the database" >&2
  psql "${psql_args[@]}" -c 'select 1' 2>&1 | tail -2 >&2
  exit 2
fi

out=$(mktemp "${TMPDIR:-/tmp}/strict-pack.XXXXXX")
trap 'rm -f "$out"' EXIT

case $mode in
  check)
    script=$(printf 'BEGIN READ ONLY;\nSET LOCAL client_min_messages = notice;\n\\i %s\nROLLBACK;\n' "$DIR/catalog_guard.sql") ;;
  dry-run)
    script=$(printf 'BEGIN;\n\\i %s\n\\i %s\nROLLBACK;\n' "$DIR/strict_pack.sql" "$DIR/catalog_guard.sql") ;;
  apply)
    script=$(printf 'BEGIN;\n\\i %s\n\\i %s\nCOMMIT;\n' "$DIR/strict_pack.sql" "$DIR/catalog_guard.sql") ;;
esac

printf '%s\n' "$script" | psql "${psql_args[@]}" -f - >"$out" 2>&1
rc=$?
# Notices and errors, without psql's file:line prefix.
sed -E 's/^psql:[^ ]+ (NOTICE|ERROR|WARNING|DETAIL|CONTEXT|HINT): +/\1: /' "$out"

if [ $rc -ne 0 ]; then
  if grep -q 'strict-pack: refused' "$out"; then
    echo "apply.sh: refused, nothing changed" >&2; exit 3
  elif grep -q 'catalog-guard:' "$out" && grep -q 'ERROR' "$out" && grep -q 'violation' "$out"; then
    if [ $mode = check ]; then echo "apply.sh: catalog guard failed" >&2
    else echo "apply.sh: catalog guard failed after the pack, rolled back" >&2; fi
    exit 4
  fi
  echo "apply.sh: failed, rolled back" >&2; exit 1
fi

changes=$(grep -c 'strict-pack: changed:' "$out")
case $mode in
  check)   echo "apply.sh: catalog guard passed" ;;
  dry-run) echo "apply.sh: dry run, $changes change(s) would apply, rolled back" ;;
  apply)
    if [ "$changes" -eq 0 ]; then echo "apply.sh: already in the strict state, nothing changed"
    else echo "apply.sh: strict pack applied, $changes change(s)"; fi ;;
esac
exit 0
