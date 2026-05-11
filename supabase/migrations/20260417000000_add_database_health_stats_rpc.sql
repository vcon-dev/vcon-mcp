-- Dedicated RPCs for database health metrics.
--
-- Why not use the generic exec_sql RPC? exec_sql wraps the inner query in
-- `SELECT jsonb_agg(row_to_json(t)) FROM (<query>) t`. Rows from pg_stat_*
-- system views contain columns (OIDs, estimator types) that row_to_json
-- refuses to serialize under SECURITY DEFINER, causing the health-metric
-- queries in the MCP server to error out. These dedicated functions cast
-- every column to a JSON-safe type before returning.

SET search_path = public, pg_catalog;

-- Performance metrics: per-table live/dead row counts and scan ratios.
CREATE OR REPLACE FUNCTION get_performance_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      schemaname::text                       AS schemaname,
      relname::text                          AS tablename,
      seq_scan::bigint                       AS seq_scan,
      seq_tup_read::bigint                   AS seq_tup_read,
      idx_scan::bigint                       AS idx_scan,
      idx_tup_fetch::bigint                  AS idx_tup_fetch,
      n_tup_ins::bigint                      AS inserts,
      n_tup_upd::bigint                      AS updates,
      n_tup_del::bigint                      AS deletes,
      n_live_tup::bigint                     AS live_rows,
      n_dead_tup::bigint                     AS dead_rows,
      ROUND(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 2) AS dead_row_percentage,
      ROUND(idx_scan::numeric / NULLIF(seq_scan + idx_scan, 0) * 100, 2) AS index_usage_ratio
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY seq_scan + idx_scan DESC
  ) t;
$$;

-- Storage efficiency: relation sizes and index footprint per table.
CREATE OR REPLACE FUNCTION get_storage_efficiency()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      schemaname::text AS schemaname,
      tablename::text  AS tablename,
      pg_size_pretty(pg_total_relation_size((schemaname||'.'||tablename)::regclass)) AS total_size,
      pg_size_pretty(pg_relation_size((schemaname||'.'||tablename)::regclass))       AS table_size,
      pg_size_pretty(
        pg_total_relation_size((schemaname||'.'||tablename)::regclass)
        - pg_relation_size((schemaname||'.'||tablename)::regclass)
      ) AS index_size,
      ROUND(
        (pg_total_relation_size((schemaname||'.'||tablename)::regclass)
         - pg_relation_size((schemaname||'.'||tablename)::regclass))::numeric
        / NULLIF(pg_total_relation_size((schemaname||'.'||tablename)::regclass), 0) * 100,
        2
      ) AS index_size_percentage,
      pg_total_relation_size((schemaname||'.'||tablename)::regclass)::bigint AS total_size_bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size((schemaname||'.'||tablename)::regclass) DESC
  ) t;
$$;

-- Index health: scan counts and usage classification.
CREATE OR REPLACE FUNCTION get_index_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      schemaname::text                   AS schemaname,
      relname::text                      AS tablename,
      indexrelname::text                 AS indexname,
      idx_scan::bigint                   AS scans,
      idx_tup_read::bigint               AS rows_read,
      idx_tup_fetch::bigint              AS rows_fetched,
      pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS index_size,
      CASE
        WHEN idx_scan = 0 AND indexrelname NOT LIKE '%_pkey' THEN 'UNUSED'
        WHEN idx_scan < 10 THEN 'LOW_USAGE'
        ELSE 'ACTIVE'
      END AS health_status
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC
  ) t;
$$;

-- Connection / buffer cache metrics.
CREATE OR REPLACE FUNCTION get_connection_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT row_to_json(t)::jsonb
  FROM (
    SELECT
      COALESCE(SUM(heap_blks_read), 0)::bigint AS heap_read,
      COALESCE(SUM(heap_blks_hit), 0)::bigint  AS heap_hit,
      ROUND(
        SUM(heap_blks_hit)::numeric
        / NULLIF(SUM(heap_blks_hit) + SUM(heap_blks_read), 0),
        4
      ) AS cache_hit_ratio,
      COALESCE(SUM(idx_blks_read), 0)::bigint AS idx_read,
      COALESCE(SUM(idx_blks_hit), 0)::bigint  AS idx_hit,
      ROUND(
        SUM(idx_blks_hit)::numeric
        / NULLIF(SUM(idx_blks_hit) + SUM(idx_blks_read), 0),
        4
      ) AS idx_cache_hit_ratio
    FROM pg_statio_user_tables
  ) t;
$$;

GRANT EXECUTE ON FUNCTION get_performance_metrics()  TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION get_storage_efficiency()   TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION get_index_health()         TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION get_connection_metrics()   TO authenticated, service_role, anon;

COMMENT ON FUNCTION get_performance_metrics() IS
  'Per-table scan/insert/update/delete counts from pg_stat_user_tables, JSON-safe.';
COMMENT ON FUNCTION get_storage_efficiency() IS
  'Per-table size and index footprint. JSON-safe wrapper over pg_tables + pg_*_size().';
COMMENT ON FUNCTION get_index_health() IS
  'Per-index scan counts and UNUSED/LOW_USAGE/ACTIVE classification.';
COMMENT ON FUNCTION get_connection_metrics() IS
  'Buffer cache hit ratios from pg_statio_user_tables.';
