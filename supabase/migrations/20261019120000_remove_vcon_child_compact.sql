-- CON-1243: atomic remove-and-renumber for analysis and attachments.
--
-- draft-ietf-vcon-vcon-core-02 §4.1.8: removing an analysis or attachment
-- hard-deletes it and shifts every later index down by one. The service used to
-- do this from the client as SELECT, DELETE the trailing range, then re-INSERT
-- the shifted rows, with no transaction: a failed insert lost every row after
-- the removed one. A function body runs in one transaction, so here the delete
-- and the shift commit or roll back together.
--
-- UNIQUE(vcon_id, *_index) is not deferrable and Postgres checks it per row, so
-- a single `SET idx = idx - 1` can collide mid-statement. The shift goes through
-- negative indices instead: later rows move to -idx (all distinct, all below
-- every live index), then to -idx - 1 (= old idx - 1). Rows keep their id, so
-- nothing referencing analysis.id / attachments.id is cascaded away.
--
-- SECURITY INVOKER so the caller's RLS (tenant isolation) applies to every row
-- touched. No `SET search_path`: table names resolve against the caller's
-- search_path, which PostgREST sets from the request's schema profile.
--
-- This definition is NOT shared across schemas. supabase-js sends .rpc() to the
-- configured db.schema (src/db/client.ts, SUPABASE_DB_SCHEMA), so PostgREST
-- resolves <schema>.remove_vcon_child_and_compact. This migration creates the
-- function in public only. A per-group schema created by
-- scripts/bootstrap-schema.sh before this migration has no copy, and removals
-- there take the non-atomic fallback (logged once per process). The bootstrap
-- script does not apply migrations: it dumps the current public schema, so a
-- schema bootstrapped after this migration reaches public inherits the function.
-- For an existing group schema, re-run the bootstrap or create the function in
-- that schema by hand.
--
-- Raises P0002 (no_data_found) when no row has that index; the service maps it
-- to ChildIndexError.

CREATE OR REPLACE FUNCTION remove_vcon_child_and_compact(
  p_table TEXT,
  p_vcon_id UUID,
  p_index INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  idx_col TEXT;
  deleted INTEGER;
BEGIN
  IF p_table = 'analysis' THEN
    idx_col := 'analysis_index';
  ELSIF p_table = 'attachments' THEN
    idx_col := 'attachment_index';
  ELSE
    RAISE EXCEPTION 'remove_vcon_child_and_compact: unsupported table %', p_table
      USING ERRCODE = '22023';
  END IF;

  EXECUTE format('DELETE FROM %I WHERE vcon_id = $1 AND %I = $2', p_table, idx_col)
    USING p_vcon_id, p_index;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  IF deleted = 0 THEN
    RAISE EXCEPTION '% index % not found', p_table, p_index
      USING ERRCODE = 'P0002';
  END IF;

  EXECUTE format('UPDATE %I SET %I = -%I WHERE vcon_id = $1 AND %I > $2',
                 p_table, idx_col, idx_col, idx_col)
    USING p_vcon_id, p_index;
  EXECUTE format('UPDATE %I SET %I = -%I - 1 WHERE vcon_id = $1 AND %I < 0',
                 p_table, idx_col, idx_col, idx_col)
    USING p_vcon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_vcon_child_and_compact(TEXT, UUID, INTEGER)
  TO authenticated, service_role;
