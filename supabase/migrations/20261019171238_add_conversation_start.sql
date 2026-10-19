-- vcons.conversation_start: when the conversation happened, as opposed to when
-- the vCon object was created.
--
-- draft-ietf-vcon-vcon-core-02 defines vcon.created_at as the creation time of
-- the vCon object, which must not be backdated. For imported historical
-- conversations (backfilled mail threads, meeting notes) created_at is the
-- ingest time, so a created_at window cannot answer "what happened in May".
-- The conversation time lives in dialog[].start (dialog.start_time) and
-- attachments[].start (attachments.start_time).
--
--   conversation_start = earliest of every dialog.start_time and
--                        attachments.start_time for the vCon,
--                        else vcons.created_at.
--
-- Search RPCs gain an optional `date_field` parameter ('created' default,
-- 'conversation') that selects which column start/end dates apply to. Callers
-- that do not pass it get exactly the old behaviour.
--
-- Maintenance
-- -----------
-- * vcons: BEFORE INSERT sets conversation_start = created_at (no children can
--   exist yet). BEFORE UPDATE OF created_at recomputes from the children only
--   when created_at actually changed, so the server's re-upsert of an
--   unchanged vCon costs nothing.
-- * dialog, attachments: AFTER ... FOR EACH STATEMENT triggers with transition
--   tables, one per event (Postgres allows transition tables on single-event
--   triggers only). A bulk upsert recomputes each touched vCon once, in one
--   UPDATE. UPDATE statements that leave start_time and vcon_id alone (tag
--   rewrites, body edits, index compaction) are filtered out and do nothing.
-- * Concurrency: the server upserts dialog and attachments for the same vCon in
--   parallel transactions. Each trigger first takes FOR NO KEY UPDATE on the
--   affected vcons rows (ordered by id), then recomputes in a new statement, so
--   its snapshot postdates any transaction it waited on: whichever commits last
--   sees every committed child row. NO KEY UPDATE, not UPDATE, because child
--   inserts hold FOR KEY SHARE on the parent through the FK check; FOR UPDATE
--   would deadlock two parallel child upserts.
-- * Table names are qualified with TG_TABLE_SCHEMA, so the triggers stay
--   correct in a per-group schema cloned by scripts/bootstrap-schema.sh. Like
--   other recent migrations, this one only changes `public`; existing group
--   schemas need it applied there by hand or re-bootstrapped.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.

-- ============================================================================
-- 1. Column
-- ============================================================================
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS conversation_start TIMESTAMPTZ;

COMMENT ON COLUMN vcons.conversation_start IS
  'Earliest dialog.start_time / attachments.start_time for this vCon, else created_at. Maintained by triggers; do not write directly.';

-- ============================================================================
-- 2. Recompute helper
-- ============================================================================
CREATE OR REPLACE FUNCTION recompute_vcon_conversation_start(p_schema TEXT, p_vcon_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_vcon_ids IS NULL OR cardinality(p_vcon_ids) = 0 THEN
    RETURN;
  END IF;

  -- Lock first, compute second. See header: the recompute must run in a
  -- statement that starts after any concurrent child writer has committed.
  EXECUTE format(
    'SELECT 1 FROM %I.vcons WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE',
    p_schema
  ) USING p_vcon_ids;

  EXECUTE format($f$
    UPDATE %1$I.vcons v
       SET conversation_start = c.new_start
      FROM (
        SELECT v2.id,
               COALESCE(
                 LEAST(
                   (SELECT min(d.start_time) FROM %1$I.dialog d WHERE d.vcon_id = v2.id),
                   (SELECT min(a.start_time) FROM %1$I.attachments a WHERE a.vcon_id = v2.id)
                 ),
                 v2.created_at
               ) AS new_start
          FROM %1$I.vcons v2
         WHERE v2.id = ANY($1)
      ) c
     WHERE v.id = c.id
       AND v.conversation_start IS DISTINCT FROM c.new_start
  $f$, p_schema) USING p_vcon_ids;
END;
$$;

-- ============================================================================
-- 3. vcons row trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION vcons_set_conversation_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  child_start TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Children reference vcons(id), so none exist yet. An upsert that hits
    -- the conflict path goes on to fire the UPDATE branch below.
    NEW.conversation_start := NEW.created_at;
    RETURN NEW;
  END IF;

  IF NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.conversation_start IS NOT NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format($f$
    SELECT LEAST(
      (SELECT min(d.start_time) FROM %1$I.dialog d WHERE d.vcon_id = $1),
      (SELECT min(a.start_time) FROM %1$I.attachments a WHERE a.vcon_id = $1)
    )
  $f$, TG_TABLE_SCHEMA) INTO child_start USING NEW.id;

  NEW.conversation_start := COALESCE(child_start, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vcons_conversation_start ON vcons;
CREATE TRIGGER trg_vcons_conversation_start
  BEFORE INSERT OR UPDATE OF created_at ON vcons
  FOR EACH ROW
  EXECUTE FUNCTION vcons_set_conversation_start();

-- ============================================================================
-- 4. dialog / attachments statement triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION child_refresh_conversation_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.vcon_id) INTO ids
      FROM new_rows n
     WHERE n.start_time IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.vcon_id) INTO ids
      FROM old_rows o
     WHERE o.start_time IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT x.vcon_id) INTO ids
      FROM (
        SELECT n.vcon_id
          FROM new_rows n
          JOIN old_rows o ON o.id = n.id
         WHERE n.start_time IS DISTINCT FROM o.start_time
            OR n.vcon_id IS DISTINCT FROM o.vcon_id
        UNION
        SELECT o.vcon_id
          FROM new_rows n
          JOIN old_rows o ON o.id = n.id
         WHERE n.start_time IS DISTINCT FROM o.start_time
            OR n.vcon_id IS DISTINCT FROM o.vcon_id
      ) x;
  END IF;

  PERFORM recompute_vcon_conversation_start(TG_TABLE_SCHEMA, ids);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_dialog_conversation_start_ins ON dialog;
DROP TRIGGER IF EXISTS trg_dialog_conversation_start_upd ON dialog;
DROP TRIGGER IF EXISTS trg_dialog_conversation_start_del ON dialog;
CREATE TRIGGER trg_dialog_conversation_start_ins
  AFTER INSERT ON dialog
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();
CREATE TRIGGER trg_dialog_conversation_start_upd
  AFTER UPDATE ON dialog
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();
CREATE TRIGGER trg_dialog_conversation_start_del
  AFTER DELETE ON dialog
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();

DROP TRIGGER IF EXISTS trg_attachments_conversation_start_ins ON attachments;
DROP TRIGGER IF EXISTS trg_attachments_conversation_start_upd ON attachments;
DROP TRIGGER IF EXISTS trg_attachments_conversation_start_del ON attachments;
CREATE TRIGGER trg_attachments_conversation_start_ins
  AFTER INSERT ON attachments
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();
CREATE TRIGGER trg_attachments_conversation_start_upd
  AFTER UPDATE ON attachments
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();
CREATE TRIGGER trg_attachments_conversation_start_del
  AFTER DELETE ON attachments
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION child_refresh_conversation_start();

-- ============================================================================
-- 5. Backfill and index
-- ============================================================================
-- One set-based pass. Rows already correct (a re-run) are skipped.
WITH child AS (
  SELECT s.vcon_id, min(s.start_time) AS first_start
    FROM (
      SELECT vcon_id, start_time FROM dialog WHERE start_time IS NOT NULL
      UNION ALL
      SELECT vcon_id, start_time FROM attachments WHERE start_time IS NOT NULL
    ) s
   GROUP BY s.vcon_id
),
target AS (
  SELECT v.id, COALESCE(c.first_start, v.created_at) AS new_start
    FROM vcons v
    LEFT JOIN child c ON c.vcon_id = v.id
)
UPDATE vcons v
   SET conversation_start = t.new_start
  FROM target t
 WHERE v.id = t.id
   AND v.conversation_start IS DISTINCT FROM t.new_start;

CREATE INDEX IF NOT EXISTS idx_vcons_conversation_start ON vcons (conversation_start);

-- ============================================================================
-- 6. Search RPCs: optional date_field ('created' | 'conversation')
-- ============================================================================
-- Each RPC keeps its parameters and adds date_field TEXT DEFAULT 'created' at
-- the end. The old overload is dropped by exact signature first: with both in
-- place PostgREST could not choose between them for a call that omits
-- date_field. The 'created' branch is the previous body unchanged; the
-- 'conversation' branch swaps created_at for conversation_start (and orders by
-- it where the old body ordered by created_at).

-- 6a. search_vcons_keyword ----------------------------------------------------
DROP FUNCTION IF EXISTS search_vcons_keyword(text, timestamptz, timestamptz, jsonb, int);

CREATE OR REPLACE FUNCTION search_vcons_keyword(
  query_text text,
  start_date timestamptz DEFAULT NULL,
  end_date   timestamptz DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50,
  date_field text DEFAULT 'created'
)
RETURNS TABLE (
  vcon_id uuid,
  doc_type text,
  ref_index int,
  rank double precision,
  snippet text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;

  current_tenant := get_current_tenant_id();

  IF date_field = 'conversation' THEN
    RETURN QUERY
    WITH base AS (
      SELECT v.uuid AS vcon_id,
             v.id   AS internal_id,
             'subject'::text AS doc_type,
             NULL::int AS ref_index,
             v.subject::text AS content,
             v.subject_tsvector AS tsv
      FROM vcons v
      WHERE (start_date IS NULL OR v.conversation_start >= start_date)
        AND (end_date   IS NULL OR v.conversation_start <= end_date)
        AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
        AND v.subject_tsvector IS NOT NULL
        AND v.subject_tsvector @@ plainto_tsquery('english', query_text)

      UNION ALL

      SELECT v.uuid AS vcon_id,
             p.vcon_id AS internal_id,
             'party'::text AS doc_type,
             p.party_index::int AS ref_index,
             concat_ws(' ', p.name, p.mailto, p.tel)::text AS content,
             p.party_tsvector AS tsv
      FROM parties p
      JOIN vcons v ON v.id = p.vcon_id
      WHERE (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
        AND (start_date IS NULL OR v.conversation_start >= start_date)
        AND (end_date   IS NULL OR v.conversation_start <= end_date)
        AND p.party_tsvector IS NOT NULL
        AND p.party_tsvector @@ plainto_tsquery('simple', query_text)

      UNION ALL

      SELECT v.uuid AS vcon_id,
             d.vcon_id AS internal_id,
             'dialog'::text AS doc_type,
             d.dialog_index::int AS ref_index,
             d.body::text AS content,
             d.body_tsvector AS tsv
      FROM dialog d
      JOIN vcons v ON v.id = d.vcon_id
      WHERE (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
        AND (start_date IS NULL OR v.conversation_start >= start_date)
        AND (end_date   IS NULL OR v.conversation_start <= end_date)
        AND d.body_tsvector IS NOT NULL
        AND d.body_tsvector @@ plainto_tsquery('english', query_text)

      UNION ALL

      SELECT v.uuid AS vcon_id,
             a.vcon_id AS internal_id,
             'analysis'::text AS doc_type,
             a.analysis_index::int AS ref_index,
             a.body::text AS content,
             a.body_tsvector AS tsv
      FROM analysis a
      JOIN vcons v ON v.id = a.vcon_id
      WHERE (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
        AND (start_date IS NULL OR v.conversation_start >= start_date)
        AND (end_date   IS NULL OR v.conversation_start <= end_date)
        AND a.body_tsvector IS NOT NULL
        AND a.body_tsvector @@ plainto_tsquery('english', query_text)
    )
    SELECT b.vcon_id,
           b.doc_type,
           b.ref_index,
           ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32)::double precision AS rank,
           ts_headline(
             'english',
             b.content,
             plainto_tsquery('english', query_text),
             'MaxFragments=3, MaxWords=25, MinWords=5, FragmentDelimiter= '' ... '''
           )::text AS snippet
    FROM base b
    LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.internal_id
    WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    ORDER BY rank DESC
    LIMIT max_results;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    -- Subject (vcons accessed directly — has both id and uuid)
    SELECT v.uuid AS vcon_id,
           v.id   AS internal_id,
           'subject'::text AS doc_type,
           NULL::int AS ref_index,
           v.subject::text AS content,
           v.subject_tsvector AS tsv
    FROM vcons v
    WHERE (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
      AND v.subject_tsvector IS NOT NULL
      AND v.subject_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL

    -- Parties (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           p.vcon_id AS internal_id,
           'party'::text AS doc_type,
           p.party_index::int AS ref_index,
           concat_ws(' ', p.name, p.mailto, p.tel)::text AS content,
           p.party_tsvector AS tsv
    FROM parties p
    JOIN vcons v ON v.id = p.vcon_id
    WHERE (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND p.party_tsvector IS NOT NULL
      AND p.party_tsvector @@ plainto_tsquery('simple', query_text)

    UNION ALL

    -- Dialog (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           d.vcon_id AS internal_id,
           'dialog'::text AS doc_type,
           d.dialog_index::int AS ref_index,
           d.body::text AS content,
           d.body_tsvector AS tsv
    FROM dialog d
    JOIN vcons v ON v.id = d.vcon_id
    WHERE (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND d.body_tsvector IS NOT NULL
      AND d.body_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL

    -- Analysis (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           a.vcon_id AS internal_id,
           'analysis'::text AS doc_type,
           a.analysis_index::int AS ref_index,
           a.body::text AS content,
           a.body_tsvector AS tsv
    FROM analysis a
    JOIN vcons v ON v.id = a.vcon_id
    WHERE (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND a.body_tsvector IS NOT NULL
      AND a.body_tsvector @@ plainto_tsquery('english', query_text)
  )
  SELECT b.vcon_id,
         b.doc_type,
         b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32)::double precision AS rank,
         ts_headline(
           'english',
           b.content,
           plainto_tsquery('english', query_text),
           'MaxFragments=3, MaxWords=25, MinWords=5, FragmentDelimiter= '' ... '''
         )::text AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.internal_id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_keyword(text, timestamptz, timestamptz, jsonb, int, text)
  TO anon, authenticated, service_role;

-- 6b. search_vcons_by_tags_and_date --------------------------------------------
-- Was LANGUAGE sql; plpgsql now so each date_field gets its own plan and the
-- created_at branch can still use idx_vcons_created_at for the range and sort.
DROP FUNCTION IF EXISTS search_vcons_by_tags_and_date(jsonb, timestamptz, timestamptz, int);

CREATE OR REPLACE FUNCTION search_vcons_by_tags_and_date(
  tag_filter          jsonb       DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  max_results         int         DEFAULT 1000,
  date_field          text        DEFAULT 'created'
) RETURNS TABLE (vcon_uuid uuid)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;

  IF date_field = 'conversation' THEN
    RETURN QUERY
    SELECT v.uuid
    FROM vcons v
    LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
    WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
      AND (vcon_created_after  IS NULL OR v.conversation_start >= vcon_created_after)
      AND (vcon_created_before IS NULL OR v.conversation_start <= vcon_created_before)
    ORDER BY v.conversation_start DESC
    LIMIT max_results;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v.uuid
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (vcon_created_after  IS NULL OR v.created_at >= vcon_created_after)
    AND (vcon_created_before IS NULL OR v.created_at <= vcon_created_before)
  ORDER BY v.created_at DESC
  LIMIT max_results;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_by_tags_and_date(jsonb, timestamptz, timestamptz, int, text)
  TO anon, authenticated, service_role;

-- 6c. search_vcons_by_tags_and_date_count --------------------------------------
DROP FUNCTION IF EXISTS search_vcons_by_tags_and_date_count(jsonb, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION search_vcons_by_tags_and_date_count(
  tag_filter          jsonb       DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  date_field          text        DEFAULT 'created'
) RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  n bigint;
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;

  IF date_field = 'conversation' THEN
    SELECT COUNT(*)::bigint INTO n
    FROM vcons v
    LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
    WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
      AND (vcon_created_after  IS NULL OR v.conversation_start >= vcon_created_after)
      AND (vcon_created_before IS NULL OR v.conversation_start <= vcon_created_before);
    RETURN n;
  END IF;

  SELECT COUNT(*)::bigint INTO n
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (vcon_created_after  IS NULL OR v.created_at >= vcon_created_after)
    AND (vcon_created_before IS NULL OR v.created_at <= vcon_created_before);
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_by_tags_and_date_count(jsonb, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;

-- 6d. aggregate_vcons_by_dealer_stats ------------------------------------------
-- The dealer RPCs (6d-6f) pick the column with a CASE on a plpgsql variable
-- rather than duplicating their long bodies. Under plpgsql custom plans the
-- variable is folded to a constant, the same way the existing
-- `vcon_created_after IS NULL OR ...` guards already rely on.
DROP FUNCTION IF EXISTS aggregate_vcons_by_dealer_stats(jsonb, timestamptz, timestamptz, int, int);

CREATE OR REPLACE FUNCTION aggregate_vcons_by_dealer_stats(
  tag_filter          jsonb DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  min_baseline        int DEFAULT 1,
  max_results         int DEFAULT 20,
  date_field          text DEFAULT 'created'
) RETURNS TABLE (
  dealer_id text,
  dealer_name text,
  team_id int,
  team_name text,
  filtered_count bigint,
  baseline_count bigint
) AS $$
DECLARE
  current_tenant text;
  use_conversation boolean;
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;
  use_conversation := (date_field = 'conversation');

  current_tenant := get_current_tenant_id();

  RETURN QUERY
  WITH base AS (
    SELECT
      v.id AS vid,
      NULLIF(trim(both FROM (d.body::jsonb->>'id')), '') AS did,
      COALESCE(NULLIF(trim(both FROM (d.body::jsonb->>'name')), ''), '') AS dname,
      CASE
        WHEN jsonb_typeof(d.body::jsonb->'team') = 'object'
          AND d.body::jsonb->'team' IS NOT NULL
          AND d.body::jsonb->'team' <> '{}'::jsonb
        THEN NULLIF((d.body::jsonb->'team'->>'id'), '')::int
        ELSE NULL::int
      END AS tid,
      CASE
        WHEN jsonb_typeof(d.body::jsonb->'team') = 'object'
          AND d.body::jsonb->'team' IS NOT NULL
          AND d.body::jsonb->'team' <> '{}'::jsonb
        THEN NULLIF(trim(both FROM (d.body::jsonb->'team'->>'name')), '')
        ELSE NULL::text
      END AS tname,
      ta.tags AS tagdoc
    FROM vcons v
    INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = 'strolid_dealer'
    LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
    WHERE (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
      AND (vcon_created_after IS NULL
           OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) >= vcon_created_after)
      AND (vcon_created_before IS NULL
           OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) <= vcon_created_before)
      AND d.body::jsonb ? 'id'
  ),
  rolled AS (
    SELECT
      b.did AS dealer_id,
      max(b.dname) AS dealer_name,
      max(b.tid) AS team_id,
      max(b.tname) AS team_name,
      COUNT(*)::bigint AS baseline_count,
      COUNT(*) FILTER (
        WHERE tag_filter = '{}'::jsonb
          OR (b.tagdoc IS NOT NULL AND b.tagdoc @> tag_filter)
      )::bigint AS filtered_count
    FROM base b
    WHERE b.did IS NOT NULL
    GROUP BY b.did
  )
  SELECT
    r.dealer_id,
    r.dealer_name,
    r.team_id,
    r.team_name,
    r.filtered_count,
    r.baseline_count
  FROM rolled r
  WHERE r.baseline_count >= min_baseline
  ORDER BY
    (r.filtered_count::double precision / NULLIF(r.baseline_count, 0)::double precision) DESC NULLS LAST,
    r.filtered_count DESC,
    r.baseline_count DESC
  LIMIT GREATEST(1, LEAST(max_results, 500));
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION aggregate_vcons_by_dealer_stats(jsonb, timestamptz, timestamptz, int, int, text)
  TO anon, authenticated, service_role;

-- 6e. count_vcons_for_dealer_filter --------------------------------------------
DROP FUNCTION IF EXISTS count_vcons_for_dealer_filter(text, text, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION count_vcons_for_dealer_filter(
  p_dealer_id text DEFAULT NULL,
  p_name_ilike text DEFAULT NULL,
  p_subject_contains text DEFAULT NULL,
  vcon_created_after timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  date_field text DEFAULT 'created'
) RETURNS bigint AS $$
DECLARE
  current_tenant text;
  use_conversation boolean;
  n bigint;
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;
  use_conversation := (date_field = 'conversation');

  current_tenant := get_current_tenant_id();

  IF p_dealer_id IS NULL AND (p_name_ilike IS NULL OR length(trim(p_name_ilike)) = 0) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(DISTINCT v.id)::bigint INTO n
  FROM vcons v
  INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = 'strolid_dealer'
  WHERE (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    AND (vcon_created_after IS NULL
         OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) >= vcon_created_after)
    AND (vcon_created_before IS NULL
         OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) <= vcon_created_before)
    AND (
      p_dealer_id IS NULL
      OR (d.body::jsonb->>'id') = p_dealer_id
    )
    AND (
      p_name_ilike IS NULL OR length(trim(p_name_ilike)) = 0
      OR (d.body::jsonb->>'name') ILIKE ('%' || p_name_ilike || '%')
    )
    AND (
      p_subject_contains IS NULL OR length(trim(p_subject_contains)) = 0
      OR v.subject ILIKE ('%' || p_subject_contains || '%')
    );

  RETURN COALESCE(n, 0);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION count_vcons_for_dealer_filter(text, text, text, timestamptz, timestamptz, text)
  TO anon, authenticated, service_role;

-- 6f. count_vcons_tags_and_dealer ----------------------------------------------
DROP FUNCTION IF EXISTS count_vcons_tags_and_dealer(jsonb, text, text, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION count_vcons_tags_and_dealer(
  tag_filter          jsonb DEFAULT '{}'::jsonb,
  p_dealer_id         text DEFAULT NULL,
  p_name_ilike        text DEFAULT NULL,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  p_subject_contains  text DEFAULT NULL,
  date_field          text DEFAULT 'created'
) RETURNS bigint AS $$
DECLARE
  current_tenant text;
  use_conversation boolean;
  n bigint;
BEGIN
  IF COALESCE(date_field, 'created') NOT IN ('created', 'conversation') THEN
    RAISE EXCEPTION 'date_field must be ''created'' or ''conversation'', got %', date_field
      USING ERRCODE = '22023';
  END IF;
  use_conversation := (date_field = 'conversation');

  current_tenant := get_current_tenant_id();

  IF tag_filter = '{}'::jsonb THEN
    RETURN 0;
  END IF;

  SELECT COUNT(DISTINCT v.id)::bigint INTO n
  FROM vcons v
  INNER JOIN vcon_tags_mv ta ON ta.vcon_id = v.id AND ta.tags IS NOT NULL AND ta.tags @> tag_filter
  INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = 'strolid_dealer'
  WHERE (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    AND (vcon_created_after IS NULL
         OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) >= vcon_created_after)
    AND (vcon_created_before IS NULL
         OR (CASE WHEN use_conversation THEN v.conversation_start ELSE v.created_at END) <= vcon_created_before)
    AND (
      p_dealer_id IS NULL
      OR (d.body::jsonb->>'id') = p_dealer_id
    )
    AND (
      p_name_ilike IS NULL OR length(trim(p_name_ilike)) = 0
      OR (d.body::jsonb->>'name') ILIKE ('%' || p_name_ilike || '%')
    )
    AND (
      p_subject_contains IS NULL OR length(trim(p_subject_contains)) = 0
      OR v.subject ILIKE ('%' || p_subject_contains || '%')
    );

  RETURN COALESCE(n, 0);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION count_vcons_tags_and_dealer(jsonb, text, text, timestamptz, timestamptz, text, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
