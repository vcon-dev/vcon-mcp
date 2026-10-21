-- CON-957: atomic vCon create.
--
-- The batch writer (src/db/batch-writer.ts) used to upsert vcons, then
-- parties / dialog / analysis / attachments as separate PostgREST calls, each
-- its own transaction. When one child write failed (a dialog insert hit the
-- tsvector cap), the vcons row and the other children stayed committed while
-- the API returned 500. A function body runs in one transaction, so here every
-- row of the batch commits or none does.
--
-- Semantics match the PostgREST upserts this replaces:
--   * vcons upserts on id; each child table upserts on (vcon_id, *_index).
--     Re-posting a uuid overwrites children index by index; it does not delete
--     children beyond the new count (neither did the old path).
--   * The column list is the union of keys across that table's rows. A key
--     missing from one row writes NULL for that row (supabase-js defaultToNull);
--     a column absent from every row keeps its default on insert (id,
--     created_at) and its stored value on conflict.
--   * An unknown key fails the statement (42703), as PostgREST did with
--     PGRST204, so a schema missing a column cannot silently drop data.
--   * Plain INSERT ... ON CONFLICT, so every trigger still fires (tenant
--     stamping, normalize_tags_attachment, tsvector, conversation_start).
--
-- p_* arguments are JSON arrays of row objects built by the batch writer's
-- row builders. Rows may belong to several vCons; the caller retries vCons one
-- per call when a batch fails, so one bad vCon does not fail its neighbours.
--
-- SECURITY INVOKER so the caller's RLS (tenant isolation) applies to every row
-- written, as it did for the direct table writes. No `SET search_path`: table
-- names resolve against the caller's search_path, which PostgREST sets from the
-- request's schema profile. Like remove_vcon_child_and_compact, this creates the
-- function in public only; a per-group schema bootstrapped before this
-- migration needs the function created in it, or creates there take the
-- non-atomic fallback (logged once per process).

CREATE OR REPLACE FUNCTION save_vcon_batch(
  p_vcons JSONB,
  p_parties JSONB DEFAULT '[]'::jsonb,
  p_dialog JSONB DEFAULT '[]'::jsonb,
  p_analysis JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  spec RECORD;
  col_list TEXT;
  set_list TEXT;
BEGIN
  -- Parent first so child FKs resolve; children in the order the old path used.
  FOR spec IN
    SELECT * FROM (VALUES
      (1, 'vcons',       p_vcons,       'id'),
      (2, 'parties',     p_parties,     'vcon_id, party_index'),
      (3, 'dialog',      p_dialog,      'vcon_id, dialog_index'),
      (4, 'analysis',    p_analysis,    'vcon_id, analysis_index'),
      (5, 'attachments', p_attachments, 'vcon_id, attachment_index')
    ) AS s(ord, tbl, rows, conflict)
    ORDER BY ord
  LOOP
    CONTINUE WHEN spec.rows IS NULL OR jsonb_array_length(spec.rows) = 0;

    SELECT string_agg(format('%I', k), ', ' ORDER BY k),
           string_agg(format('%I = EXCLUDED.%I', k, k), ', ' ORDER BY k)
      INTO col_list, set_list
      FROM (SELECT DISTINCT jsonb_object_keys(r) AS k
              FROM jsonb_array_elements(spec.rows) AS r) AS keys;

    EXECUTE format(
      'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%I, $1) '
      'ON CONFLICT (%s) DO UPDATE SET %s',
      spec.tbl, col_list, col_list, spec.tbl, spec.conflict, set_list
    ) USING spec.rows;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION save_vcon_batch(JSONB, JSONB, JSONB, JSONB, JSONB)
  TO authenticated, service_role;
