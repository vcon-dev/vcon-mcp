-- Create exec_sql RPC function for Edge Functions
-- This function allows the embed-vcons Edge Function to execute dynamic SQL queries
-- with parameter substitution for finding text units that need embeddings
-- NOTE: Parameters are named alphabetically (query_params, query_text) to work correctly
-- with Supabase client which passes parameters in alphabetical order

-- Drop old function if it exists (different signature)
DROP FUNCTION IF EXISTS exec_sql(text, jsonb);

CREATE OR REPLACE FUNCTION exec_sql(
  query_params jsonb DEFAULT '{}'::jsonb,
  query_text text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  processed_query text;
BEGIN
  -- Replace named parameters in the query
  processed_query := query_text;

  -- Replace :vcon_id with the actual value
  IF query_params ? 'vcon_id' AND query_params->>'vcon_id' IS NOT NULL THEN
    processed_query := replace(processed_query, ':vcon_id', quote_literal(query_params->>'vcon_id'));
  ELSE
    -- If vcon_id is null, replace with a condition that's always false to skip the filter
    processed_query := replace(processed_query, 'AND v.id = :vcon_id', '');
    processed_query := replace(processed_query, 'AND d.vcon_id = :vcon_id', '');
    processed_query := replace(processed_query, 'AND a.vcon_id = :vcon_id', '');
  END IF;

  -- Replace :limit with the actual value
  IF query_params ? 'limit' THEN
    processed_query := replace(processed_query, ':limit', (query_params->>'limit')::text);
  END IF;

  -- Execute the query and return as JSONB
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', processed_query) INTO result;

  -- Return empty array if no results
  IF result IS NULL THEN
    result := '[]'::jsonb;
  END IF;

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated and service role
GRANT EXECUTE ON FUNCTION exec_sql(jsonb, text) TO authenticated, service_role, anon;

COMMENT ON FUNCTION exec_sql IS 'Execute dynamic SQL queries with parameter substitution for Edge Functions';

