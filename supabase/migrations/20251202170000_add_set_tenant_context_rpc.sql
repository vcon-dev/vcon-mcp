-- Add set_tenant_context RPC function for service role tenant context
-- This function allows the application to set the current tenant ID
-- when using the service role key (which bypasses RLS)
--
-- The get_current_tenant_id() function reads from:
-- 1. JWT claims (auth.jwt()->>'tenant_id') - for authenticated users
-- 2. app.current_tenant_id session variable - for service role
--
-- This function sets the session variable for case #2

CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set the session variable that get_current_tenant_id() reads
  PERFORM set_config('app.current_tenant_id', p_tenant_id, false);
END;
$$;

-- Grant execute to authenticated and service role
GRANT EXECUTE ON FUNCTION set_tenant_context(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_tenant_context(TEXT) TO service_role;

COMMENT ON FUNCTION set_tenant_context IS
  'Sets the current tenant ID for RLS filtering when using service role.
   The tenant ID is stored in app.current_tenant_id session variable
   and read by get_current_tenant_id() function in RLS policies.';

-- Also create a helper to clear tenant context
CREATE OR REPLACE FUNCTION clear_tenant_context()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', '', false);
END;
$$;

GRANT EXECUTE ON FUNCTION clear_tenant_context() TO authenticated;
GRANT EXECUTE ON FUNCTION clear_tenant_context() TO service_role;

COMMENT ON FUNCTION clear_tenant_context IS
  'Clears the current tenant context, allowing access only to shared data (tenant_id IS NULL).';
