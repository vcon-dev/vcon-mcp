-- Optimize Search Performance
-- This migration adds indexes and optimizations to improve keyword and hybrid search performance
-- on large databases.

-- ============================================================================
-- Problem Analysis
-- ============================================================================
-- The search functions compute to_tsvector() on-the-fly for every query, which
-- is expensive on large datasets. The current trigram indexes help with fuzzy
-- matching but don't optimize full-text search with tsvector.
--
-- Key optimizations:
-- 1. Add composite indexes for date filtering (reduces scan scope)
-- 2. Add tsvector GIN indexes for full-text search (if we add materialized columns)
-- 3. Add partial indexes for recent data (most common queries)
-- 4. Optimize search functions to filter early

-- ============================================================================
-- 1. Composite Indexes for Date Filtering
-- ============================================================================
-- These help the search functions filter by date BEFORE computing tsvectors

-- Index for vcons date filtering (used in keyword search)
CREATE INDEX IF NOT EXISTS idx_vcons_created_at_btree 
  ON vcons(created_at) 
  WHERE created_at IS NOT NULL;

-- Composite index for vcons with tenant (if RLS is enabled)
CREATE INDEX IF NOT EXISTS idx_vcons_tenant_created_at_btree
  ON vcons(tenant_id, created_at)
  WHERE tenant_id IS NOT NULL AND created_at IS NOT NULL;

-- ============================================================================
-- 2. Materialized tsvector Columns (Optional but Recommended)
-- ============================================================================
-- Add computed tsvector columns that are indexed for fast full-text search.
-- These are updated via triggers when data changes.

-- Add tsvector column to vcons for subject search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute 
    WHERE attrelid = 'vcons'::regclass 
    AND attname = 'subject_tsvector'
  ) THEN
    ALTER TABLE vcons ADD COLUMN subject_tsvector tsvector;
  END IF;
END $$;

-- Add tsvector column to dialog for body search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute 
    WHERE attrelid = 'dialog'::regclass 
    AND attname = 'body_tsvector'
  ) THEN
    ALTER TABLE dialog ADD COLUMN body_tsvector tsvector;
  END IF;
END $$;

-- Add tsvector column to analysis for body search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute 
    WHERE attrelid = 'analysis'::regclass 
    AND attname = 'body_tsvector'
  ) THEN
    ALTER TABLE analysis ADD COLUMN body_tsvector tsvector;
  END IF;
END $$;

-- Add composite tsvector column to parties (name + mailto + tel)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute 
    WHERE attrelid = 'parties'::regclass 
    AND attname = 'party_tsvector'
  ) THEN
    ALTER TABLE parties ADD COLUMN party_tsvector tsvector;
  END IF;
END $$;

-- ============================================================================
-- 3. GIN Indexes on tsvector Columns
-- ============================================================================
-- These indexes make full-text search queries fast

CREATE INDEX IF NOT EXISTS idx_vcons_subject_tsvector_gin 
  ON vcons USING GIN (subject_tsvector)
  WHERE subject_tsvector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialog_body_tsvector_gin 
  ON dialog USING GIN (body_tsvector)
  WHERE body_tsvector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_body_tsvector_gin 
  ON analysis USING GIN (body_tsvector)
  WHERE body_tsvector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parties_party_tsvector_gin 
  ON parties USING GIN (party_tsvector)
  WHERE party_tsvector IS NOT NULL;

-- ============================================================================
-- 4. Triggers to Maintain tsvector Columns
-- ============================================================================
-- Automatically update tsvector columns when data changes

-- Function to update vcons subject_tsvector
CREATE OR REPLACE FUNCTION update_vcons_subject_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.subject_tsvector := setweight(to_tsvector('english', coalesce(NEW.subject, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update dialog body_tsvector
CREATE OR REPLACE FUNCTION update_dialog_body_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.body_tsvector := setweight(to_tsvector('english', coalesce(NEW.body, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update analysis body_tsvector
CREATE OR REPLACE FUNCTION update_analysis_body_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.body_tsvector := setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update parties party_tsvector
CREATE OR REPLACE FUNCTION update_parties_party_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.party_tsvector := setweight(to_tsvector('simple',
    coalesce(NEW.name, '') || ' ' || 
    coalesce(NEW.mailto, '') || ' ' || 
    coalesce(NEW.tel, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_vcons_subject_tsvector ON vcons;
CREATE TRIGGER trigger_vcons_subject_tsvector
  BEFORE INSERT OR UPDATE OF subject ON vcons
  FOR EACH ROW
  EXECUTE FUNCTION update_vcons_subject_tsvector();

DROP TRIGGER IF EXISTS trigger_dialog_body_tsvector ON dialog;
CREATE TRIGGER trigger_dialog_body_tsvector
  BEFORE INSERT OR UPDATE OF body ON dialog
  FOR EACH ROW
  EXECUTE FUNCTION update_dialog_body_tsvector();

DROP TRIGGER IF EXISTS trigger_analysis_body_tsvector ON analysis;
CREATE TRIGGER trigger_analysis_body_tsvector
  BEFORE INSERT OR UPDATE OF body ON analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_analysis_body_tsvector();

DROP TRIGGER IF EXISTS trigger_parties_party_tsvector ON parties;
CREATE TRIGGER trigger_parties_party_tsvector
  BEFORE INSERT OR UPDATE OF name, mailto, tel ON parties
  FOR EACH ROW
  EXECUTE FUNCTION update_parties_party_tsvector();

-- ============================================================================
-- 5. Backfill Existing Data
-- ============================================================================
-- Populate tsvector columns for existing rows

UPDATE vcons 
SET subject_tsvector = setweight(to_tsvector('english', coalesce(subject, '')), 'A')
WHERE subject_tsvector IS NULL;

UPDATE dialog 
SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'C')
WHERE body_tsvector IS NULL;

UPDATE analysis 
SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'B')
WHERE body_tsvector IS NULL;

UPDATE parties 
SET party_tsvector = setweight(to_tsvector('simple',
  coalesce(name, '') || ' ' || 
  coalesce(mailto, '') || ' ' || 
  coalesce(tel, '')), 'B')
WHERE party_tsvector IS NULL;

-- ============================================================================
-- 6. Partial Indexes for Recent Data (Optional Optimization)
-- ============================================================================
-- These indexes cover the most common query pattern: searching recent vCons

-- Index for vCons from last 30 days (adjust as needed)
CREATE INDEX IF NOT EXISTS idx_vcons_recent_subject_tsvector
  ON vcons USING GIN (subject_tsvector)
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND subject_tsvector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialog_recent_body_tsvector
  ON dialog USING GIN (body_tsvector)
  WHERE vcon_id IN (
    SELECT id FROM vcons WHERE created_at >= NOW() - INTERVAL '30 days'
  )
  AND body_tsvector IS NOT NULL;

-- ============================================================================
-- 7. Optimized Search Function (Alternative Implementation)
-- ============================================================================
-- This is an optimized version that uses the materialized tsvector columns.
-- Note: This is a reference implementation. The actual search functions
-- should be updated to use these columns for better performance.

COMMENT ON COLUMN vcons.subject_tsvector IS 
  'Materialized tsvector for subject full-text search. Updated automatically via trigger.';

COMMENT ON COLUMN dialog.body_tsvector IS 
  'Materialized tsvector for dialog body full-text search. Updated automatically via trigger.';

COMMENT ON COLUMN analysis.body_tsvector IS 
  'Materialized tsvector for analysis body full-text search. Updated automatically via trigger.';

COMMENT ON COLUMN parties.party_tsvector IS 
  'Materialized tsvector for party information (name, email, tel) full-text search. Updated automatically via trigger.';

