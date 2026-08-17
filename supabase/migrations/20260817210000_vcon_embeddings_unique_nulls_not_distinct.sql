-- Make the vcon_embeddings upsert actually idempotent.
--
-- `embed-vcons` upserts with ON CONFLICT (vcon_id, content_type, content_reference).
-- Subject-level embeddings carry content_reference = NULL, and by default Postgres
-- treats NULLs as DISTINCT in a unique constraint, so two subject rows for the same
-- vCon never conflict. ON CONFLICT therefore matched nothing and every backfill pass
-- INSERTed another copy instead of updating -- silently, with no error.
--
-- Observed 2026-08-17 on a fresh corpus: 2550 subject rows for 990 vCons, up to 3
-- copies each, after concurrent backfill workers selected the same "missing" units.
--
-- NULLS NOT DISTINCT (PG15+) makes NULL content_reference values compare equal, so
-- the existing ON CONFLICT clause works as written and re-running a backfill is safe
-- regardless of concurrency.

-- 1. Collapse existing duplicates, keeping the oldest row per logical key.
--    Vectors for the same content_text are identical, so which survivor is kept
--    does not matter; created_at ordering just makes this deterministic.
DELETE FROM vcon_embeddings e
USING vcon_embeddings keep
WHERE e.vcon_id = keep.vcon_id
  AND e.content_type = keep.content_type
  AND e.content_reference IS NOT DISTINCT FROM keep.content_reference
  AND (keep.created_at, keep.id) < (e.created_at, e.id);

-- 2. Recreate the constraint so NULL references collide instead of multiplying.
ALTER TABLE vcon_embeddings DROP CONSTRAINT IF EXISTS vcon_embeddings_unique;
ALTER TABLE vcon_embeddings
  ADD CONSTRAINT vcon_embeddings_unique
  UNIQUE NULLS NOT DISTINCT (vcon_id, content_type, content_reference);
