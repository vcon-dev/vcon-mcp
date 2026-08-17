-- vcon_tags_mv: accept a flat JSON object tags body, not just the "key:value" array
--
-- This server writes tags as ["key:value", ...]. External ingest pipelines write
-- the same information as a flat object, {"source": "gmail", "thread_id": "..."}.
-- The old MV predicate required body ~ '^\s*\[.*\]\s*$', so every object-bodied
-- vCon contributed zero rows and all tag reads/searches returned nothing —
-- silently. 10k+ rows in the local dev corpus were in that state.
--
-- Both shapes are now extracted. Object values come through jsonb_each_text, so
-- non-string scalars stringify and JSON nulls drop; src/utils/read-surfaces.ts
-- parseTagsBody() mirrors this so SQL and TS agree.
--
-- The tags attachment is still identified by coalesce(type, purpose) = 'tags'
-- (see 20260817000000_tags_attachment_purpose.sql), which this migration keeps.
--
-- No backfill: the external writer keeps producing object bodies, so tolerant
-- readers are the durable fix and a one-time rewrite would only drift again.

DROP MATERIALIZED VIEW IF EXISTS vcon_tags_mv CASCADE;

CREATE MATERIALIZED VIEW vcon_tags_mv AS
WITH tag_att AS MATERIALIZED (
  -- Fenced so the ::jsonb cast only ever sees bracket-shaped tags bodies.
  -- ponytail: bracket-shaped but invalid JSON still errors on the cast, same as
  -- the previous definition. Switch the guard to
  -- pg_input_is_valid(body, 'jsonb') once every deployment target is PG16+.
  SELECT tenant_id, vcon_id, updated_at, created_at, body::jsonb AS body_json
  FROM attachments
  WHERE coalesce(type, purpose) = 'tags'
    AND body IS NOT NULL
    AND body ~ '^\s*(\[.*\]|\{.*\})\s*$'
)
SELECT
  a.tenant_id,
  a.vcon_id,
  jsonb_object_agg(p.key, p.value) AS tags,
  max(a.updated_at) AS tag_updated_at,
  min(a.created_at) AS tag_created_at
FROM tag_att a
CROSS JOIN LATERAL (
  -- ["key:value", ...] — value is everything after the FIRST colon, matching
  -- parseTagsBody(). The old split_part(elem, ':', 2) truncated at the second.
  SELECT split_part(elem, ':', 1) AS key,
         substr(elem, strpos(elem, ':') + 1) AS value
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(a.body_json) = 'array' THEN a.body_json ELSE '[]'::jsonb END
  ) AS elem
  WHERE strpos(elem, ':') > 1
  UNION ALL
  -- {"key": "value", ...}
  SELECT e.key, e.value
  FROM jsonb_each_text(
    CASE WHEN jsonb_typeof(a.body_json) = 'object' THEN a.body_json ELSE '{}'::jsonb END
  ) AS e
  WHERE e.value IS NOT NULL
) p
WHERE p.key IS NOT NULL AND p.key <> ''
GROUP BY a.tenant_id, a.vcon_id;

-- Indexes (unchanged from 20251210120000_optimize_mv_tags_timestamps.sql)
CREATE UNIQUE INDEX idx_vcon_tags_mv_vcon_id ON vcon_tags_mv(vcon_id);
CREATE INDEX idx_vcon_tags_mv_tags_gin ON vcon_tags_mv USING GIN (tags);
CREATE INDEX idx_vcon_tags_mv_tenant ON vcon_tags_mv(tenant_id);
CREATE INDEX idx_vcon_tags_mv_updated ON vcon_tags_mv(tag_updated_at DESC);
CREATE INDEX idx_vcon_tags_mv_tenant_updated ON vcon_tags_mv(tenant_id, tag_updated_at DESC);

-- refresh_vcon_tags_mv() is left as-is: DROP MATERIALIZED VIEW ... CASCADE does
-- not touch functions, and redefining it here would revert the later
-- table-returning version.

DO $$
DECLARE
  row_count INTEGER;
  tag_attachments INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM vcon_tags_mv;
  SELECT COUNT(*) INTO tag_attachments FROM attachments
    WHERE coalesce(type, purpose) = 'tags' AND body IS NOT NULL AND body <> '';
  RAISE NOTICE 'vcon_tags_mv rebuilt: % rows from % tags attachments', row_count, tag_attachments;
  IF tag_attachments > 0 AND row_count = 0 THEN
    RAISE WARNING 'vcon_tags_mv is empty despite % tags attachments', tag_attachments;
  END IF;
END $$;
