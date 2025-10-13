-- Create exec_sql RPC function for Edge Functions
-- This function allows the embed-vcons Edge Function to execute dynamic SQL queries
-- with parameter substitution for finding text units that need embeddings

CREATE OR REPLACE FUNCTION exec_sql(
  q text,
  params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  query_text text;
BEGIN
  -- Replace named parameters in the query
  query_text := q;
  
  -- Replace :vcon_id with the actual value
  IF params ? 'vcon_id' AND params->>'vcon_id' IS NOT NULL THEN
    query_text := replace(query_text, ':vcon_id', quote_literal(params->>'vcon_id'));
  ELSE
    -- If vcon_id is null, replace with a condition that's always false to skip the filter
    query_text := replace(query_text, 'AND v.id = :vcon_id', '');
    query_text := replace(query_text, 'AND d.vcon_id = :vcon_id', '');
    query_text := replace(query_text, 'AND a.vcon_id = :vcon_id', '');
  END IF;
  
  -- Replace :limit with the actual value
  IF params ? 'limit' THEN
    query_text := replace(query_text, ':limit', (params->>'limit')::text);
  END IF;
  
  -- Execute the query and return as JSONB
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  
  -- Return empty array if no results
  IF result IS NULL THEN
    result := '[]'::jsonb;
  END IF;
  
  RETURN result;
END;
$$;

-- Grant execute permission to authenticated and service role
GRANT EXECUTE ON FUNCTION exec_sql(text, jsonb) TO authenticated, service_role, anon;

COMMENT ON FUNCTION exec_sql IS 'Execute dynamic SQL queries with parameter substitution for Edge Functions';

