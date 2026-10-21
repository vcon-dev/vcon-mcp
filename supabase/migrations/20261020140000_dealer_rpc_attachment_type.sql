-- Dealer RPCs take the dealer attachment type as a parameter.
--
-- These functions used to match one hardcoded attachment type. The server now
-- passes the type it is configured with (VCON_DEALER_ATTACHMENT_TYPE, default
-- 'dealer'), so search filters, aggregates, vcon_fetch include=["dealer"] and
-- taxonomy coverage all read the same attachments.
--
-- Each function keeps its parameters and gains a trailing
-- p_attachment_type TEXT DEFAULT 'dealer'. The previous signature is dropped
-- first so PostgREST never sees two overloads for one named-argument call.
-- Callers that omit p_attachment_type now match type 'dealer'; deployments
-- that store a different type must run a server that passes it.

-- 1. vcon_uuids_for_dealer_filter ----------------------------------------------
DROP FUNCTION IF EXISTS vcon_uuids_for_dealer_filter(text, text);

CREATE OR REPLACE FUNCTION vcon_uuids_for_dealer_filter(
  p_dealer_id text DEFAULT NULL,
  p_name_ilike text DEFAULT NULL,
  p_attachment_type text DEFAULT 'dealer'
) RETURNS TABLE (vcon_uuid uuid) AS $$
DECLARE
  current_tenant text;
BEGIN
  current_tenant := get_current_tenant_id();

  IF p_dealer_id IS NULL AND (p_name_ilike IS NULL OR length(trim(p_name_ilike)) = 0) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v.uuid
  FROM vcons v
  INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = COALESCE(NULLIF(p_attachment_type, ''), 'dealer')
  WHERE (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    AND (
      p_dealer_id IS NULL
      OR (d.body::jsonb->>'id') = p_dealer_id
    )
    AND (
      p_name_ilike IS NULL OR length(trim(p_name_ilike)) = 0
      OR (d.body::jsonb->>'name') ILIKE ('%' || p_name_ilike || '%')
    );
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION vcon_uuids_for_dealer_filter(text, text, text)
  TO anon, authenticated, service_role;

-- 2. aggregate_vcons_by_dealer_stats -------------------------------------------
DROP FUNCTION IF EXISTS aggregate_vcons_by_dealer_stats(jsonb, timestamptz, timestamptz, int, int, text);

CREATE OR REPLACE FUNCTION aggregate_vcons_by_dealer_stats(
  tag_filter          jsonb DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  min_baseline        int DEFAULT 1,
  max_results         int DEFAULT 20,
  date_field          text DEFAULT 'created',
  p_attachment_type text DEFAULT 'dealer'
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
    INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = COALESCE(NULLIF(p_attachment_type, ''), 'dealer')
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

GRANT EXECUTE ON FUNCTION aggregate_vcons_by_dealer_stats(jsonb, timestamptz, timestamptz, int, int, text, text)
  TO anon, authenticated, service_role;

-- 3. count_vcons_for_dealer_filter ---------------------------------------------
DROP FUNCTION IF EXISTS count_vcons_for_dealer_filter(text, text, text, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION count_vcons_for_dealer_filter(
  p_dealer_id text DEFAULT NULL,
  p_name_ilike text DEFAULT NULL,
  p_subject_contains text DEFAULT NULL,
  vcon_created_after timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  date_field text DEFAULT 'created',
  p_attachment_type text DEFAULT 'dealer'
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
  INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = COALESCE(NULLIF(p_attachment_type, ''), 'dealer')
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

GRANT EXECUTE ON FUNCTION count_vcons_for_dealer_filter(text, text, text, timestamptz, timestamptz, text, text)
  TO anon, authenticated, service_role;

-- 4. count_vcons_tags_and_dealer -----------------------------------------------
DROP FUNCTION IF EXISTS count_vcons_tags_and_dealer(jsonb, text, text, timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION count_vcons_tags_and_dealer(
  tag_filter          jsonb DEFAULT '{}'::jsonb,
  p_dealer_id         text DEFAULT NULL,
  p_name_ilike        text DEFAULT NULL,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  p_subject_contains  text DEFAULT NULL,
  date_field          text DEFAULT 'created',
  p_attachment_type text DEFAULT 'dealer'
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
  INNER JOIN attachments d ON d.vcon_id = v.id AND d.type = COALESCE(NULLIF(p_attachment_type, ''), 'dealer')
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

GRANT EXECUTE ON FUNCTION count_vcons_tags_and_dealer(jsonb, text, text, timestamptz, timestamptz, text, text, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
