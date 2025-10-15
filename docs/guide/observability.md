# Observability Guide

> Comprehensive observability with OpenTelemetry: traces, metrics, and structured logs

## Overview

The vCon MCP server includes production-ready observability powered by OpenTelemetry. Monitor request flows, track performance metrics, and analyze logs with full trace correlation.

### Features

- **Distributed Tracing**: Full request lifecycle tracing with spans for every operation
- **Metrics**: Business and performance metrics (counters, histograms, gauges)
- **Structured Logging**: JSON logs with automatic trace context correlation
- **Flexible Exports**: Console/JSON for development, OTLP for production collectors
- **Zero Configuration**: Works out of the box with sensible defaults
- **No Performance Impact**: Minimal overhead when disabled

## Quick Start

### Development (Console Export)

Output telemetry to stderr as JSON for local development:

```bash
# .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=console
OTEL_LOG_LEVEL=info
```

Start the server and see structured logs:

```bash
npm run dev
```

### Production (OTLP Collector)

Export to an OpenTelemetry collector:

```bash
# .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=vcon-mcp-server
OTEL_SERVICE_VERSION=1.0.0
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_ENABLED` | `true` | Enable/disable OpenTelemetry |
| `OTEL_EXPORTER_TYPE` | `console` | Export type: `console` or `otlp` |
| `OTEL_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | `vcon-mcp-server` | Service name in telemetry |
| `OTEL_SERVICE_VERSION` | `1.0.0` | Service version in telemetry |
| `OTEL_LOG_LEVEL` | `info` | Diagnostic log level |

### Export Types

#### Console (Development)

Best for local development and debugging:

```bash
OTEL_EXPORTER_TYPE=console
```

- Outputs JSON to stderr
- No external dependencies
- Easy to pipe to log processors
- Human-readable with jq

Example output:

```json
{
  "timestamp": "2025-10-15T10:30:45.123Z",
  "level": "info",
  "message": "Tool execution completed",
  "trace_id": "1234567890abcdef",
  "span_id": "abcdef123456",
  "tool_name": "create_vcon",
  "duration_ms": 125
}
```

#### OTLP (Production)

Best for production environments with observability platforms:

```bash
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
```

- Exports via OTLP/HTTP protocol
- Compatible with all major observability platforms
- Efficient binary protocol
- Automatic retries and batching

## Collector Setup

### Local Development

#### Jaeger (All-in-One)

```bash
docker run -d --name jaeger \
  -p 4318:4318 \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest

# .env
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
```

View traces at: http://localhost:16686

#### OpenTelemetry Collector

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [logging]
    metrics:
      receivers: [otlp]
      exporters: [logging]
```

```bash
docker run -d --name otel-collector \
  -p 4318:4318 \
  -v $(pwd)/otel-collector-config.yaml:/etc/otel-collector-config.yaml \
  otel/opentelemetry-collector:latest \
  --config=/etc/otel-collector-config.yaml

# .env
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
```

### Cloud Platforms

#### Honeycomb

```bash
# .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=https://api.honeycomb.io
OTEL_SERVICE_NAME=vcon-mcp-server

# Also set Honeycomb API key header (requires custom exporter config)
```

#### Datadog

```bash
# .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=vcon-mcp-server

# Run Datadog agent with OTLP receiver enabled
```

#### New Relic

```bash
# .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=https://otlp.nr-data.net:4318
OTEL_SERVICE_NAME=vcon-mcp-server

# Set New Relic API key in exporter config
```

#### AWS X-Ray

Use AWS OpenTelemetry Collector with X-Ray exporter.

## Telemetry Reference

### Traces

Traces capture the full lifecycle of requests with hierarchical spans.

#### MCP Tool Execution

Every tool call creates a root span:

- **Span Name**: `mcp.tool.{tool_name}`
- **Attributes**:
  - `mcp.tool.name`: Tool name
  - `mcp.tool.success`: Boolean success status
  - `vcon.uuid`: vCon UUID (when applicable)
  - `error.type`: Error type (on failure)
  - `error.message`: Error message (on failure)

#### Database Operations

Database queries create child spans:

- **Span Names**:
  - `db.createVCon`
  - `db.getVCon`
  - `db.keywordSearch`
  - `db.semanticSearch`
  - `db.hybridSearch`
- **Attributes**:
  - `db.operation`: Operation type (insert, select, search)
  - `db.system`: Database system (supabase)
  - `vcon.uuid`: vCon UUID
  - `cache.hit`: Cache hit/miss boolean
  - `search.type`: Search type
  - `search.results.count`: Result count

### Metrics

#### Business Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `vcon.created.count` | Counter | vCons created | `vcon.uuid` |
| `vcon.deleted.count` | Counter | vCons deleted | `vcon.uuid` |
| `vcon.search.count` | Counter | Searches performed | `search.type` |
| `tool.execution.count` | Counter | Tool executions | `mcp.tool.name`, `status` |

#### Performance Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `tool.execution.duration` | Histogram | Tool execution time (ms) | `mcp.tool.name`, `mcp.tool.success` |
| `db.query.duration` | Histogram | Query execution time (ms) | `operation` |
| `cache.operation.duration` | Histogram | Cache operation time (ms) | `operation` |

#### System Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `db.query.count` | Counter | Database queries | `operation` |
| `db.query.errors` | Counter | Database errors | `operation`, `error_type` |
| `cache.hit` | Counter | Cache hits | `operation` |
| `cache.miss` | Counter | Cache misses | `operation` |
| `cache.error` | Counter | Cache errors | `error_type` |

### Structured Logs

All logs include automatic trace context correlation:

```json
{
  "timestamp": "2025-10-15T10:30:45.123Z",
  "level": "info",
  "message": "Cache layer enabled",
  "trace_id": "1234567890abcdef",
  "span_id": "abcdef123456",
  "trace_flags": 1,
  "cache_ttl": 3600
}
```

#### Log Levels

- `debug`: Verbose diagnostic information
- `info`: Normal operational events
- `warn`: Warning conditions
- `error`: Error conditions

## Best Practices

### Development

1. **Use Console Export**: Easy to debug locally
2. **Pipe to jq**: Format JSON logs for readability
   ```bash
   npm run dev 2>&1 | jq -R 'fromjson?'
   ```
3. **Filter by Trace**: Follow a single request through the system
4. **Check Metrics**: Monitor performance during development

### Production

1. **Use OTLP Export**: Connect to your observability platform
2. **Set Service Name**: Identify this service in distributed traces
3. **Monitor Key Metrics**:
   - Tool execution duration
   - Database query count
   - Cache hit rate
   - Error rates
4. **Set Up Alerts**:
   - High error rates
   - Slow queries (p95 > 1000ms)
   - Low cache hit rates (< 50%)
5. **Retain Traces**: Keep 7-30 days for debugging

### Performance

The observability system is designed for minimal overhead:

- **When Enabled**: < 1% CPU overhead, < 10MB memory
- **When Disabled**: Zero overhead (short-circuit checks)
- **Batching**: Metrics and traces are batched for efficiency
- **Async Export**: No blocking on the critical path

### Sampling

For high-traffic scenarios, consider trace sampling:

```bash
# Sample 10% of traces (requires custom configuration)
OTEL_TRACES_SAMPLER=traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

## Troubleshooting

### No Telemetry Output

1. Check `OTEL_ENABLED=true`
2. Verify `OTEL_EXPORTER_TYPE` is set
3. Check initialization logs in stderr

### OTLP Connection Errors

1. Verify collector is running
2. Check `OTEL_ENDPOINT` is correct
3. Ensure network connectivity
4. Check firewall rules

### Missing Traces

1. Verify span creation in code
2. Check sampling configuration
3. Ensure proper shutdown (flushes buffers)

### High Overhead

1. Reduce `OTEL_LOG_LEVEL` to `error`
2. Disable auto-instrumentations (edit config)
3. Increase metric export interval
4. Enable trace sampling

## Examples

### Query Spans in Jaeger

1. Open Jaeger UI: http://localhost:16686
2. Select service: `vcon-mcp-server`
3. Search for operations: `mcp.tool.create_vcon`
4. View trace timeline and tags

### Analyze Metrics

```bash
# Export metrics to Prometheus format
curl http://localhost:9464/metrics

# Query specific metric
curl http://localhost:9464/metrics | grep vcon_created_count
```

### Correlate Logs with Traces

```bash
# Extract trace ID from log
TRACE_ID=$(cat logs.json | jq -r '.trace_id')

# Search traces by ID in Jaeger
curl "http://localhost:16686/api/traces/${TRACE_ID}"
```

## Integration Examples

### Custom Dashboard (Grafana)

```json
{
  "dashboard": {
    "title": "vCon MCP Server",
    "panels": [
      {
        "title": "Tool Execution Rate",
        "targets": [
          {
            "expr": "rate(tool_execution_count[5m])"
          }
        ]
      },
      {
        "title": "Database Query Duration (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(db_query_duration_bucket[5m]))"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "rate(cache_hit[5m]) / (rate(cache_hit[5m]) + rate(cache_miss[5m]))"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules (Prometheus)

```yaml
groups:
  - name: vcon_mcp
    rules:
      - alert: HighErrorRate
        expr: rate(tool_execution_count{status="error"}[5m]) > 0.1
        annotations:
          summary: "High error rate detected"
      
      - alert: SlowQueries
        expr: histogram_quantile(0.95, rate(db_query_duration_bucket[5m])) > 1000
        annotations:
          summary: "Database queries are slow"
      
      - alert: LowCacheHitRate
        expr: rate(cache_hit[5m]) / (rate(cache_hit[5m]) + rate(cache_miss[5m])) < 0.5
        annotations:
          summary: "Cache hit rate is low"
```

## Additional Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Observability Best Practices](https://opentelemetry.io/docs/concepts/observability-primer/)

