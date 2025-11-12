-- Add policy for embedding_queue table (internal use only, no user access needed)
CREATE POLICY "no_user_access_embedding_queue" ON embedding_queue
FOR ALL TO authenticated
USING (false);