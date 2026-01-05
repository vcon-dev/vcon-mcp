-- Migration: Change parties.uuid from UUID to TEXT
-- Reason: Allow flexible party identifiers (phone numbers, email-style IDs, etc.)
-- that don't conform to strict UUID format

-- Step 1: Drop the index on uuid (if exists)
DROP INDEX IF EXISTS idx_parties_uuid;

-- Step 2: Alter the column type from UUID to TEXT
ALTER TABLE parties 
ALTER COLUMN uuid TYPE TEXT 
USING uuid::TEXT;

-- Step 3: Recreate the index on the TEXT column
CREATE INDEX idx_parties_uuid ON parties(uuid) WHERE uuid IS NOT NULL;

-- Add a comment explaining the change
COMMENT ON COLUMN parties.uuid IS 'Party identifier - can be any string (UUID, phone number, email, etc.)';

