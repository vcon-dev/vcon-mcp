#!/usr/bin/env bash
# test-anon-lockdown.sh: prove migration 20261109163739_revoke_anon_read_paths.sql
# refuses anon on every path that stepped around row-level security, while
# service_role and authenticated keep what the server relies on.
#
# Builds a throwaway Postgres cluster with Supabase-shaped roles and default
# privileges, applies the real migration chain from this checkout, and puts a
# real PostgREST in front of it, so requests take the same path they take on a
# Supabase stack: JWT verified, SET LOCAL ROLE, request.jwt.claims.
#
#   1. Chain up to the lockdown migration: anon reads tenant rows through the
#      views, the materialized view and exec_sql (the checks predict the leak).
#   2. Lockdown and any later migrations applied: anon is refused on all of them,
#      service_role and authenticated behave as before except where noted.
#   3. Lockdown applied a second time: still refused (idempotent).
#   4. supabase/tests/anon_lockdown.sql passes, and fails when a later function
#      is created without REVOKE EXECUTE ... FROM PUBLIC, anon.
#   5. scripts/bootstrap-schema.sh: a cloned schema gives anon nothing.
#
# Nothing outside a temporary directory is touched, apart from the generated
# sql/bootstrap-<schema>.sql (gitignored), which is removed. The cluster is
# stopped and deleted on exit.
#
# Usage:   scripts/test-anon-lockdown.sh          (KEEP=1 leaves the cluster running)
# Needs:   PostgreSQL 15+ server binaries (initdb, pg_ctl, psql, pg_dump), curl,
#          jq, openssl, perl. PostgREST v16.2 is downloaded once into
#          ~/.cache/vcon-mcp unless PGRST points at a binary.
# Env:     PGBIN, PGRST, PGPORT (54991), RESTPORT (54992), ADMINPORT (54993)
# Exit:    0 when every check passes, 1 otherwise.
#
# CI: on ubuntu-latest, PostgreSQL server binaries are preinstalled under
# /usr/lib/postgresql/<major>/bin and are found automatically, so a job step of
# `bash scripts/test-anon-lockdown.sh` is enough.
#
# Fixtures are synthetic and carry no lawful_basis attachment, on purpose: no
# basis is invented for a fake call.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MIG=$ROOT/supabase/migrations
LOCKDOWN=20261109163739_revoke_anon_read_paths.sql
SQLTEST=$ROOT/supabase/tests/anon_lockdown.sql
PGRST_VERSION=v16.2
PGPORT=${PGPORT:-54991}; RESTPORT=${RESTPORT:-54992}; ADMINPORT=${ADMINPORT:-54993}
GROUP_SCHEMA=anon_lockdown_grp

die() { echo "test-anon-lockdown: $*" >&2; exit 2; }

[ -f "$MIG/$LOCKDOWN" ] || die "missing $MIG/$LOCKDOWN"
for t in curl jq openssl perl; do command -v "$t" >/dev/null 2>&1 || die "needs $t"; done

# ---------------------------------------------------------------- PostgreSQL 15+
pg_major() { "$1/postgres" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }
if [ -z "${PGBIN:-}" ]; then
  for c in "$(pg_config --bindir 2>/dev/null)" \
           /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin \
           /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin; do
    if [ -n "$c" ] && [ -x "$c/initdb" ] && [ "$(pg_major "$c")" -ge 15 ] 2>/dev/null; then PGBIN=$c; break; fi
  done
fi
[ -n "${PGBIN:-}" ] && [ -x "$PGBIN/initdb" ] || die "no PostgreSQL 15+ server binaries found; set PGBIN"
[ "$(pg_major "$PGBIN")" -ge 15 ] || die "$PGBIN is PostgreSQL $(pg_major "$PGBIN"); security_invoker views need 15+"

# ---------------------------------------------------------------- PostgREST
if [ -z "${PGRST:-}" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  asset=macos-aarch64 ;;
    Darwin-x86_64) asset=macos-x86-64 ;;
    Linux-x86_64)  asset=linux-static-x86-64 ;;
    Linux-aarch64) asset=linux-static-aarch64 ;;
    *) die "no PostgREST build for $(uname -s)-$(uname -m); set PGRST" ;;
  esac
  dir=${XDG_CACHE_HOME:-$HOME/.cache}/vcon-mcp/postgrest-$PGRST_VERSION
  PGRST=$dir/postgrest
  if [ ! -x "$PGRST" ]; then
    mkdir -p "$dir"
    curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-$asset.tar.xz" \
      | tar -xJ -C "$dir" || die "cannot fetch PostgREST $PGRST_VERSION"
  fi
fi
[ -x "$PGRST" ] || die "PostgREST not executable at $PGRST"

if command -v lsof >/dev/null 2>&1; then
  for p in "$PGPORT" "$RESTPORT" "$ADMINPORT"; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && die "port $p in use"
  done
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/anon-lockdown.XXXXXX")
DATA=$WORK/pgdata
PGRST_PID=""
cleanup() {
  [ -n "$PGRST_PID" ] && kill "$PGRST_PID" 2>/dev/null
  rm -f "$ROOT/sql/bootstrap-$GROUP_SCHEMA.sql"; rmdir "$ROOT/sql" 2>/dev/null
  if [ "${KEEP:-0}" = 1 ]; then echo "KEEP=1: cluster left at $DATA on port $PGPORT"; return; fi
  "$PGBIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

NPASS=0; NFAIL=0
say()  { printf '%s\n' "$*"; }
head1() { say ""; say "=== $* ==="; }
check() { # id description expected actual
  if [ "$3" = "$4" ]; then NPASS=$((NPASS+1)); say "PASS $1 $2 | got: [$4]"
  else NFAIL=$((NFAIL+1)); say "FAIL $1 $2 | expected: [$3] got: [$4]"; fi
}
psql_as() { local u=$1; shift; "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U "$u" -d vcon_lockdown "$@"; }
sql()  { psql_as postgres -At -F'|' -v ON_ERROR_STOP=1 -c "$1"; }

# ---------------------------------------------------------------- cluster
head1 "setup"
say "repo: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')  postgres: $("$PGBIN/postgres" --version)  postgrest: $("$PGRST" --version | head -1)"
"$PGBIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$DATA" -w -l "$WORK/pg.log" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null || exit 1

"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL' || exit 1
-- The role attributes a Supabase stack has.
CREATE ROLE postgres LOGIN CREATEROLE CREATEDB BYPASSRLS;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;
CREATE DATABASE vcon_lockdown OWNER postgres;
SQL
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U supabase_admin -d vcon_lockdown -v ON_ERROR_STOP=1 2>/dev/null <<'SQL' || exit 1
ALTER SCHEMA public OWNER TO postgres;
CREATE SCHEMA extensions AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
ALTER ROLE postgres IN DATABASE vcon_lockdown SET search_path = "$user", public, extensions;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default privileges: everything a migration creates in public is
-- granted to anon, authenticated and service_role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
-- pgvector stand-in with text I/O, so the chain and the RPC signatures apply
-- unchanged without the extension. Distance is always 0.
CREATE TYPE extensions.vector;
CREATE FUNCTION extensions.vector_in(cstring) RETURNS extensions.vector AS 'textin' LANGUAGE internal IMMUTABLE STRICT;
CREATE FUNCTION extensions.vector_out(extensions.vector) RETURNS cstring AS 'textout' LANGUAGE internal IMMUTABLE STRICT;
CREATE FUNCTION extensions.vector_typmod_in(cstring[]) RETURNS integer AS 'varchartypmodin' LANGUAGE internal IMMUTABLE STRICT;
CREATE TYPE extensions.vector (INPUT = extensions.vector_in, OUTPUT = extensions.vector_out, TYPMOD_IN = extensions.vector_typmod_in, INTERNALLENGTH = VARIABLE, STORAGE = extended);
ALTER TYPE extensions.vector OWNER TO postgres;
CREATE FUNCTION extensions.vector_dist0(extensions.vector, extensions.vector) RETURNS float8 LANGUAGE sql IMMUTABLE AS 'SELECT 0::float8';
CREATE OPERATOR extensions.<=> (LEFTARG = extensions.vector, RIGHTARG = extensions.vector, FUNCTION = extensions.vector_dist0, COMMUTATOR = OPERATOR(extensions.<=>));
SQL

mkdir -p "$WORK/mig"
apply_migration() { # file -> 0/1
  local b; b=$(basename "$1")
  # Two edits to the real files: no CREATE EXTENSION vector, no hnsw indexes.
  perl -0pe 's/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"?vector"?\s*;/-- test: vector stubbed;/gi; s/CREATE\s+INDEX[^;]*?USING\s+hnsw[^;]*;/-- test: hnsw index removed;/gis' "$1" > "$WORK/mig/$b"
  if PGOPTIONS='-c client_min_messages=warning' psql_as postgres -v ON_ERROR_STOP=1 -f "$WORK/mig/$b" >"$WORK/mig/$b.log" 2>&1; then return 0; fi
  say "migration FAILED: $b"; tail -3 "$WORK/mig/$b.log"; return 1
}
before_ok=0; before_bad=0; after_ok=0; after_bad=0
for f in "$MIG"/*.sql; do
  [[ "$(basename "$f")" < "$LOCKDOWN" ]] || continue
  if apply_migration "$f"; then before_ok=$((before_ok+1)); else before_bad=$((before_bad+1)); fi
done
check setup-1 "migrations before the lockdown applied, none failed" "0" "$before_bad"

# ---------------------------------------------------------------- PostgREST
SECRET=$(openssl rand -hex 32)
start_pgrst() { # [schemas]
  PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PGPORT/vcon_lockdown" PGRST_DB_SCHEMAS="${1:-public}" PGRST_DB_ANON_ROLE=anon \
  PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_DB_MAX_ROWS=1000 PGRST_JWT_SECRET="$SECRET" PGRST_DB_POOL=4 \
  PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$RESTPORT" PGRST_ADMIN_SERVER_PORT="$ADMINPORT" \
    "$PGRST" >>"$WORK/pgrst.log" 2>&1 &
  PGRST_PID=$!
  for _ in $(seq 1 100); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$ADMINPORT/ready")" = 200 ] && return 0
    perl -e 'select(undef,undef,undef,0.1)'
  done
  say "PostgREST did not become ready"; tail -5 "$WORK/pgrst.log"; exit 1
}
stop_pgrst() { [ -n "$PGRST_PID" ] && kill "$PGRST_PID" 2>/dev/null; wait "$PGRST_PID" 2>/dev/null; PGRST_PID=""; }
restart_pgrst() { stop_pgrst; start_pgrst "${1:-public}"; }
start_pgrst

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # payload
  local h p s
  h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '%s' "$1" | b64url)
  s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}
EXP=$(( $(date +%s) + 7200 ))
T_SERVICE=$(jwt "{\"role\":\"service_role\",\"exp\":$EXP}")
T_SERVICE_A=$(jwt "{\"role\":\"service_role\",\"tenant_id\":\"A\",\"exp\":$EXP}")
T_ANONKEY=$(jwt "{\"role\":\"anon\",\"exp\":$EXP}")
T_A=$(jwt "{\"role\":\"authenticated\",\"tenant_id\":\"A\",\"exp\":$EXP}")

CODE=""; BODY=""
api() { # METHOD PATH TOKEN [JSON] [PROFILE]
  local m=$1 p=$2 t=$3 d=${4:-} prof=${5:-}
  local a=(-s -o "$WORK/body" -w '%{http_code}' -X "$m" "http://127.0.0.1:$RESTPORT$p" -H 'Content-Type: application/json')
  [ -n "$t" ] && a+=(-H "Authorization: Bearer $t")
  [ -n "$prof" ] && a+=(-H "Accept-Profile: $prof" -H "Content-Profile: $prof")
  [ -n "$d" ] && a+=(-d "$d")
  CODE=$(curl "${a[@]}"); BODY=$(cat "$WORK/body")
}

VA=aaaaaaaa-0000-4000-8000-000000000001
VB=bbbbbbbb-0000-4000-8000-000000000002
VB2=bbbbbbbb-0000-4000-8000-000000000003
VN=cccccccc-0000-4000-8000-000000000004
VW=eeeeeeee-0000-4000-8000-000000000005
labels() { # stdin -> which fixtures appear
  local s out=""; s=$(cat)
  case "$s" in *"$VA"*) out="$out A";; esac
  case "$s" in *"$VB"*) out="$out B";; esac
  case "$s" in *"$VB2"*) out="$out B2";; esac
  case "$s" in *"$VN"*) out="$out N";; esac
  echo "${out# }"
}
# 401/403 means PostgREST passed on the database's refusal; anything else is shown.
seen() { if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then echo denied; elif [ "$CODE" -lt 300 ]; then printf '%s' "$BODY" | labels; else echo "HTTP $CODE"; fi; }
status() { if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then echo denied; elif [ "$CODE" -lt 300 ]; then echo ok; else echo "HTTP $CODE"; fi; }

batch_json() { # uuid tenant-json-literal suffix
  jq -cn --arg u "$1" --argjson t "$2" --arg s "$3" '{
    p_vcons: [{id:$u, uuid:$u, vcon_version:"0.4.0", subject:("zebra subject " + $s), created_at:"2026-11-01T00:00:00Z", updated_at:"2026-11-01T00:00:00Z", redacted:{}, amended:{}, group_data:[], tenant_id:$t}],
    p_parties: [{vcon_id:$u, party_index:0, tenant_id:$t, name:("zebra caller " + $s), tel:"+15550100000"}],
    p_dialog: [{vcon_id:$u, dialog_index:0, tenant_id:$t, type:"text", start_time:"2026-11-01T00:00:00Z", parties:[0], body:("zebra dialog " + $s), encoding:"none"}],
    p_analysis: [{vcon_id:$u, analysis_index:0, tenant_id:$t, type:"summary", vendor:"test", body:("zebra analysis " + $s), encoding:"none"}],
    p_attachments: [
      {vcon_id:$u, attachment_index:0, tenant_id:$t, purpose:"tags", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, encoding:"json", body:"[\"team:sales\"]"}
    ]}'
}

head1 "fixtures"
for f in "$VA:\"A\":A" "$VB:\"B\":B" "$VB2:\"B\":B2" "$VN:null:N"; do
  IFS=: read -r u t s <<<"$f"
  api POST /rpc/save_vcon_batch "$T_SERVICE" "$(batch_json "$u" "$t" "$s")"
  [ "$CODE" -lt 300 ] || { say "fixture $s failed: $CODE $BODY"; exit 1; }
done
sql "REFRESH MATERIALIZED VIEW vcon_tags_mv" >/dev/null
say "$(sql "SELECT 'vcons by tenant: ' || string_agg(coalesce(tenant_id,'NULL') || ':' || n, ' ' ORDER BY tenant_id) FROM (SELECT tenant_id, count(*) n FROM vcons GROUP BY 1) x")"

TABLES="vcons parties dialog attachments analysis groups party_history vcon_embeddings embedding_queue s3_sync_tracking"
tables_seen() { # token -> union of tenant ids over all tables, or ERR<code>
  local tok=$1 t all=""
  for t in $TABLES; do
    api GET "/$t?select=tenant_id" "$tok"
    if [ "$CODE" = 200 ]; then all="$all $(printf '%s' "$BODY" | jq -r '.[] | .tenant_id // "NULL"' | tr '\n' ' ')"; else all="$all ERR$CODE"; fi
  done
  echo "$all" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | sed 's/ $//'
}
EXEC_Q='{"q":"select uuid, tenant_id, subject from vcons","params":{}}'
EXPLAIN_Q='{"q":"select * from vcons where tenant_id = '"'"'B'"'"'","run_analyze":true}'

anon_paths() { # stage who token want-rows want-call
  local st=$1 who=$2 tok=$3 rows=$4 call=$5
  api GET "/vcons_legacy?select=uuid" "$tok";      check "$st-legacy"  "$who GET /vcons_legacy"      "$rows" "$(seen)"
  api GET "/vcon_field_usage?select=uuid" "$tok";  check "$st-usage"   "$who GET /vcon_field_usage"  "$rows" "$(seen)"
  api GET "/vcon_tags_mv?select=vcon_id" "$tok";   check "$st-mv"      "$who GET /vcon_tags_mv"      "$rows" "$(seen)"
  api POST /rpc/exec_sql "$tok" "$EXEC_Q";         check "$st-exec"    "$who POST /rpc/exec_sql"     "$rows" "$(seen)"
  api POST /rpc/explain_query "$tok" "$EXPLAIN_Q"; check "$st-explain" "$who POST /rpc/explain_query (run_analyze on tenant B rows)" "$call" "$(status)"
}

# ---------------------------------------------------------------- 1. before
head1 "1. before the lockdown: anon reads every tenant's rows (leak expected)"
# What service_role and authenticated see now, to compare after the lockdown.
B_SVC_TABLES=$(tables_seen "$T_SERVICE")
B_AUTH_TABLES=$(tables_seen "$T_A")
api POST /rpc/search_vcons_keyword "$T_SERVICE_A" '{"query_text":"zebra"}';        B_SVC_KW=$(seen)
api POST /rpc/search_vcons_by_tags "$T_SERVICE" '{"tag_filter":{"team":"sales"}}'; B_SVC_TAGS=$(seen)
api POST /rpc/search_vcons_keyword "$T_A" '{"query_text":"zebra"}';                B_AUTH_KW=$(seen)
api POST /rpc/search_vcons_by_tags "$T_A" '{"tag_filter":{"team":"sales"}}';       B_AUTH_TAGS=$(seen)
check before-svc-tables "service_role, the 10 vCon tables" "A B NULL" "$B_SVC_TABLES"
check before-svc-kw "service_role + claim A, keyword RPC" "A N" "$B_SVC_KW"
check before-svc-tags "service_role, by_tags RPC" "A B B2 N" "$B_SVC_TAGS"
check before-auth-tables "authenticated claim A, the 10 vCon tables" "A NULL" "$B_AUTH_TABLES"
check before-auth-kw "authenticated claim A, keyword RPC" "A N" "$B_AUTH_KW"
check before-auth-tags "authenticated claim A, by_tags RPC" "A N" "$B_AUTH_TAGS"
anon_paths before "anon, no JWT" "" "A B B2 N" "ok"
api POST /rpc/set_tenant_context "" '{"p_tenant_id":"B"}'; check before-tenantctx "anon, no JWT POST /rpc/set_tenant_context" "ok" "$(status)"
check before-tables "anon, no JWT, the 10 vCon tables (RLS already returns nothing)" "" "$(tables_seen "")"

# ---------------------------------------------------------------- 2. after
head1 "2. lockdown and later migrations applied"
for f in "$MIG"/*.sql; do
  [[ "$(basename "$f")" < "$LOCKDOWN" ]] && continue
  if apply_migration "$f"; then after_ok=$((after_ok+1)); else after_bad=$((after_bad+1)); fi
done
check setup-2 "full chain applied ($((before_ok + after_ok)) files), none failed" "0" "$after_bad"
restart_pgrst

after_checks() { # stage
  local st=$1
  anon_paths "$st" "anon, no JWT" "" "denied" "denied"
  anon_paths "$st-key" "anon key JWT" "$T_ANONKEY" "denied" "denied"
  api POST /rpc/set_tenant_context "" '{"p_tenant_id":"B"}';  check "$st-tenantctx" "anon POST /rpc/set_tenant_context" "denied" "$(status)"
  api POST /rpc/clear_tenant_context "" '{}';                 check "$st-cleartx"   "anon POST /rpc/clear_tenant_context" "denied" "$(status)"
  api POST /rpc/get_storage_efficiency "" '{}';               check "$st-stats"     "anon POST /rpc/get_storage_efficiency" "denied" "$(status)"
  api POST /rpc/search_vcons_keyword "" '{"query_text":"zebra"}'; check "$st-kw"    "anon POST /rpc/search_vcons_keyword" "denied" "$(status)"
  check "$st-tables" "anon, the 10 vCon tables" "ERR401" "$(tables_seen "")"
}
after_checks after

# service_role: what the server does with the service role key.
check svc-tables "service_role, the 10 vCon tables, same as before" "$B_SVC_TABLES" "$(tables_seen "$T_SERVICE")"
api GET "/vcons_legacy?select=uuid" "$T_SERVICE";      check svc-legacy "service_role GET /vcons_legacy" "A B B2 N" "$(seen)"
api GET "/vcon_field_usage?select=uuid" "$T_SERVICE";  check svc-usage  "service_role GET /vcon_field_usage" "A B B2 N" "$(seen)"
api GET "/vcon_tags_mv?select=vcon_id" "$T_SERVICE";   check svc-mv     "service_role GET /vcon_tags_mv" "A B B2 N" "$(seen)"
api POST /rpc/exec_sql "$T_SERVICE" "$EXEC_Q";         check svc-exec   "service_role POST /rpc/exec_sql" "A B B2 N" "$(seen)"
api POST /rpc/explain_query "$T_SERVICE" "$EXPLAIN_Q"; check svc-explain "service_role POST /rpc/explain_query returns a plan with row counts" "ok" "$([ "$CODE" = 200 ] && printf '%s' "$BODY" | grep -q 'rows=' && echo ok || echo "HTTP $CODE")"
for fn in get_performance_metrics get_storage_efficiency get_index_health get_connection_metrics; do
  api POST "/rpc/$fn" "$T_SERVICE" '{}'; check "svc-$fn" "service_role POST /rpc/$fn" "ok" "$(status)"
done
api POST /rpc/refresh_vcon_tags_mv_if_stale "$T_SERVICE" '{}';       check svc-refresh   "service_role POST /rpc/refresh_vcon_tags_mv_if_stale" "ok" "$(status)"
api POST /rpc/search_vcons_keyword "$T_SERVICE_A" '{"query_text":"zebra"}'; check svc-kw "service_role + claim A, keyword RPC, same as before" "$B_SVC_KW" "$(seen)"
api POST /rpc/search_vcons_by_tags "$T_SERVICE" '{"tag_filter":{"team":"sales"}}'; check svc-tags "service_role, by_tags RPC (reads vcon_tags_mv), same as before" "$B_SVC_TAGS" "$(seen)"
api POST /rpc/save_vcon_batch "$T_SERVICE" "$(batch_json "$VW" '"A"' W)"; check svc-write "service_role POST /rpc/save_vcon_batch" "ok" "$(status)"
# Last, then a fresh pool: the session tenant outlives the request on its connection.
api POST /rpc/set_tenant_context "$T_SERVICE" '{"p_tenant_id":"A"}'; check svc-tenantctx "service_role POST /rpc/set_tenant_context" "ok" "$(status)"
api POST /rpc/clear_tenant_context "$T_SERVICE" '{}';                check svc-cleartx   "service_role POST /rpc/clear_tenant_context" "ok" "$(status)"
restart_pgrst

# authenticated: tenant policies untouched; only the definer helpers close.
check auth-tables "authenticated claim A, the 10 vCon tables, same as before" "$B_AUTH_TABLES" "$(tables_seen "$T_A")"
api GET "/vcons_legacy?select=uuid" "$T_A";       check auth-legacy "authenticated claim A GET /vcons_legacy now follows RLS" "A N" "$(seen)"
api GET "/vcon_field_usage?select=uuid" "$T_A";   check auth-usage  "authenticated claim A GET /vcon_field_usage now follows RLS" "A N" "$(seen)"
api GET "/vcon_tags_mv?select=vcon_id" "$T_A";    check auth-mv     "authenticated claim A GET /vcon_tags_mv still reads every tenant (closed in a later tier)" "A B B2 N" "$(seen)"
api POST /rpc/exec_sql "$T_A" "$EXEC_Q";          check auth-exec   "authenticated POST /rpc/exec_sql" "denied" "$(seen)"
api POST /rpc/explain_query "$T_A" "$EXPLAIN_Q";  check auth-explain "authenticated POST /rpc/explain_query" "denied" "$(status)"
api POST /rpc/set_tenant_context "$T_A" '{"p_tenant_id":"B"}'; check auth-tenantctx "authenticated POST /rpc/set_tenant_context" "denied" "$(status)"
api POST /rpc/search_vcons_keyword "$T_A" '{"query_text":"zebra"}'; check auth-kw "authenticated claim A, keyword RPC, same as before" "$B_AUTH_KW" "$(seen)"
api POST /rpc/search_vcons_by_tags "$T_A" '{"tag_filter":{"team":"sales"}}'; check auth-tags "authenticated claim A, by_tags RPC, same as before" "$B_AUTH_TAGS" "$(seen)"

# ---------------------------------------------------------------- 3. idempotent
head1 "3. lockdown applied a second time"
check rerun "lockdown re-applied without error" "ok" "$(apply_migration "$MIG/$LOCKDOWN" >/dev/null && echo ok || echo failed)"
restart_pgrst
after_checks rerun
api POST /rpc/exec_sql "$T_SERVICE" "$EXEC_Q"
got=$(seen); case "$BODY" in *"$VW"*) got="$got W";; esac
check rerun-svc-exec "service_role POST /rpc/exec_sql, including the vCon written after the lockdown" "A B B2 N W" "$got"

# ---------------------------------------------------------------- 4. catalog test
head1 "4. supabase/tests/anon_lockdown.sql"
check sqltest "catalog and SET ROLE checks pass" "ok" "$(psql_as postgres -v ON_ERROR_STOP=1 -f "$SQLTEST" >"$WORK/sqltest.log" 2>&1 && echo ok || { tail -2 "$WORK/sqltest.log"; echo failed; })"
sql "CREATE TABLE public.later_table (id int); CREATE FUNCTION public.later_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';" >/dev/null
check later-table "a table created after the lockdown gives anon nothing" "f" "$(sql "SELECT has_table_privilege('anon', 'public.later_table', 'SELECT')")"
check later-fn "a function created after the lockdown is anon-executable through PUBLIC (known gap)" "t" "$(sql "SELECT has_function_privilege('anon', 'public.later_fn()', 'EXECUTE')")"
check sqltest-guard "anon_lockdown.sql catches that function" "failed" "$(psql_as postgres -v ON_ERROR_STOP=1 -f "$SQLTEST" >/dev/null 2>&1 && echo passed || echo failed)"
sql "DROP FUNCTION public.later_fn(); DROP TABLE public.later_table;" >/dev/null

# ---------------------------------------------------------------- 5. bootstrap
head1 "5. bootstrap-schema.sh clone"
if PATH="$PGBIN:$PATH" bash "$ROOT/scripts/bootstrap-schema.sh" "$GROUP_SCHEMA" --db-url "postgresql://postgres@127.0.0.1:$PGPORT/vcon_lockdown" --apply >"$WORK/bootstrap.log" 2>&1; then
  check boot-apply "bootstrap-schema.sh --apply" "ok" "ok"
  sql "INSERT INTO $GROUP_SCHEMA.vcons (id, uuid, subject, tenant_id) VALUES ('$VA', '$VA', 'zebra group', NULL)" >/dev/null
  check boot-usage "anon has no USAGE on the cloned schema" "f" "$(sql "SELECT has_schema_privilege('anon', '$GROUP_SCHEMA', 'USAGE')")"
  check boot-anyrel "anon holds no privilege on any cloned relation" "0" "$(sql "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='$GROUP_SCHEMA' AND c.relkind IN ('r','p','v','m') AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')")"
  restart_pgrst "public,$GROUP_SCHEMA"
  api POST /rpc/exec_sql "" "{\"q\":\"select uuid from $GROUP_SCHEMA.vcons\",\"params\":{}}" "$GROUP_SCHEMA"; check boot-anon-exec "anon POST /rpc/exec_sql in the cloned schema" "denied" "$(seen)"
  api GET "/vcon_tags_mv?select=vcon_id" "" "" "$GROUP_SCHEMA";  check boot-anon-mv "anon GET /vcon_tags_mv in the cloned schema" "denied" "$(seen)"
  api GET "/vcons?select=uuid" "" "" "$GROUP_SCHEMA";            check boot-anon-vcons "anon GET /vcons in the cloned schema" "denied" "$(seen)"
  api POST /rpc/exec_sql "$T_A" "{\"q\":\"select uuid from $GROUP_SCHEMA.vcons\",\"params\":{}}" "$GROUP_SCHEMA"; check boot-auth-exec "authenticated POST /rpc/exec_sql in the cloned schema" "denied" "$(seen)"
  api GET "/vcons?select=uuid" "$T_SERVICE" "" "$GROUP_SCHEMA";  check boot-svc-vcons "service_role GET /vcons in the cloned schema" "A" "$(seen)"
  api POST /rpc/exec_sql "$T_SERVICE" "{\"q\":\"select uuid from $GROUP_SCHEMA.vcons\",\"params\":{}}" "$GROUP_SCHEMA"; check boot-svc-exec "service_role POST /rpc/exec_sql in the cloned schema" "A" "$(seen)"
else
  check boot-apply "bootstrap-schema.sh --apply" "ok" "failed: $(tail -2 "$WORK/bootstrap.log" | tr '\n' ' ')"
fi

head1 "summary"
say "passed: $NPASS  failed: $NFAIL"
[ "$NFAIL" -eq 0 ]
