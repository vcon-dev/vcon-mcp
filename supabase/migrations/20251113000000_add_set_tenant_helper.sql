-- Add helper function to set tenant context from application
-- This is used by the MCP server to set the tenant ID for RLS policies

-- Create function to set tenant context (idempotent)
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON FUNCTION set_tenant_context IS 'Sets the app.current_tenant_id session variable for RLS. Called by MCP server when CURRENT_TENANT_ID is configured.';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION set_tenant_context TO service_role;
GRANT EXECUTE ON FUNCTION set_tenant_context TO anon;
GRANT EXECUTE ON FUNCTION set_tenant_context TO authenticated;






