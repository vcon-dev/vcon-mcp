-- Create RLS policies for authenticated users to read dashboard data

-- Policies for vcons table
CREATE POLICY "authenticated_users_read_vcons" ON vcons
FOR SELECT TO authenticated
USING (true);

-- Policies for dialog table
CREATE POLICY "authenticated_users_read_dialog" ON dialog
FOR SELECT TO authenticated
USING (true);

-- Policies for parties table
CREATE POLICY "authenticated_users_read_parties" ON parties
FOR SELECT TO authenticated
USING (true);

-- Policies for analysis table
CREATE POLICY "authenticated_users_read_analysis" ON analysis
FOR SELECT TO authenticated
USING (true);

-- Policies for attachments table
CREATE POLICY "authenticated_users_read_attachments" ON attachments
FOR SELECT TO authenticated
USING (true);

-- Policies for groups table
CREATE POLICY "authenticated_users_read_groups" ON groups
FOR SELECT TO authenticated
USING (true);

-- Policies for party_history table
CREATE POLICY "authenticated_users_read_party_history" ON party_history
FOR SELECT TO authenticated
USING (true);

-- Policies for vcon_embeddings table
CREATE POLICY "authenticated_users_read_vcon_embeddings" ON vcon_embeddings
FOR SELECT TO authenticated
USING (true);

-- Policies for s3_sync_tracking table
CREATE POLICY "authenticated_users_read_s3_sync_tracking" ON s3_sync_tracking
FOR SELECT TO authenticated
USING (true);