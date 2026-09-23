-- vcon_tags_mv was only ever refreshed by hand (CON-995). Deployments without
-- pg_cron kept an empty view, so get_tag_analytics, get_unique_tags and
-- vcon_graph_shape reported no tags on a tagged corpus.
--
-- refresh_vcon_tags_mv_if_stale() refreshes only when a tags attachment is newer
-- than anything in the view, or the view is empty while tags exist. It is
-- SECURITY DEFINER because REFRESH needs view ownership and the service calls it
-- as service_role through PostgREST.
-- ponytail: a deleted tags attachment does not bump max(updated_at), so its tags
-- linger until the next tag write. Track a deletion counter if that matters.

CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv_if_stale()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src_max timestamptz;
  mv_max timestamptz;
  mv_empty boolean;
BEGIN
  SELECT max(updated_at) INTO src_max
    FROM attachments
   WHERE coalesce(type, purpose) = 'tags' AND body IS NOT NULL;
  IF src_max IS NULL THEN
    RETURN false;
  END IF;

  SELECT max(tag_updated_at), count(*) = 0 INTO mv_max, mv_empty FROM vcon_tags_mv;
  IF NOT mv_empty AND mv_max >= src_max THEN
    RETURN false;
  END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION refresh_vcon_tags_mv_if_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_vcon_tags_mv_if_stale() TO service_role;

SELECT refresh_vcon_tags_mv_if_stale();
