-- Create tenant-aware RLS policies for all tables
-- Drop permissive policies and replace with tenant isolation policies
-- Uses denormalized tenant_id columns for fast evaluation

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Drop existing permissive policies
DROP POLICY IF EXISTS "authenticated_users_read_vcons" ON vcons;
DROP POLICY IF EXISTS "authenticated_users_read_dialog" ON dialog;
DROP POLICY IF EXISTS "authenticated_users_read_parties" ON parties;
DROP POLICY IF EXISTS "authenticated_users_read_analysis" ON analysis;
DROP POLICY IF EXISTS "authenticated_users_read_attachments" ON attachments;
DROP POLICY IF EXISTS "authenticated_users_read_groups" ON groups;
DROP POLICY IF EXISTS "authenticated_users_read_party_history" ON party_history;
DROP POLICY IF EXISTS "authenticated_users_read_vcon_embeddings" ON vcon_embeddings;
DROP POLICY IF EXISTS "authenticated_users_read_s3_sync_tracking" ON s3_sync_tracking;

-- Drop old join-based tenant policies if they exist (from backup migration)
DROP POLICY IF EXISTS "vcons_tenant_isolation" ON vcons;
DROP POLICY IF EXISTS "parties_tenant_isolation" ON parties;
DROP POLICY IF EXISTS "dialog_tenant_isolation" ON dialog;
DROP POLICY IF EXISTS "attachments_tenant_isolation" ON attachments;
DROP POLICY IF EXISTS "analysis_tenant_isolation" ON analysis;
DROP POLICY IF EXISTS "groups_tenant_isolation" ON groups;
DROP POLICY IF EXISTS "party_history_tenant_isolation" ON party_history;

-- Create tenant-aware RLS policies for vcons table
-- NULL tenant_id = accessible to all tenants (shared data)
CREATE POLICY "vcons_tenant_isolation" ON vcons
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Create tenant-aware RLS policies for child tables
-- Using denormalized tenant_id for fast evaluation (no joins needed)

-- Parties table
CREATE POLICY "parties_tenant_isolation" ON parties
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Dialog table
CREATE POLICY "dialog_tenant_isolation" ON dialog
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Attachments table
CREATE POLICY "attachments_tenant_isolation" ON attachments
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Analysis table
CREATE POLICY "analysis_tenant_isolation" ON analysis
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Groups table
CREATE POLICY "groups_tenant_isolation" ON groups
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- Party history table
CREATE POLICY "party_history_tenant_isolation" ON party_history
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- vcon_embeddings table
CREATE POLICY "vcon_embeddings_tenant_isolation" ON vcon_embeddings
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- embedding_queue table
CREATE POLICY "embedding_queue_tenant_isolation" ON embedding_queue
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

-- s3_sync_tracking table
CREATE POLICY "s3_sync_tracking_tenant_isolation" ON s3_sync_tracking
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());

