-- Enable RLS on migration_reports table
-- This table was created after the initial RLS migration and was missed

ALTER TABLE migration_reports ENABLE ROW LEVEL SECURITY;

-- Create policy for service role access only (this is an internal admin table)
-- Service role bypasses RLS, so authenticated users won't see this data
CREATE POLICY "migration_reports_service_only" ON migration_reports
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Note: vcon_tags_mv is a materialized view, not a table
-- Materialized views don't support RLS - they inherit security from the underlying tables
-- The view is built from 'attachments' which has RLS enabled

COMMENT ON TABLE migration_reports IS 'Internal migration tracking table - RLS enabled, service role access only';
