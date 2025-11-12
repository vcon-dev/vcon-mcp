-- Revert public read access and set up read-only user for dashboard

-- Drop the public read policies
DROP POLICY IF EXISTS "vcons_public_read" ON vcons;
DROP POLICY IF EXISTS "dialog_public_read" ON dialog;
DROP POLICY IF EXISTS "parties_public_read" ON parties;
DROP POLICY IF EXISTS "analysis_public_read" ON analysis;
DROP POLICY IF EXISTS "attachments_public_read" ON attachments;
DROP POLICY IF EXISTS "groups_public_read" ON groups;
DROP POLICY IF EXISTS "party_history_public_read" ON party_history;

-- Enable RLS on all tables if not already enabled
ALTER TABLE vcons ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialog ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE s3_sync_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE vcon_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;

-- Create a read-only database role for analytics dashboard
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vcon_dashboard_readonly') THEN
    CREATE ROLE vcon_dashboard_readonly NOLOGIN;
  END IF;
END
$$;

-- Grant SELECT permissions on all relevant tables to the read-only role
GRANT SELECT ON vcons TO vcon_dashboard_readonly;
GRANT SELECT ON dialog TO vcon_dashboard_readonly;
GRANT SELECT ON parties TO vcon_dashboard_readonly;
GRANT SELECT ON analysis TO vcon_dashboard_readonly;
GRANT SELECT ON attachments TO vcon_dashboard_readonly;
GRANT SELECT ON groups TO vcon_dashboard_readonly;
GRANT SELECT ON party_history TO vcon_dashboard_readonly;
GRANT SELECT ON vcon_embeddings TO vcon_dashboard_readonly;
GRANT SELECT ON s3_sync_tracking TO vcon_dashboard_readonly;
GRANT SELECT ON privacy_requests TO vcon_dashboard_readonly;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO vcon_dashboard_readonly;

-- Note: After this migration, you'll need to:
-- 1. Create a database user in Supabase SQL Editor:
--    CREATE USER dashboard_viewer WITH PASSWORD 'your_secure_password' IN ROLE vcon_dashboard_readonly;
-- 2. Use this user's credentials in your dashboard connection instead of the anon key