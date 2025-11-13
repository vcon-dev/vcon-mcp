-- Fix the relationship between attachments and vcons
-- This migration ensures the foreign key constraint is properly enforced,
-- cleans up orphaned records, and verifies indexes
-- Optimized for large datasets to avoid timeouts

-- Suppress NOTICE messages for cleaner output (IF NOT EXISTS generates notices)
-- Note: RAISE NOTICE statements in DO blocks will still show as they're intentional
SET client_min_messages TO WARNING;

-- Step 1: Ensure indexes exist first for performance
CREATE INDEX IF NOT EXISTS idx_attachments_vcon ON attachments(vcon_id);
CREATE INDEX IF NOT EXISTS idx_vcons_id ON vcons(id) WHERE id IS NOT NULL;

-- Step 2: Check for and report orphaned attachments (using EXISTS for better performance)
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM attachments a
  WHERE NOT EXISTS (SELECT 1 FROM vcons v WHERE v.id = a.vcon_id);
  
  IF orphaned_count > 0 THEN
    RAISE NOTICE 'Found % orphaned attachment(s) - these will be deleted', orphaned_count;
  ELSE
    RAISE NOTICE 'No orphaned attachments found';
  END IF;
END $$;

-- Step 3: Delete orphaned attachments in batches to avoid timeouts
-- Use EXISTS instead of NOT IN for better performance with indexes
DO $$
DECLARE
  deleted_count INTEGER;
  batch_size INTEGER := 1000;
BEGIN
  LOOP
    -- Delete in batches
    WITH batch AS (
      SELECT id FROM attachments a
      WHERE NOT EXISTS (SELECT 1 FROM vcons v WHERE v.id = a.vcon_id)
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM attachments
    WHERE id IN (SELECT id FROM batch);
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % orphaned attachment(s) in this batch', deleted_count;
    
    -- Small delay to avoid overwhelming the database
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Finished cleaning up orphaned attachments';
END $$;

-- Step 4: Drop existing foreign key constraint if it exists (to recreate it properly)
DO $$
BEGIN
  -- Drop the constraint if it exists with any name
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'attachments'::regclass 
    AND confrelid = 'vcons'::regclass 
    AND contype = 'f'
  ) THEN
    ALTER TABLE attachments 
    DROP CONSTRAINT IF EXISTS attachments_vcon_id_fkey;
    
    -- Also try common constraint names
    ALTER TABLE attachments 
    DROP CONSTRAINT IF EXISTS attachments_vcon_id_vcons_id_fk;
  END IF;
END $$;

-- Step 5: Recreate the foreign key constraint with proper name and CASCADE delete
-- Note: This may take time on large tables, but indexes are already in place
-- The constraint validates referential integrity, which is necessary
ALTER TABLE attachments
ADD CONSTRAINT attachments_vcon_id_fkey
FOREIGN KEY (vcon_id)
REFERENCES vcons(id)
ON DELETE CASCADE
ON UPDATE CASCADE
NOT VALID;

-- Validate the constraint (this is faster than validating during creation)
ALTER TABLE attachments VALIDATE CONSTRAINT attachments_vcon_id_fkey;

-- Step 6: Ensure the unique constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'attachments'::regclass 
    AND contype = 'u'
    AND array_length(conkey, 1) = 2
    AND conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'attachments'::regclass AND attname = 'vcon_id')
    AND conkey[2] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'attachments'::regclass AND attname = 'attachment_index')
  ) THEN
    ALTER TABLE attachments
    ADD CONSTRAINT attachments_vcon_id_attachment_index_key
    UNIQUE (vcon_id, attachment_index);
  END IF;
END $$;

-- Step 7: Ensure additional indexes exist for performance
-- (idx_attachments_vcon was already created in Step 1)
CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(type) WHERE type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_party ON attachments(party) WHERE party IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_dialog ON attachments(dialog) WHERE dialog IS NOT NULL;

-- Step 8: Add a comment documenting the relationship
COMMENT ON CONSTRAINT attachments_vcon_id_fkey ON attachments IS 
'Foreign key relationship: attachments.vcon_id references vcons.id. Cascade delete ensures attachments are automatically removed when their parent vCon is deleted.';

-- Step 9: Verify the relationship is working
DO $$
DECLARE
  fk_exists BOOLEAN;
  orphaned_count INTEGER;
BEGIN
  -- Check if foreign key exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'attachments'::regclass 
    AND confrelid = 'vcons'::regclass 
    AND contype = 'f'
  ) INTO fk_exists;
  
  -- Check for orphaned records (using EXISTS for better performance)
  SELECT COUNT(*) INTO orphaned_count
  FROM attachments a
  WHERE NOT EXISTS (SELECT 1 FROM vcons v WHERE v.id = a.vcon_id);
  
  IF fk_exists THEN
    RAISE NOTICE '✓ Foreign key constraint exists and is properly configured';
  ELSE
    RAISE WARNING '✗ Foreign key constraint is missing!';
  END IF;
  
  IF orphaned_count = 0 THEN
    RAISE NOTICE '✓ No orphaned attachments found';
  ELSE
    RAISE WARNING '✗ Found % orphaned attachment(s)', orphaned_count;
  END IF;
END $$;

