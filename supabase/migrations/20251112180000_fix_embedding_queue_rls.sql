-- Fix RLS policy for embedding_queue to allow service_role and trigger function
-- The embedding_queue trigger needs to insert rows when vCons are created

-- Drop the restrictive policy
DROP POLICY IF EXISTS "no_user_access_embedding_queue" ON embedding_queue;

-- Create a policy that allows service_role to insert (for triggers and direct inserts)
-- and blocks authenticated users from accessing the queue
CREATE POLICY "embedding_queue_service_role_insert" ON embedding_queue
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "embedding_queue_service_role_select" ON embedding_queue
FOR SELECT
TO service_role
USING (true);

-- Block authenticated users from accessing the queue (internal use only)
CREATE POLICY "embedding_queue_no_user_access" ON embedding_queue
FOR ALL
TO authenticated
USING (false);

-- Make the trigger function SECURITY DEFINER so it runs with elevated privileges
-- This ensures the trigger can insert into embedding_queue even when RLS is enabled
CREATE OR REPLACE FUNCTION enqueue_embedding() 
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO embedding_queue(vcon_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION enqueue_embedding() TO service_role;

COMMENT ON FUNCTION enqueue_embedding IS 'Enqueues a vCon for embedding processing. Runs with SECURITY DEFINER to bypass RLS.';

