-- Backfill tenant_id on all child tables by joining to vcons.tenant_id
-- This migration populates tenant_id on existing data before RLS policies are enforced
-- Uses batched updates to avoid timeouts on large databases

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Backfill parties.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM parties p
  JOIN vcons v ON p.vcon_id = v.id
  WHERE p.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling parties.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE parties p
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE p.vcon_id = v.id
        AND p.tenant_id IS DISTINCT FROM v.tenant_id
        AND p.id IN (
          SELECT p2.id FROM parties p2
          JOIN vcons v2 ON p2.vcon_id = v2.id
          WHERE p2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY p2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill dialog.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM dialog d
  JOIN vcons v ON d.vcon_id = v.id
  WHERE d.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling dialog.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE dialog d
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE d.vcon_id = v.id
        AND d.tenant_id IS DISTINCT FROM v.tenant_id
        AND d.id IN (
          SELECT d2.id FROM dialog d2
          JOIN vcons v2 ON d2.vcon_id = v2.id
          WHERE d2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY d2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill attachments.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM attachments a
  JOIN vcons v ON a.vcon_id = v.id
  WHERE a.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling attachments.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE attachments a
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE a.vcon_id = v.id
        AND a.tenant_id IS DISTINCT FROM v.tenant_id
        AND a.id IN (
          SELECT a2.id FROM attachments a2
          JOIN vcons v2 ON a2.vcon_id = v2.id
          WHERE a2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY a2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill analysis.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM analysis a
  JOIN vcons v ON a.vcon_id = v.id
  WHERE a.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling analysis.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE analysis a
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE a.vcon_id = v.id
        AND a.tenant_id IS DISTINCT FROM v.tenant_id
        AND a.id IN (
          SELECT a2.id FROM analysis a2
          JOIN vcons v2 ON a2.vcon_id = v2.id
          WHERE a2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY a2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill groups.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM groups g
  JOIN vcons v ON g.vcon_id = v.id
  WHERE g.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling groups.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE groups g
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE g.vcon_id = v.id
        AND g.tenant_id IS DISTINCT FROM v.tenant_id
        AND g.id IN (
          SELECT g2.id FROM groups g2
          JOIN vcons v2 ON g2.vcon_id = v2.id
          WHERE g2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY g2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill party_history.tenant_id (batched, via dialog join)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM party_history ph
  JOIN dialog d ON ph.dialog_id = d.id
  JOIN vcons v ON d.vcon_id = v.id
  WHERE ph.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling party_history.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE party_history ph
      SET tenant_id = v.tenant_id
      FROM dialog d
      JOIN vcons v ON d.vcon_id = v.id
      WHERE ph.dialog_id = d.id
        AND ph.tenant_id IS DISTINCT FROM v.tenant_id
        AND ph.id IN (
          SELECT ph2.id FROM party_history ph2
          JOIN dialog d2 ON ph2.dialog_id = d2.id
          JOIN vcons v2 ON d2.vcon_id = v2.id
          WHERE ph2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY ph2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill vcon_embeddings.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM vcon_embeddings e
  JOIN vcons v ON e.vcon_id = v.id
  WHERE e.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling vcon_embeddings.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE vcon_embeddings e
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE e.vcon_id = v.id
        AND e.tenant_id IS DISTINCT FROM v.tenant_id
        AND e.id IN (
          SELECT e2.id FROM vcon_embeddings e2
          JOIN vcons v2 ON e2.vcon_id = v2.id
          WHERE e2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY e2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill embedding_queue.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM embedding_queue eq
  JOIN vcons v ON eq.vcon_id = v.id
  WHERE eq.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling embedding_queue.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE embedding_queue eq
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE eq.vcon_id = v.id
        AND eq.tenant_id IS DISTINCT FROM v.tenant_id
        AND eq.id IN (
          SELECT eq2.id FROM embedding_queue eq2
          JOIN vcons v2 ON eq2.vcon_id = v2.id
          WHERE eq2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY eq2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

-- Backfill s3_sync_tracking.tenant_id (batched)
DO $$
DECLARE
  total_rows int;
  updated_count int := 0;
  batch_size int := 1000;
  batch_count int;
BEGIN
  SELECT COUNT(*) INTO total_rows
  FROM s3_sync_tracking s3
  JOIN vcons v ON s3.vcon_id = v.id
  WHERE s3.tenant_id IS DISTINCT FROM v.tenant_id;
  
  IF total_rows > 0 THEN
    RAISE NOTICE 'Backfilling s3_sync_tracking.tenant_id: % rows', total_rows;
    
    LOOP
      UPDATE s3_sync_tracking s3
      SET tenant_id = v.tenant_id
      FROM vcons v
      WHERE s3.vcon_id = v.id
        AND s3.tenant_id IS DISTINCT FROM v.tenant_id
        AND s3.id IN (
          SELECT s3_2.id FROM s3_sync_tracking s3_2
          JOIN vcons v2 ON s3_2.vcon_id = v2.id
          WHERE s3_2.tenant_id IS DISTINCT FROM v2.tenant_id
          ORDER BY s3_2.id
          LIMIT batch_size
        );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      EXIT WHEN batch_count = 0;
      
      updated_count := updated_count + batch_count;
      RAISE NOTICE '  Updated % / % rows...', updated_count, total_rows;
      PERFORM pg_sleep(0.1);
    END LOOP;
  END IF;
END $$;

