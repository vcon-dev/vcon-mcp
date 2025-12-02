-- Backfill tenant_id from tenant attachments
--
-- The tenant_id column was not populated during initial data loading because
-- RLS_ENABLED was not set. This migration extracts tenant IDs from the
-- 'tenant' type attachments (body contains {"id": NNN}) and backfills
-- all tables.

-- Step 1: Backfill vcons.tenant_id from attachments
UPDATE vcons v
SET tenant_id = (a.body::jsonb->>'id')
FROM attachments a
WHERE a.vcon_id = v.id
  AND a.type = 'tenant'
  AND a.body IS NOT NULL
  AND a.body != ''
  AND v.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % vcons with tenant_id', updated_count;
END $$;

-- Step 2: Backfill parties.tenant_id from vcons
UPDATE parties p
SET tenant_id = v.tenant_id
FROM vcons v
WHERE p.vcon_id = v.id
  AND v.tenant_id IS NOT NULL
  AND p.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % parties with tenant_id', updated_count;
END $$;

-- Step 3: Backfill dialog.tenant_id from vcons
UPDATE dialog d
SET tenant_id = v.tenant_id
FROM vcons v
WHERE d.vcon_id = v.id
  AND v.tenant_id IS NOT NULL
  AND d.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % dialog rows with tenant_id', updated_count;
END $$;

-- Step 4: Backfill attachments.tenant_id from vcons
UPDATE attachments a
SET tenant_id = v.tenant_id
FROM vcons v
WHERE a.vcon_id = v.id
  AND v.tenant_id IS NOT NULL
  AND a.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % attachments with tenant_id', updated_count;
END $$;

-- Step 5: Backfill analysis.tenant_id from vcons
UPDATE analysis an
SET tenant_id = v.tenant_id
FROM vcons v
WHERE an.vcon_id = v.id
  AND v.tenant_id IS NOT NULL
  AND an.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % analysis rows with tenant_id', updated_count;
END $$;

-- Step 6: Backfill vcon_embeddings.tenant_id from vcons
UPDATE vcon_embeddings ve
SET tenant_id = v.tenant_id
FROM vcons v
WHERE ve.vcon_id = v.id
  AND v.tenant_id IS NOT NULL
  AND ve.tenant_id IS NULL;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % vcon_embeddings with tenant_id', updated_count;
END $$;

-- Step 7: Refresh the materialized view to include tenant_id
REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;

-- Final summary
DO $$
DECLARE
  vcon_count INTEGER;
  vcon_with_tenant INTEGER;
  distinct_tenants INTEGER;
BEGIN
  SELECT COUNT(*) INTO vcon_count FROM vcons;
  SELECT COUNT(*) INTO vcon_with_tenant FROM vcons WHERE tenant_id IS NOT NULL;
  SELECT COUNT(DISTINCT tenant_id) INTO distinct_tenants FROM vcons WHERE tenant_id IS NOT NULL;

  RAISE NOTICE '';
  RAISE NOTICE '=== Backfill Summary ===';
  RAISE NOTICE 'Total vcons: %', vcon_count;
  RAISE NOTICE 'vcons with tenant_id: %', vcon_with_tenant;
  RAISE NOTICE 'Distinct tenant IDs: %', distinct_tenants;
END $$;
