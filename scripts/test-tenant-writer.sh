#!/usr/bin/env bash
# test-tenant-writer.sh: prove migrations 20261112120000_keep_stored_tenant.sql
# and 20261112120100_fix_tenant_backfill.sql against a real Postgres.
#
# Builds a throwaway Postgres cluster with Supabase-shaped roles, applies the
# real migration chain from this checkout, and writes vCons through
# save_vcon_batch as service_role, the way the server does.
#
#   1. Chain up to the two migrations: a re-post moves a stored tenant (w3 to
#      NULL, w4 to another tenant), backfill_tenant_id_batch fails on
#      s3_sync_tracking, and the old vcons backfill skips a purpose-only stamp
#      and aborts on a non-JSON body (the checks predict each bug).
#   2. Both migrations applied: w3 and w4 keep the stored tenant, children
#      included; NULL still takes a stamp; _quarantine stays until
#      release_vcon_from_quarantine() moves it, with its log row; the backfills
#      run on every table and apply the stamp rule.
#   3. Both migrations applied a second time: same results (idempotent).
#   4. supabase/tests/anon_lockdown.sql still passes.
#
# Nothing outside a temporary directory is touched. The cluster is stopped and
# deleted on exit.
#
# Usage:   scripts/test-tenant-writer.sh          (KEEP=1 leaves the cluster running)
# Needs:   PostgreSQL 15+ server binaries (initdb, pg_ctl, psql), jq, perl.
# Env:     PGBIN, PGPORT (54994)
# Output:  one line per check, "PASS <id> ..." or "FAIL <id> ...".
#          tests/db/tenant-writer-sql.test.ts reads these lines.
# Exit:    0 when every check passes, 1 otherwise, 2 when it cannot run.
#
# Fixtures are synthetic: generic tenant ids, example.invalid-style values,
# no phone numbers. They carry no lawful_basis attachment, on purpose: no basis
# is invented for a fake call.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MIG=$ROOT/supabase/migrations
FIRST=20261112120000_keep_stored_tenant.sql
SECOND=20261112120100_fix_tenant_backfill.sql
SQLTEST=$ROOT/supabase/tests/anon_lockdown.sql
PGPORT=${PGPORT:-54994}

die() { echo "test-tenant-writer: $*" >&2; exit 2; }

[ -f "$MIG/$FIRST" ] && [ -f "$MIG/$SECOND" ] || die "missing $FIRST or $SECOND"
for t in jq perl; do command -v "$t" >/dev/null 2>&1 || die "needs $t"; done

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
[ "$(pg_major "$PGBIN")" -ge 15 ] || die "$PGBIN is PostgreSQL $(pg_major "$PGBIN"); the chain needs 15+"

if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"$PGPORT" -sTCP:LISTEN >/dev/null 2>&1 && die "port $PGPORT in use"
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/tenant-writer.XXXXXX")
DATA=$WORK/pgdata
cleanup() {
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
psql_as() { local u=$1; shift; "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U "$u" -d vcon_tenant "$@"; }
sql()  { psql_as postgres -At -F'|' -v ON_ERROR_STOP=1 -c "$1"; }
# Runs SQL as a role; prints the result, or ERR<sqlstate> when it fails.
as_role() { # role sql
  local out
  out=$(psql_as postgres -At -F'|' -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
          -c "SET ROLE $1" -c "$2" 2>&1) && { printf '%s' "$out"; return; }
  printf 'ERR%s' "$(printf '%s' "$out" | grep -oE '[0-9A-Z]{5}' | tail -1)"
}

# ---------------------------------------------------------------- cluster
head1 "setup"
say "repo: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')  postgres: $("$PGBIN/postgres" --version)"
"$PGBIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C >/dev/null || exit 2
"$PGBIN/pg_ctl" -D "$DATA" -w -l "$WORK/pg.log" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null || exit 2

"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL' || exit 2
-- The role attributes a Supabase stack has.
CREATE ROLE postgres LOGIN CREATEROLE CREATEDB BYPASSRLS;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;
CREATE DATABASE vcon_tenant OWNER postgres;
SQL
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -X -q -U supabase_admin -d vcon_tenant -v ON_ERROR_STOP=1 2>/dev/null <<'SQL' || exit 2
ALTER SCHEMA public OWNER TO postgres;
CREATE SCHEMA extensions AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
ALTER ROLE postgres IN DATABASE vcon_tenant SET search_path = "$user", public, extensions;
ALTER ROLE service_role IN DATABASE vcon_tenant SET search_path = public, extensions;
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
-- pgvector stand-in with text I/O, so the chain applies unchanged without the
-- extension. Distance is always 0.
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
before_bad=0
for f in "$MIG"/*.sql; do
  [[ "$(basename "$f")" < "$FIRST" ]] || continue
  apply_migration "$f" || before_bad=$((before_bad+1))
done
check setup-1 "migrations before $FIRST applied, none failed" "0" "$before_bad"

# ---------------------------------------------------------------- fixtures
TA=t-aaaaaaaaaaaaaaaa
TB=t-bbbbbbbbbbbbbbbb
TQ=_quarantine

# save <uuid> <tenant json literal> <suffix> [extra attachments json array]
# One vCon through save_vcon_batch as service_role, rows shaped like the
# batch writer's (src/db/batch-writer.ts): every child stamped with the
# vCon's tenant, a tags attachment at index 0.
save() {
  local u=$1 t=$2 s=$3 extra=${4:-[]} payload
  payload=$(jq -cn --arg u "$u" --argjson t "$t" --arg s "$s" --argjson extra "$extra" '{
    v: [{id:$u, uuid:$u, vcon_version:"0.4.0", subject:("subject " + $s), created_at:"2026-11-01T00:00:00Z", updated_at:"2026-11-01T00:00:00Z", redacted:{}, amended:{}, group_data:[], tenant_id:$t}],
    p: [{vcon_id:$u, party_index:0, tenant_id:$t, name:("caller " + $s), mailto:"caller@example.invalid"}],
    d: [{vcon_id:$u, dialog_index:0, tenant_id:$t, type:"text", start_time:"2026-11-01T00:00:00Z", parties:[0], body:("dialog " + $s), encoding:"none"}],
    an: [{vcon_id:$u, analysis_index:0, tenant_id:$t, type:"summary", vendor:"test", body:("analysis " + $s), encoding:"none"}],
    at: ([{vcon_id:$u, attachment_index:0, tenant_id:$t, purpose:"tags", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, encoding:"json", body:"[\"team:sales\"]"}]
         + [$extra | to_entries[] | .value + {vcon_id:$u, attachment_index:(.key + 1), tenant_id:$t}])
  }')
  local out
  out=$(as_role service_role "SELECT save_vcon_batch(p->'v', p->'p', p->'d', p->'an', p->'at') FROM (SELECT '$payload'::jsonb AS p) x")
  case "$out" in ERR*) echo "fixture $s FAILED: $out" >&2;; esac
  printf '%s' "$out"
}
# Tenant of the vCon and of each child table, e.g. "vcons=A parties=A ...".
tenants_of() { # uuid
  sql "SELECT string_agg(t || '=' || coalesce(x, 'NULL'), ' ' ORDER BY o) FROM (
         SELECT 1 o, 'vcons' t, (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM vcons WHERE id = '$1') x
   UNION SELECT 2, 'parties', (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM parties WHERE vcon_id = '$1')
   UNION SELECT 3, 'dialog', (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM dialog WHERE vcon_id = '$1')
   UNION SELECT 4, 'analysis', (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM analysis WHERE vcon_id = '$1')
   UNION SELECT 5, 'attachments', (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM attachments WHERE vcon_id = '$1')
   UNION SELECT 6, 'embedding_queue', (SELECT string_agg(DISTINCT coalesce(tenant_id,'NULL'), ',') FROM embedding_queue WHERE vcon_id = '$1')
  ) z" | sed "s/$TA/A/g; s/$TB/B/g"
}
all_of() { # tenant label -> the tenants_of line where every table holds it
  echo "vcons=$1 parties=$1 dialog=$1 analysis=$1 attachments=$1 embedding_queue=$1"
}
subject_of() { sql "SELECT subject FROM vcons WHERE id = '$1'"; }

uuid_n() { printf '00000000-0000-4000-8000-%012d' "$1"; }

# Tenant attachments in the shapes the writer rule names, as attachments rows
# (column names: start_time, mimetype). The batch writer stores an object body
# as its JSON text, and a JSON-string body as it came, so both reach the table
# as the same text.
stamp_obj()  { jq -cn --arg id "$1" '{purpose:"tenant", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, mimetype:"application/json", encoding:"json", body:({id:$id} | tojson)}'; }
stamp_type() { jq -cn --arg id "$1" '{type:"tenant", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, encoding:"json", body:({id:$id} | tojson)}'; }
stamp_raw()  { jq -cn --arg b "$1" '{purpose:"tenant", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, encoding:"json", body:$b}'; }
stamp_num()  { jq -cn '{type:"tenant", start_time:"2026-11-01T00:00:00Z", party:0, dialog:0, encoding:"json", body:"{\"id\":42}"}'; }

# ---------------------------------------------------------------- 1. before
head1 "1. before: a re-post moves a stored tenant, the backfills fail (bugs expected)"
V3=$(uuid_n 3); V4=$(uuid_n 4)
save "$V3" "\"$TA\"" w3 >/dev/null; save "$V3" null w3-repost >/dev/null
check before-w3 "service_role re-post with no tenant moves an A vCon and its children" "$(all_of NULL)" "$(tenants_of "$V3")"
save "$V4" "\"$TA\"" w4 >/dev/null; save "$V4" "\"$TB\"" w4-repost >/dev/null
check before-w4 "service_role re-post stamped B moves an A vCon and its children" "$(all_of B)" "$(tenants_of "$V4")"
sql "INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key) VALUES ('$V4', '$V4', 'k')" >/dev/null
check before-s3 "backfill_tenant_id_batch('s3_sync_tracking') fails: no id column" "ERR42703" \
  "$(as_role service_role "SELECT backfill_tenant_id_batch('s3_sync_tracking', 10)")"
VP0=$(uuid_n 10); VX0=$(uuid_n 11)
save "$VP0" null old-purpose "[$(stamp_obj $TA)]" >/dev/null
save "$VX0" null old-notjson "[$(stamp_type x)]" >/dev/null
sql "UPDATE attachments SET body = 'not json' WHERE vcon_id = '$VX0' AND type = 'tenant'" >/dev/null
OLD=20251202180000_backfill_tenant_ids.sql
check before-old-abort "re-running $OLD aborts on one non-JSON tenant body" "1" \
  "$(apply_migration "$MIG/$OLD" >/dev/null; echo $?)"
sql "DELETE FROM attachments WHERE vcon_id = '$VX0' AND type = 'tenant'" >/dev/null
apply_migration "$MIG/$OLD" >/dev/null
check before-old-purpose "re-running $OLD skips a purpose-only stamp" "NULL" \
  "$(sql "SELECT coalesce(tenant_id, 'NULL') FROM vcons WHERE id = '$VP0'")"
sql "DELETE FROM vcons" >/dev/null

# ---------------------------------------------------------------- 2. after
apply_both() {
  local bad=0
  apply_migration "$MIG/$FIRST" || bad=$((bad+1))
  apply_migration "$MIG/$SECOND" || bad=$((bad+1))
  for f in "$MIG"/*.sql; do   # anything newer than the two
    [[ "$(basename "$f")" > "$SECOND" ]] || continue
    apply_migration "$f" || bad=$((bad+1))
  done
  echo "$bad"
}

after_checks() { # stage
  local st=$1 n=$2
  sql "DELETE FROM vcons" >/dev/null
  local v3 v4 vn vq vnq
  v3=$(uuid_n $((n+3))); v4=$(uuid_n $((n+4))); vn=$(uuid_n $((n+5))); vq=$(uuid_n $((n+6))); vnq=$(uuid_n $((n+7)))

  save "$v3" "\"$TA\"" w3 >/dev/null; save "$v3" null w3-repost >/dev/null
  check "$st-w3" "service_role re-post with no tenant keeps the A vCon and its children" "$(all_of A)" "$(tenants_of "$v3")"
  check "$st-w3-content" "the re-post's content is still written" "subject w3-repost" "$(subject_of "$v3")"

  save "$v4" "\"$TA\"" w4 >/dev/null; save "$v4" "\"$TB\"" w4-repost >/dev/null
  check "$st-w4" "service_role re-post stamped B keeps the A vCon and its children" "$(all_of A)" "$(tenants_of "$v4")"
  check "$st-w4-content" "the re-post's content is still written" "subject w4-repost" "$(subject_of "$v4")"

  save "$vn" null unstamped >/dev/null; save "$vn" "\"$TA\"" stamped >/dev/null
  check "$st-null" "a NULL vCon re-posted stamped A takes A (repair kept)" "$(all_of A)" "$(tenants_of "$vn")"

  save "$vq" "\"$TQ\"" quarantined >/dev/null; save "$vq" "\"$TA\"" quarantined-repost >/dev/null
  check "$st-quarantine-kept" "a _quarantine vCon re-posted stamped A stays in _quarantine" "$(all_of $TQ)" "$(tenants_of "$vq")"

  save "$vnq" null new >/dev/null; save "$vnq" "\"$TQ\"" new-quarantine >/dev/null
  check "$st-null-to-quarantine" "a NULL vCon re-posted under _quarantine goes there" "$(all_of $TQ)" "$(tenants_of "$vnq")"
}

head1 "2. both migrations applied"
check setup-2 "$FIRST, $SECOND and any later migrations applied, none failed" "0" "$(apply_both)"
after_checks after 100

head1 "2a. release_vcon_from_quarantine"
VR=$(uuid_n 200)
save "$VR" "\"$TQ\"" release >/dev/null
sql "INSERT INTO groups (vcon_id, group_index, uuid, encoding) VALUES ('$VR', 0, '$(uuid_n 201)', 'json');
     INSERT INTO party_history (dialog_id, party_index, time, event) SELECT id, 0, now(), 'join' FROM dialog WHERE vcon_id = '$VR';
     INSERT INTO vcon_embeddings (vcon_id, content_type, content_reference, content_text, embedding) VALUES ('$VR', 'subject', '0', 'x', '[0]');
     INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key) VALUES ('$VR', '$VR', 'k');" >/dev/null
as_role service_role "SELECT refresh_vcon_tags_mv_if_stale()" >/dev/null
check mv-before "vcon_tags_mv holds the quarantined vCon under _quarantine" "$TQ" \
  "$(sql "SELECT tenant_id FROM vcon_tags_mv WHERE vcon_id = '$VR'")"

EVID='{"inventory_snapshot":"rev-1","checked_at":"2026-11-12T00:00:00Z"}'
call_release() { # uuid tenant reason evidence by [role]
  as_role "${6:-service_role}" "SELECT release_vcon_from_quarantine('$1', $2, $3, $4, $5)"
}
check rel-bad-tenant "a tenant id that is not t- and 16 lowercase hex is refused" "ERR22023" "$(call_release "$VR" "'T-AAAAAAAAAAAAAAAA'" "'r'" "'$EVID'" "'ops'")"
check rel-quarantine-target "_quarantine as the target is refused" "ERR22023" "$(call_release "$VR" "'$TQ'" "'r'" "'$EVID'" "'ops'")"
check rel-no-reason "an empty reason is refused" "ERR22023" "$(call_release "$VR" "'$TA'" "'  '" "'$EVID'" "'ops'")"
check rel-empty-evidence "empty evidence is refused" "ERR22023" "$(call_release "$VR" "'$TA'" "'r'" "'{}'" "'ops'")"
check rel-array-evidence "evidence that is not an object is refused" "ERR22023" "$(call_release "$VR" "'$TA'" "'r'" "'[1]'" "'ops'")"
check rel-no-by "an empty released_by is refused" "ERR22023" "$(call_release "$VR" "'$TA'" "'r'" "'$EVID'" "''")"
check rel-missing "an unknown vCon is refused" "ERRP0002" "$(call_release "$(uuid_n 299)" "'$TA'" "'r'" "'$EVID'" "'ops'")"
check rel-anon "anon cannot run it" "ERR42501" "$(call_release "$VR" "'$TA'" "'r'" "'$EVID'" "'ops'" anon)"
check rel-auth "authenticated cannot run it" "ERR42501" "$(call_release "$VR" "'$TA'" "'r'" "'$EVID'" "'ops'" authenticated)"
check rel-untouched "nothing moved after the refusals" "$(all_of $TQ)" "$(tenants_of "$VR")"
check rel-ok "service_role releases it to A with a reason and evidence" "1" \
  "$(call_release "$VR" "'$TA'" "'number in tenant inventory at call time'" "'$EVID'" "'ops-staff-1'")"
check rel-moved "the vCon and its children moved to A" "$(all_of A)" "$(tenants_of "$VR")"
check rel-other-children "groups, party_history, vcon_embeddings, s3_sync_tracking moved to A" "A A A A" \
  "$(sql "SELECT concat_ws(' ', (SELECT tenant_id FROM groups WHERE vcon_id='$VR'), (SELECT ph.tenant_id FROM party_history ph JOIN dialog d ON d.id = ph.dialog_id WHERE d.vcon_id='$VR'), (SELECT tenant_id FROM vcon_embeddings WHERE vcon_id='$VR'), (SELECT tenant_id FROM s3_sync_tracking WHERE vcon_id='$VR'))" | sed "s/$TA/A/g")"
check rel-log "the log row records from, to, reason, evidence and who" \
  "$TQ|$TA|number in tenant inventory at call time|rev-1|ops-staff-1" \
  "$(sql "SELECT from_tenant, to_tenant, reason, evidence->>'inventory_snapshot', released_by FROM tenant_quarantine_releases WHERE vcon_uuid = '$VR'")"
check rel-again "a released vCon cannot be released again" "ERR55000" "$(call_release "$VR" "'$TB'" "'r'" "'$EVID'" "'ops'")"
check rel-repost "a re-post stamped B after release keeps A" "$(all_of A)" \
  "$(save "$VR" "\"$TB\"" release-repost >/dev/null; tenants_of "$VR")"
check mv-refresh "refresh_vcon_tags_mv_if_stale sees the move" "t" "$(as_role service_role "SELECT refresh_vcon_tags_mv_if_stale()")"
check mv-after "vcon_tags_mv holds the released vCon under A" "$TA" \
  "$(sql "SELECT tenant_id FROM vcon_tags_mv WHERE vcon_id = '$VR'")"
check log-update "the log refuses UPDATE, even for postgres" "ERR42501" "$(as_role postgres "UPDATE tenant_quarantine_releases SET reason = 'x'")"
check log-delete "the log refuses DELETE, even for postgres" "ERR42501" "$(as_role postgres "DELETE FROM tenant_quarantine_releases")"
check log-truncate "the log refuses TRUNCATE, even for postgres" "ERR42501" "$(as_role postgres "TRUNCATE tenant_quarantine_releases")"
check log-svc-read "service_role reads the log" "1" "$(as_role service_role "SELECT count(*) FROM tenant_quarantine_releases")"
check log-auth-read "authenticated cannot read the log" "ERR42501" "$(as_role authenticated "SELECT count(*) FROM tenant_quarantine_releases")"
check log-anon-read "anon cannot read the log" "ERR42501" "$(as_role anon "SELECT count(*) FROM tenant_quarantine_releases")"
check log-survives "the log row outlives the vCon" "1" \
  "$(sql "DELETE FROM vcons WHERE id = '$VR'" >/dev/null; sql "SELECT count(*) FROM tenant_quarantine_releases WHERE vcon_uuid = '$VR'")"

head1 "2b. backfill_tenant_id_batch on every table"
VS=$(uuid_n 300)
save "$VS" "\"$TA\"" backfill >/dev/null
sql "INSERT INTO groups (vcon_id, group_index, uuid, encoding) VALUES ('$VS', 0, '$(uuid_n 301)', 'json');
     INSERT INTO party_history (dialog_id, party_index, time, event) SELECT id, 0, now(), 'join' FROM dialog WHERE vcon_id = '$VS';
     INSERT INTO vcon_embeddings (vcon_id, content_type, content_reference, content_text, embedding) VALUES ('$VS', 'subject', '0', 'x', '[0]');
     INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key) VALUES ('$VS', '$VS', 'k');" >/dev/null
for t in parties dialog attachments analysis groups vcon_embeddings embedding_queue s3_sync_tracking; do
  sql "ALTER TABLE $t DISABLE TRIGGER USER; UPDATE $t SET tenant_id = NULL WHERE vcon_id = '$VS'; ALTER TABLE $t ENABLE TRIGGER USER;" >/dev/null
done
sql "ALTER TABLE party_history DISABLE TRIGGER USER; UPDATE party_history SET tenant_id = NULL; ALTER TABLE party_history ENABLE TRIGGER USER;" >/dev/null
for t in parties dialog attachments analysis groups party_history vcon_embeddings embedding_queue s3_sync_tracking; do
  check "bf-$t" "backfill_tenant_id_batch('$t') repairs a stale child" "1" \
    "$(as_role service_role "SELECT backfill_tenant_id_batch('$t', 10)")"
done
check bf-done "every child back on A" "$(all_of A)" "$(tenants_of "$VS")"
check bf-s3-row "s3_sync_tracking row back on A" "A" "$(sql "SELECT tenant_id FROM s3_sync_tracking WHERE vcon_id = '$VS'" | sed "s/$TA/A/g")"
check bf-anon "anon cannot run backfill_tenant_id_batch" "ERR42501" "$(as_role anon "SELECT backfill_tenant_id_batch('parties', 10)")"
check bf-auth "authenticated cannot run backfill_tenant_id_batch" "ERR42501" "$(as_role authenticated "SELECT backfill_tenant_id_batch('parties', 10)")"

head1 "2c. backfill_vcon_tenant_ids"
sql "DELETE FROM vcons" >/dev/null
fixtures() { # base -> one vCon per stamp shape, all with tenant_id NULL
  local b=$1
  save "$(uuid_n $((b+1)))" null purpose "[$(stamp_obj $TA)]" >/dev/null           # 0.4.0 form
  save "$(uuid_n $((b+2)))" null type "[$(stamp_type $TB)]" >/dev/null              # legacy type
  save "$(uuid_n $((b+3)))" null notjson "[$(stamp_raw 'not json')]" >/dev/null     # unreadable
  save "$(uuid_n $((b+4)))" null conflict "[$(stamp_obj $TA),$(stamp_type $TB)]" >/dev/null
  save "$(uuid_n $((b+5)))" null twice "[$(stamp_obj $TA),$(stamp_type $TA)]" >/dev/null
  save "$(uuid_n $((b+6)))" null legacy-id "[$(stamp_type 42)]" >/dev/null        # not t-<16 hex>
  save "$(uuid_n $((b+7)))" null number "[$(stamp_num)]" >/dev/null
  save "$(uuid_n $((b+8)))" null none >/dev/null                                    # no stamp
  save "$(uuid_n $((b+9)))" null reserved "[$(stamp_obj $TQ)]" >/dev/null
  save "$(uuid_n $((b+10)))" null upper "[$(stamp_obj T-AAAAAAAAAAAAAAAA)]" >/dev/null
  save "$(uuid_n $((b+11)))" "\"$TB\"" stored "[$(stamp_obj $TA)]" >/dev/null       # already stamped B
}
results() { # base -> tenant per fixture, in order
  local b=$1 i out=""
  for i in 1 2 3 4 5 6 7 8 9 10 11; do
    out="$out $(sql "SELECT coalesce(tenant_id, 'NULL') FROM vcons WHERE id = '$(uuid_n $((b+i)))'")"
  done
  echo "${out# }" | sed "s/$TA/A/g; s/$TB/B/g"
}
drain() { # writer_rule -> total rows set, in batches of 2
  local total=0 n
  while :; do
    n=$(as_role service_role "SELECT backfill_vcon_tenant_ids(2, $1)")
    case "$n" in ''|*[!0-9]*) echo "ERR $n"; return;; esac
    [ "$n" = 0 ] && break
    total=$((total+n))
  done
  echo "$total"
}
fixtures 400
check bvt-loose-count "non-strict: sets only vCons whose stamp resolves, in batches, to completion" "6" "$(drain false)"
check bvt-loose "non-strict: purpose, type, twice, legacy id, number, upper case set; unreadable, conflict, none, reserved, stored left" \
  "A B NULL NULL A 42 42 NULL NULL T-AAAAAAAAAAAAAAAA B" "$(results 400)"
check bvt-loose-children "children follow a backfilled vCon" "$(all_of A)" "$(tenants_of "$(uuid_n 401)")"
sql "DELETE FROM vcons" >/dev/null
fixtures 500
check bvt-strict-count "writer rule: every NULL vCon set" "10" "$(drain true)"
check bvt-strict "writer rule: valid stamps set, everything else _quarantine, stored B kept" \
  "A B $TQ $TQ A $TQ $TQ $TQ $TQ $TQ B" "$(results 500)"
check bvt-stamp "vcon_tenant_stamp(strict) agrees on the conflict fixture" "" \
  "$(as_role service_role "SELECT vcon_tenant_stamp('$(uuid_n 504)', true)")"
check bvt-anon "anon cannot run backfill_vcon_tenant_ids" "ERR42501" "$(as_role anon "SELECT backfill_vcon_tenant_ids(1, true)")"
check bvt-auth "authenticated cannot run vcon_tenant_stamp" "ERR42501" "$(as_role authenticated "SELECT vcon_tenant_stamp('$(uuid_n 501)', true)")"
check bvt-batch "a batch size below 1 is refused" "ERR22023" "$(as_role service_role "SELECT backfill_vcon_tenant_ids(0, true)")"

check auth-save "authenticated keeps EXECUTE on save_vcon_batch" "t" \
  "$(sql "SELECT has_function_privilege('authenticated', 'save_vcon_batch(jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')")"
check anon-save "anon has no EXECUTE on save_vcon_batch" "f" \
  "$(sql "SELECT has_function_privilege('anon', 'save_vcon_batch(jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')")"

# ---------------------------------------------------------------- 3. idempotent
head1 "3. both migrations applied a second time"
check setup-3 "re-applied without error" "0" "$(apply_both)"
after_checks rerun 600

# ---------------------------------------------------------------- 4. catalog test
head1 "4. supabase/tests/anon_lockdown.sql"
check sqltest "anon_lockdown catalog and SET ROLE checks pass" "ok" \
  "$(psql_as postgres -v ON_ERROR_STOP=1 -f "$SQLTEST" >"$WORK/sqltest.log" 2>&1 && echo ok || { tail -2 "$WORK/sqltest.log"; echo failed; })"

head1 "summary"
say "passed: $NPASS  failed: $NFAIL"
[ "$NFAIL" -eq 0 ]
