-- Combined date + tag search RPCs.
--
-- Replaces the JS-side intersection in searchVCons / searchVConsCount, which
-- silently truncated to PostgREST's default page size (≤1000) when both
-- filters were combined and produced nonsensical totals across fan-out runs.
--
-- Both functions match against vcon_tags_mv.tags using JSONB containment
-- (@>) and filter on vcons.created_at, mirroring how searchVCons applies
-- filters today.

CREATE OR REPLACE FUNCTION search_vcons_by_tags_and_date(
  tag_filter          jsonb       DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL,
  max_results         int         DEFAULT 1000
) RETURNS TABLE (vcon_uuid uuid) AS $$
  SELECT v.uuid
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (vcon_created_after  IS NULL OR v.created_at >= vcon_created_after)
    AND (vcon_created_before IS NULL OR v.created_at <= vcon_created_before)
  ORDER BY v.created_at DESC
  LIMIT max_results;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION search_vcons_by_tags_and_date_count(
  tag_filter          jsonb       DEFAULT '{}'::jsonb,
  vcon_created_after  timestamptz DEFAULT NULL,
  vcon_created_before timestamptz DEFAULT NULL
) RETURNS bigint AS $$
  SELECT COUNT(*)::bigint
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (vcon_created_after  IS NULL OR v.created_at >= vcon_created_after)
    AND (vcon_created_before IS NULL OR v.created_at <= vcon_created_before);
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION search_vcons_by_tags_and_date(jsonb, timestamptz, timestamptz, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_vcons_by_tags_and_date_count(jsonb, timestamptz, timestamptz)  TO anon, authenticated, service_role;
