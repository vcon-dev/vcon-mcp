-- Update get_current_tenant_id() function to check JWT claims first, then fallback to session variable
-- This provides flexibility for both authenticated users (JWT) and service role (session variable)

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Drop and recreate function with JWT claim support
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS TEXT AS $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  -- First, try to get from JWT claim (for authenticated users)
  -- Supabase stores tenant in JWT claims if configured
  BEGIN
    v_tenant_id := current_setting('request.jwt.claims', true)::jsonb->>'tenant_id';
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := NULL;
  END;

  -- If not in JWT, try to get from app settings (for service role)
  IF v_tenant_id IS NULL THEN
    BEGIN
      v_tenant_id := current_setting('app.current_tenant_id', true);
    EXCEPTION WHEN OTHERS THEN
      v_tenant_id := NULL;
    END;
  END IF;

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment
COMMENT ON FUNCTION get_current_tenant_id IS 'Gets current tenant ID from JWT claims (first) or app settings (fallback). Used by RLS policies. Checks auth.jwt()->>''tenant_id'' first, then app.current_tenant_id.';

