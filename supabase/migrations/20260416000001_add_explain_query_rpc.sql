-- Dedicated RPC for EXPLAIN / EXPLAIN ANALYZE.
-- exec_sql cannot be used for EXPLAIN because it wraps the query in
-- "SELECT jsonb_agg(...) FROM (<query>) t", making EXPLAIN a subquery
-- which PostgreSQL rejects (42601: syntax error at or near "SELECT").
--
-- This function uses RETURN QUERY EXECUTE which supports statement-level
-- commands like EXPLAIN.

CREATE OR REPLACE FUNCTION explain_query(
  q          text,
  run_analyze boolean DEFAULT false
)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  explain_stmt text;
BEGIN
  -- Only allow SELECT queries for safety
  IF lower(trim(q)) NOT LIKE 'select%' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  explain_stmt := CASE
    WHEN run_analyze THEN 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) '
    ELSE 'EXPLAIN (FORMAT TEXT) '
  END || q;

  RETURN QUERY EXECUTE explain_stmt;
END;
$$;

GRANT EXECUTE ON FUNCTION explain_query(text, boolean) TO authenticated, service_role, anon;

COMMENT ON FUNCTION explain_query(text, boolean) IS
  'Run EXPLAIN or EXPLAIN ANALYZE on a SELECT query. Returns plan lines as text rows.';
